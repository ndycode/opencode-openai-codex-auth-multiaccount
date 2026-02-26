import { describe, it, expect } from "vitest";
import {
	RetryBudgetTracker,
	resolveRetryBudgetLimits,
	type RetryBudgetLimits,
} from "../lib/request/retry-budget.js";

describe("retry-budget", () => {
	it("resolves profile defaults", () => {
		const conservative = resolveRetryBudgetLimits("conservative");
		const aggressive = resolveRetryBudgetLimits("aggressive");

		expect(conservative.rateLimitGlobal).toBe(1);
		expect(aggressive.rateLimitGlobal).toBeGreaterThan(conservative.rateLimitGlobal);
	});

	it("applies normalized overrides", () => {
		const limits = resolveRetryBudgetLimits("balanced", {
			network: 2.9,
			server: -1,
			emptyResponse: 0,
		});

		expect(limits.network).toBe(2);
		expect(limits.server).toBe(4);
		expect(limits.emptyResponse).toBe(0);
	});

	it("tracks usage and remaining budget", () => {
		const limits: RetryBudgetLimits = {
			authRefresh: 1,
			network: 1,
			server: 1,
			rateLimitShort: 1,
			rateLimitGlobal: 1,
			emptyResponse: 1,
		};
		const tracker = new RetryBudgetTracker(limits);

		expect(tracker.consume("network")).toBe(true);
		expect(tracker.consume("network")).toBe(false);
		expect(tracker.getRemaining("network")).toBe(0);
		expect(tracker.getUsage().network).toBe(1);
	});
});

