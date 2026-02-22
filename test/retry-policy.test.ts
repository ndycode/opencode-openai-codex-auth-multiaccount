import { describe, it, expect } from "vitest";
import { getRetryPolicyDecision } from "../lib/request/retry-policy.js";

describe("retry-policy", () => {
	it("keeps legacy same-account retry for transient network errors", () => {
		const decision = getRetryPolicyDecision({
			mode: "legacy",
			route: "network_error",
			sameAccountRetryAttempts: 0,
			maxSameAccountRetries: 1,
		});

		expect(decision.sameAccountRetry).toBe(true);
		expect(decision.rotateAccount).toBe(false);
		expect(decision.failFast).toBe(false);
	});

	it("route-matrix preserves no-rotation fail-fast for approval/policy", () => {
		const decision = getRetryPolicyDecision({
			mode: "route-matrix",
			route: "approval_or_policy",
		});

		expect(decision.sameAccountRetry).toBe(false);
		expect(decision.rotateAccount).toBe(false);
		expect(decision.failFast).toBe(true);
	});

	it("route-matrix performs guided retry for tool_argument once", () => {
		const first = getRetryPolicyDecision({
			mode: "route-matrix",
			route: "tool_argument",
			guidedRetryAttempts: 0,
			maxGuidedRetries: 1,
		});
		const second = getRetryPolicyDecision({
			mode: "route-matrix",
			route: "tool_argument",
			guidedRetryAttempts: 1,
			maxGuidedRetries: 1,
		});

		expect(first.sameAccountRetry).toBe(true);
		expect(first.failFast).toBe(false);
		expect(second.sameAccountRetry).toBe(false);
		expect(second.failFast).toBe(true);
	});

	it("route-matrix distinguishes short vs long rate-limit behavior", () => {
		const short = getRetryPolicyDecision({
			mode: "route-matrix",
			route: "rate_limit",
			rateLimitRetryAfterMs: 1000,
			rateLimitShortRetryThresholdMs: 5000,
		});
		const long = getRetryPolicyDecision({
			mode: "route-matrix",
			route: "rate_limit",
			rateLimitRetryAfterMs: 6000,
			rateLimitShortRetryThresholdMs: 5000,
		});

		expect(short.sameAccountRetry).toBe(true);
		expect(short.rotateAccount).toBe(false);
		expect(long.sameAccountRetry).toBe(false);
		expect(long.rotateAccount).toBe(true);
	});
});
