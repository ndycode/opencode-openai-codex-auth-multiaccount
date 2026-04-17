/**
 * Phase 3 Batch E — request-faults chaos tests.
 *
 * Covers the two request-pipeline chaos scenarios: a circuit breaker
 * opening while a request is in flight, and a 429 Retry-After response
 * being translated into a real token-bucket delay that the next call
 * respects.
 *
 * Scenarios covered:
 *   4. Breaker opens mid-flight → the in-flight caller (already past the
 *      gate) completes without raising CircuitOpenError, but the next
 *      canAttempt short-circuits with state=open, reason=open.
 *   5. Rate-limit 429 with Retry-After → handleErrorResponse parses the
 *      header, and both the account-level rate-limit marker and the
 *      per-quota token-bucket backoff state respect the delay window.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
	CircuitBreaker,
	CircuitOpenError,
} from "../../lib/circuit-breaker.js";
import { handleErrorResponse } from "../../lib/request/fetch-helpers.js";
import {
	clearRateLimitBackoffState,
	getRateLimitBackoff,
} from "../../lib/request/rate-limit-backoff.js";
import { AccountManager } from "../../lib/accounts.js";
import { isRateLimitedForFamily } from "../../lib/accounts/rate-limits.js";
import type { AccountStorageV3 } from "../../lib/storage.js";

describe("chaos/request-faults — real fault injection", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date(1_700_000_000_000));
		clearRateLimitBackoffState();
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.useRealTimers();
		clearRateLimitBackoffState();
	});

	describe("scenario 4: circuit breaker opens mid-flight", () => {
		it("in-flight request completes; the next canAttempt short-circuits with state=open", () => {
			const breaker = new CircuitBreaker({
				failureThreshold: 3,
				failureWindowMs: 60_000,
				resetTimeoutMs: 30_000,
			});

			// Simulate request A passing the gate while the breaker is still
			// closed (the hot path: canAttempt() returns true, then the HTTP
			// call begins). This is the "in-flight" condition.
			const gateA = breaker.canAttempt();
			expect(gateA.allowed).toBe(true);
			expect(gateA.state).toBe("closed");

			// Meanwhile, three concurrent failures accumulate — the breaker
			// trips OPEN while request A is still waiting on its response.
			breaker.recordFailure();
			breaker.recordFailure();
			breaker.recordFailure();
			expect(breaker.getState()).toBe("open");

			// Request A eventually returns successfully. In the open state,
			// recordSuccess is a no-op by design (see lib/circuit-breaker.ts)
			// — the breaker must not reset from an open state on a single
			// late success, otherwise it would thrash between open and closed.
			breaker.recordSuccess();
			expect(breaker.getState()).toBe("open");

			// Request B, dispatched after the trip, must be short-circuited.
			const gateB = breaker.canAttempt();
			expect(gateB.allowed).toBe(false);
			expect(gateB.state).toBe("open");
			expect(gateB.reason).toBe("open");

			// The throwing API parallels canAttempt: callers that used the
			// canExecute() guard get a typed CircuitOpenError.
			expect(() => breaker.canExecute()).toThrow(CircuitOpenError);
		});

		it("after resetTimeoutMs only one probe is admitted; concurrent probes see probe-in-flight", () => {
			const breaker = new CircuitBreaker({
				failureThreshold: 1,
				resetTimeoutMs: 10_000,
				halfOpenMaxAttempts: 1,
			});

			breaker.recordFailure();
			expect(breaker.getState()).toBe("open");

			// Still inside the reset window → both probes are denied.
			const early = breaker.canAttempt();
			expect(early.allowed).toBe(false);
			expect(early.state).toBe("open");

			// Cross the reset boundary: the breaker auto-transitions to
			// half-open and admits exactly one probe.
			vi.setSystemTime(new Date(Date.now() + 10_000));
			const probeA = breaker.canAttempt();
			expect(probeA.allowed).toBe(true);
			expect(probeA.state).toBe("half-open");

			// A concurrent probe must be rejected with the explicit
			// `probe-in-flight` reason so the caller can rotate instead of
			// burning the shared slot.
			const probeB = breaker.canAttempt();
			expect(probeB.allowed).toBe(false);
			expect(probeB.state).toBe("half-open");
			expect(probeB.reason).toBe("probe-in-flight");
		});
	});

	describe("scenario 5: 429 with Retry-After respects the delay", () => {
		it("handleErrorResponse parses Retry-After header into retryAfterMs", async () => {
			// Build a real upstream 429 response carrying the header and
			// a usage_limit_reached body so the helper treats it as a rate
			// limit (not an entitlement error).
			const upstream = new Response(
				JSON.stringify({ error: { code: "usage_limit_reached" } }),
				{
					status: 429,
					statusText: "Too Many Requests",
					headers: { "retry-after": "2", "content-type": "application/json" },
				},
			);

			const result = await handleErrorResponse(upstream);
			expect(result.rateLimit).toBeDefined();
			expect(result.rateLimit!.retryAfterMs).toBe(2000);
			expect(result.rateLimit!.code).toBe("usage_limit_reached");
		});

		it("handleErrorResponse prefers retry-after-ms over retry-after (seconds) when both are present", async () => {
			// retry-after-ms is a Codex-specific extension; it must win
			// because it's strictly more precise than the RFC 7231 header.
			const upstream = new Response(
				JSON.stringify({ error: { code: "rate_limit_exceeded" } }),
				{
					status: 429,
					headers: {
						"retry-after-ms": "1750",
						"retry-after": "5",
						"content-type": "application/json",
					},
				},
			);

			const result = await handleErrorResponse(upstream);
			expect(result.rateLimit?.retryAfterMs).toBe(1750);
		});

		it("account rate-limit marker blocks selection until the Retry-After window elapses", () => {
			const now = Date.now();
			const storage: AccountStorageV3 = {
				version: 3,
				activeIndex: 0,
				accounts: [{ refreshToken: "rt-429", addedAt: now, lastUsed: now }],
			};
			const manager = new AccountManager(undefined, storage);

			// Work against the live account reference (not a snapshot copy);
			// markRateLimitedWithReason mutates rateLimitResetTimes in place,
			// and getAccountsSnapshot returns shallow-cloned maps that would
			// not reflect the mutation on a subsequent read.
			const liveAccount = manager.getCurrentAccountForFamily("codex")!;
			expect(liveAccount.refreshToken).toBe("rt-429");

			// Mark the account as rate-limited for 2 seconds, then walk time
			// across the boundary. The state module's predicate is the exact
			// check rotation uses, so asserting it here exercises the real
			// gate the plugin uses after a 429.
			manager.markRateLimitedWithReason(liveAccount, 2000, "codex", "quota");

			expect(isRateLimitedForFamily(liveAccount, "codex")).toBe(true);
			// Rotation treats a rate-limited single-account pool as "no
			// eligible accounts" so callers know to back off.
			expect(manager.getCurrentOrNextForFamily("codex")).toBeNull();

			// 1s later — still blocked.
			vi.setSystemTime(new Date(now + 1_000));
			expect(isRateLimitedForFamily(liveAccount, "codex")).toBe(true);

			// 2.5s later — the window has elapsed, the account is eligible.
			vi.setSystemTime(new Date(now + 2_500));
			expect(isRateLimitedForFamily(liveAccount, "codex")).toBe(false);
			expect(manager.getCurrentOrNextForFamily("codex")).not.toBeNull();

			manager.disposeShutdownHandler();
		});

		it("token-bucket backoff deduplicates inside the 2s window and increments past it", () => {
			// First 429: attempt 1, no dedup.
			const first = getRateLimitBackoff(0, "codex", 2000);
			expect(first.attempt).toBe(1);
			expect(first.delayMs).toBe(2000);
			expect(first.isDuplicate).toBe(false);

			// Concurrent duplicate inside the 2s dedup window — same attempt,
			// flagged as duplicate so the caller doesn't double-increment.
			vi.setSystemTime(new Date(Date.now() + 1_500));
			const dup = getRateLimitBackoff(0, "codex", 2000);
			expect(dup.attempt).toBe(1);
			expect(dup.isDuplicate).toBe(true);

			// Past the dedup window → attempt increments and the exponential
			// delay doubles (2s → 4s), bounded by MAX_BACKOFF_MS upstream.
			vi.setSystemTime(new Date(Date.now() + 1_000));
			const second = getRateLimitBackoff(0, "codex", 2000);
			expect(second.attempt).toBe(2);
			expect(second.delayMs).toBe(4000);
			expect(second.isDuplicate).toBe(false);
		});
	});
});
