/**
 * Phase 3 Batch E — auth-faults chaos tests.
 *
 * Injects faults into the OAuth refresh + rotation path and the local
 * callback server, then asserts the plugin's real recovery behavior
 * (cooldown, rotation to next account, PKCE isolation).
 *
 * Scenarios covered:
 *   3. 401 mid-request → refreshAccessToken surfaces failed/http_error
 *      and AccountManager.markAccountsWithRefreshTokenCoolingDown puts
 *      the offending refresh token on cooldown; the next rotation call
 *      returns a different account for the same model family.
 *   6. Port-1455 collision on concurrent login → only the first
 *      startLocalOAuthServer call binds; the second resolves with
 *      ready=false. PKCE verifier isolation: concurrent
 *      createAuthorizationFlow() calls each produce a distinct verifier
 *      and state so the winning login cannot be replayed by the loser.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
	createAuthorizationFlow,
	refreshAccessToken,
} from "../../lib/auth/auth.js";
import { startLocalOAuthServer } from "../../lib/auth/server.js";
import { AccountManager } from "../../lib/accounts.js";
import type { AccountStorageV3 } from "../../lib/storage.js";

// Two-account pool so rotation has somewhere to go when the first account
// is cooled down by the 401 path. Using fixed timestamps keeps the selection
// deterministic across runs (cursor-based rotation is stable).
function makeTwoAccountStorage(): AccountStorageV3 {
	const now = 1_700_000_000_000;
	return {
		version: 3,
		activeIndex: 0,
		accounts: [
			{ refreshToken: "rt-alpha", addedAt: now, lastUsed: now },
			{ refreshToken: "rt-bravo", addedAt: now, lastUsed: now - 1 },
		],
	};
}

describe("chaos/auth-faults — real fault injection", () => {
	afterEach(() => {
		vi.restoreAllMocks();
		vi.useRealTimers();
	});

	describe("scenario 3: 401 mid-request rotates to next account + cools refresh token", () => {
		it("refreshAccessToken surfaces http_error(401) so callers can trigger cooldown", async () => {
			// Upstream /oauth/token returns 401 once; the helper must report
			// the typed failure so the plugin can mark the token and rotate.
			const originalFetch = globalThis.fetch;
			const fetchSpy = vi.fn(async () =>
				new Response(JSON.stringify({ error: "invalid_grant" }), { status: 401 }),
			);
			globalThis.fetch = fetchSpy as typeof globalThis.fetch;

			try {
				const result = await refreshAccessToken("rt-alpha");
				expect(result.type).toBe("failed");
				if (result.type === "failed") {
					expect(result.reason).toBe("http_error");
					expect(result.statusCode).toBe(401);
				}
				expect(fetchSpy).toHaveBeenCalledTimes(1);
			} finally {
				globalThis.fetch = originalFetch;
			}
		});

		it("manager rotates to the next account and marks the failing refresh token as cooled down", async () => {
			// Freeze wall-clock so cooldown timestamps are comparable.
			vi.useFakeTimers();
			vi.setSystemTime(new Date(1_700_000_000_000));

			const manager = new AccountManager(undefined, makeTwoAccountStorage());
			const snapshotBefore = manager.getAccountsSnapshot();
			expect(snapshotBefore).toHaveLength(2);

			// Pick the current account for codex and simulate a 401 path:
			// the refresh failure handler calls
			// markAccountsWithRefreshTokenCoolingDown on the offending token.
			const activeBefore = manager.getCurrentOrNextForFamily("codex");
			expect(activeBefore).not.toBeNull();
			const firstRefreshToken = activeBefore!.refreshToken;
			expect(firstRefreshToken).toBe("rt-alpha");

			const cooldownMs = 30_000;
			const cooled = manager.markAccountsWithRefreshTokenCoolingDown(
				firstRefreshToken,
				cooldownMs,
				"auth-failure",
			);
			expect(cooled).toBe(1);

			// Rotation: the next eligible account for codex must differ.
			const next = manager.getNextForFamily("codex");
			expect(next).not.toBeNull();
			expect(next!.refreshToken).toBe("rt-bravo");

			// The cooled account carries a typed cooldown reason + a future
			// expiry, both of which downstream explainability surfaces read.
			const snapshotAfter = manager.getAccountsSnapshot();
			const coolingAccount = snapshotAfter.find(
				(a) => a.refreshToken === firstRefreshToken,
			);
			expect(coolingAccount).toBeDefined();
			expect(coolingAccount!.cooldownReason).toBe("auth-failure");
			expect(coolingAccount!.coolingDownUntil).toBeDefined();
			expect(coolingAccount!.coolingDownUntil!).toBeGreaterThan(Date.now());
			expect(coolingAccount!.coolingDownUntil! - Date.now()).toBeLessThanOrEqual(
				cooldownMs,
			);

			manager.disposeShutdownHandler();
		});

		it("auth-failure counter increments atomically for the offending refresh token", async () => {
			// The counter must serialize across two near-simultaneous 401s
			// that share a refresh token (org-variant accounts). Without
			// serialization both callers can read stale 0 and write 1,
			// masking the real failure count.
			const manager = new AccountManager(undefined, makeTwoAccountStorage());
			const accounts = manager.getAccountsSnapshot();
			const alpha = accounts.find((a) => a.refreshToken === "rt-alpha")!;

			const [first, second] = await Promise.all([
				manager.incrementAuthFailures(alpha),
				manager.incrementAuthFailures(alpha),
			]);
			expect([first, second].sort()).toEqual([1, 2]);
			expect(manager.getAuthFailures(alpha)).toBe(2);

			manager.disposeShutdownHandler();
		});
	});

	describe("scenario 6: port-1455 collision + PKCE verifier isolation", () => {
		let firstServer: Awaited<ReturnType<typeof startLocalOAuthServer>> | null =
			null;
		let secondServer: Awaited<ReturnType<typeof startLocalOAuthServer>> | null =
			null;

		afterEach(() => {
			// Defensive: tear servers down in both orderings so a half-bound
			// port does not bleed into sibling tests.
			if (firstServer) {
				firstServer.close();
				firstServer = null;
			}
			if (secondServer) {
				secondServer.close();
				secondServer = null;
			}
		});

		it("concurrent startLocalOAuthServer: first binds, second resolves with ready=false", async () => {
			const stateA = "chaos-state-alpha";
			const stateB = "chaos-state-bravo";

			firstServer = await startLocalOAuthServer({ state: stateA });
			expect(firstServer.ready).toBe(true);
			expect(firstServer.port).toBe(1455);

			// Second concurrent attempt on the same port must surface the
			// collision as ready=false instead of silently hanging.
			secondServer = await startLocalOAuthServer({ state: stateB });
			expect(secondServer.ready).toBe(false);
			expect(secondServer.port).toBe(1455);

			// The loser's waitForCode must resolve deterministically (null)
			// so the caller can fall through to device-code / manual paste.
			const loserCode = await secondServer.waitForCode();
			expect(loserCode).toBeNull();
		});

		it("concurrent authorization flows get distinct PKCE verifiers, states, and URLs", async () => {
			const [flowA, flowB, flowC] = await Promise.all([
				createAuthorizationFlow(),
				createAuthorizationFlow(),
				createAuthorizationFlow(),
			]);

			const verifiers = new Set([
				flowA.pkce.verifier,
				flowB.pkce.verifier,
				flowC.pkce.verifier,
			]);
			const challenges = new Set([
				flowA.pkce.challenge,
				flowB.pkce.challenge,
				flowC.pkce.challenge,
			]);
			const states = new Set([flowA.state, flowB.state, flowC.state]);

			// Each concurrent flow MUST have an isolated (verifier, challenge,
			// state) triple; collisions would allow the loser to replay the
			// winner's auth code against the token endpoint.
			expect(verifiers.size).toBe(3);
			expect(challenges.size).toBe(3);
			expect(states.size).toBe(3);

			// Verifier shape: PKCE spec (RFC 7636) requires 43-128 chars
			// of [A-Za-z0-9-._~]. We do not reimplement validation here;
			// we just assert the field exists and meets the minimum length.
			for (const verifier of verifiers) {
				expect(verifier.length).toBeGreaterThanOrEqual(43);
			}
		});

		it("bound server rejects callback with a mismatched state (replay protection)", async () => {
			firstServer = await startLocalOAuthServer({ state: "winner-state" });
			expect(firstServer.ready).toBe(true);

			// A concurrent login's code cannot be hijacked because the state
			// guard rejects a different state value. This is the property
			// that makes PKCE isolation safe under port contention.
			const res = await fetch(
				"http://127.0.0.1:1455/auth/callback?code=hijack&state=loser-state",
			);
			expect(res.status).toBe(400);
			expect(await res.text()).toContain("State mismatch");
		});
	});
});
