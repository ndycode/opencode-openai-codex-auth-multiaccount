import { describe, expect, it } from "vitest";

import {
	deduplicateUsageAccountIndices,
	getUsageLeftPercent,
	parseCodexUsagePayload,
	resolveCodexUsageActiveAccount,
	type UsagePayload,
} from "../lib/codex-usage.js";
import type { AccountStorageV3 } from "../lib/storage.js";

describe("codex usage helpers", () => {
	it("parses usage payloads using remaining-percent semantics", () => {
		const payload: UsagePayload = {
			plan_type: "team",
			rate_limit: {
				primary_window: {
					used_percent: 13,
					limit_window_seconds: 18000,
				},
				secondary_window: {
					used_percent: 36,
					limit_window_seconds: 604800,
				},
			},
			code_review_rate_limit: {
				primary_window: {
					used_percent: 0,
					limit_window_seconds: 604800,
				},
			},
			additional_rate_limits: [
				{
					limit_name: "batch_jobs",
					rate_limit: {
						primary_window: {
							used_percent: 25,
							limit_window_seconds: 3600,
						},
					},
				},
			],
			credits: { unlimited: true },
		};

		const usage = parseCodexUsagePayload(payload);

		expect(usage.planType).toBe("team");
		expect(usage.credits).toBe("unlimited");
		expect(usage.limits).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					name: "5h limit",
					leftPercent: 87,
					summary: "87% left",
				}),
				expect.objectContaining({
					name: "Weekly limit",
					leftPercent: 64,
					summary: "64% left",
				}),
				expect.objectContaining({
					name: "Code review",
					leftPercent: 100,
				}),
				expect.objectContaining({
					name: "Batch Jobs",
					leftPercent: 75,
				}),
			]),
		);
	});

	it("clamps remaining percent and preserves active codex account selection", () => {
		expect(getUsageLeftPercent(-10)).toBe(100);
		expect(getUsageLeftPercent(110)).toBe(0);
		expect(getUsageLeftPercent(12.4)).toBe(88);

		const storage: AccountStorageV3 = {
			version: 3,
			activeIndex: 0,
			activeIndexByFamily: { codex: 2 },
			accounts: [
				{ refreshToken: "r1", addedAt: 0, lastUsed: 0 },
				{ refreshToken: "r1", addedAt: 0, lastUsed: 0 },
				{ refreshToken: "r2", accountId: "acc-2", addedAt: 0, lastUsed: 0 },
			],
		};

		expect(deduplicateUsageAccountIndices(storage)).toEqual([0, 2]);
		expect(resolveCodexUsageActiveAccount(storage)).toMatchObject({
			index: 2,
			account: { accountId: "acc-2" },
		});
	});
});
