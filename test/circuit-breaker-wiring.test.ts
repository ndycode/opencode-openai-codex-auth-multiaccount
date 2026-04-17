/**
 * RC-8 — wiring tests for the non-throwing `canAttempt` gate.
 *
 * These tests exercise the request-pipeline contract: `canAttempt` returns a
 * `CanAttemptResult` without throwing, so the dispatcher in `index.ts` can
 * short-circuit to the rotation path. State transitions (CLOSED → OPEN,
 * OPEN → HALF_OPEN after cooldown, HALF_OPEN → CLOSED on probe success,
 * HALF_OPEN → OPEN on probe failure, concurrent-probe rejection) are verified
 * here — the existing `test/circuit-breaker.test.ts` keeps coverage for the
 * legacy throwing `canExecute` surface.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
	CircuitBreaker,
	CircuitOpenError,
	DEFAULT_CIRCUIT_BREAKER_CONFIG,
} from "../lib/circuit-breaker.js";

const { failureThreshold, resetTimeoutMs } = DEFAULT_CIRCUIT_BREAKER_CONFIG;

describe("circuit-breaker: wired gate (canAttempt)", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date(0));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("CLOSED: allows the call and reports state=closed", () => {
		const breaker = new CircuitBreaker();
		const result = breaker.canAttempt();
		expect(result.allowed).toBe(true);
		expect(result.state).toBe("closed");
		expect(result.reason).toBeUndefined();
	});

	it("CLOSED → OPEN: denies the call once failureThreshold reached within the window", () => {
		const breaker = new CircuitBreaker();
		for (let i = 0; i < failureThreshold; i++) {
			breaker.recordFailure();
		}
		expect(breaker.getState()).toBe("open");

		const result = breaker.canAttempt();
		expect(result.allowed).toBe(false);
		expect(result.state).toBe("open");
		expect(result.reason).toBe("open");
	});

	it("OPEN → HALF_OPEN: auto-transitions after cooldown and admits a probe", () => {
		const breaker = new CircuitBreaker();
		for (let i = 0; i < failureThreshold; i++) {
			breaker.recordFailure();
		}
		expect(breaker.getState()).toBe("open");

		// Advance past the cooldown window.
		vi.setSystemTime(new Date(resetTimeoutMs + 1));

		const first = breaker.canAttempt();
		expect(first.allowed).toBe(true);
		expect(first.state).toBe("half-open");
		expect(breaker.getState()).toBe("half-open");
	});

	it("HALF_OPEN: first probe allowed, concurrent probe rejected with probe-in-flight", () => {
		const breaker = new CircuitBreaker();
		for (let i = 0; i < failureThreshold; i++) {
			breaker.recordFailure();
		}
		vi.setSystemTime(new Date(resetTimeoutMs + 1));

		const first = breaker.canAttempt();
		expect(first.allowed).toBe(true);
		expect(first.state).toBe("half-open");

		// A second concurrent caller (no recordSuccess / recordFailure yet) sees
		// the probe slot already consumed and is denied without throwing.
		const second = breaker.canAttempt();
		expect(second.allowed).toBe(false);
		expect(second.state).toBe("half-open");
		expect(second.reason).toBe("probe-in-flight");
	});

	it("HALF_OPEN → CLOSED: probe success closes the gate and allows the next caller", () => {
		const breaker = new CircuitBreaker();
		for (let i = 0; i < failureThreshold; i++) {
			breaker.recordFailure();
		}
		vi.setSystemTime(new Date(resetTimeoutMs + 1));

		expect(breaker.canAttempt().allowed).toBe(true);
		breaker.recordSuccess();
		expect(breaker.getState()).toBe("closed");

		const next = breaker.canAttempt();
		expect(next.allowed).toBe(true);
		expect(next.state).toBe("closed");
	});

	it("HALF_OPEN → OPEN: probe failure reopens and resets the cooldown", () => {
		const breaker = new CircuitBreaker();
		for (let i = 0; i < failureThreshold; i++) {
			breaker.recordFailure();
		}
		vi.setSystemTime(new Date(resetTimeoutMs + 1));

		// Admit the probe…
		expect(breaker.canAttempt().allowed).toBe(true);

		// …and fail it. The breaker must reopen with a fresh cooldown window
		// so subsequent callers are denied until the timer elapses again.
		breaker.recordFailure();
		expect(breaker.getState()).toBe("open");

		const immediate = breaker.canAttempt();
		expect(immediate.allowed).toBe(false);
		expect(immediate.state).toBe("open");
		expect(immediate.reason).toBe("open");

		// Cooldown advances relative to the reopen timestamp, not the original
		// open transition.
		vi.setSystemTime(new Date(resetTimeoutMs + 2 + resetTimeoutMs + 1));
		const recovered = breaker.canAttempt();
		expect(recovered.allowed).toBe(true);
		expect(recovered.state).toBe("half-open");
	});

	it("respects a custom halfOpenMaxAttempts > 1 before denying with probe-in-flight", () => {
		const breaker = new CircuitBreaker({ halfOpenMaxAttempts: 2 });
		for (let i = 0; i < failureThreshold; i++) {
			breaker.recordFailure();
		}
		vi.setSystemTime(new Date(resetTimeoutMs + 1));

		expect(breaker.canAttempt().allowed).toBe(true);
		expect(breaker.canAttempt().allowed).toBe(true);
		const third = breaker.canAttempt();
		expect(third.allowed).toBe(false);
		expect(third.reason).toBe("probe-in-flight");
	});

	it("canAttempt does not regress existing canExecute behavior", () => {
		// canExecute still throws on the denial paths so the legacy surface
		// used by other call sites is preserved.
		const breaker = new CircuitBreaker();
		for (let i = 0; i < failureThreshold; i++) {
			breaker.recordFailure();
		}
		expect(() => breaker.canExecute()).toThrow(CircuitOpenError);
	});
});

describe("CircuitOpenError (typed short-circuit payload)", () => {
	it("carries breakerKey, state, and reason when constructed from the pipeline", () => {
		const error = new CircuitOpenError("Circuit open for acct:gpt-5", {
			breakerKey: "acct:gpt-5",
			state: "open",
			reason: "open",
		});
		expect(error).toBeInstanceOf(CircuitOpenError);
		expect(error.code).toBe("CODEX_CIRCUIT_OPEN");
		expect(error.breakerKey).toBe("acct:gpt-5");
		expect(error.state).toBe("open");
		expect(error.reason).toBe("open");
	});

	it("preserves the zero-argument constructor for backward compatibility", () => {
		const error = new CircuitOpenError();
		expect(error.message).toBe("Circuit is open");
		expect(error.breakerKey).toBeUndefined();
		expect(error.state).toBeUndefined();
		expect(error.reason).toBeUndefined();
	});
});
