import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	__resetModelCapabilitiesCacheForTests,
	__setModelCapabilitiesCacheForTests,
	clampReasoningEffortForModel,
	getModelCapabilityRecord,
	prepareModelCapabilitiesFor,
} from "../lib/request/model-capabilities.js";

describe("model capabilities", () => {
	const originalFetch = globalThis.fetch;
	const originalVitestEnv = process.env.VITEST;
	const originalNodeEnv = process.env.NODE_ENV;

	beforeEach(() => {
		__resetModelCapabilitiesCacheForTests();
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
		process.env.VITEST = originalVitestEnv;
		process.env.NODE_ENV = originalNodeEnv;
		vi.restoreAllMocks();
	});

	it("returns static fallback for unknown models", () => {
		const record = getModelCapabilityRecord("unknown-model", { mode: "off" });
		expect(record.source).toBe("static");
		expect(record.supportedReasoningEfforts).toContain("minimal");
		expect(record.supportedReasoningEfforts).toContain("high");
	});

	it("returns codex mini static profile with medium/high only", () => {
		const record = getModelCapabilityRecord("gpt-5-codex-mini", { mode: "off" });
		expect(record.supportedReasoningEfforts).toEqual(["medium", "high"]);
		expect(record.defaultReasoningEffort).toBe("medium");
	});

	it("returns gpt-5.3 codex static profile with xhigh default", () => {
		const record = getModelCapabilityRecord("openai/gpt-5.3-codex", { mode: "off" });
		expect(record.supportedReasoningEfforts).toEqual(["low", "medium", "high", "xhigh"]);
		expect(record.defaultReasoningEffort).toBe("xhigh");
	});

	it("clamps unsupported effort to nearest supported effort", () => {
		const result = clampReasoningEffortForModel("gpt-5-codex-mini", "xhigh", {
			mode: "off",
		});
		expect(result.changed).toBe(true);
		expect(result.effort).toBe("high");
	});

	it("prefers dynamic cache entries when mode is enabled", () => {
		__setModelCapabilitiesCacheForTests([
			{
				model: "gpt-5-codex",
				supportedReasoningEfforts: ["low", "high"],
				defaultReasoningEffort: "high",
				source: "dynamic",
				updatedAt: Date.now(),
			},
		]);

		const record = getModelCapabilityRecord("openai/gpt-5-codex", {
			mode: "safe",
		});
		expect(record.source).toBe("dynamic");
		expect(record.supportedReasoningEfforts).toEqual(["low", "high"]);
		expect(record.defaultReasoningEffort).toBe("high");
	});

	it("marks dynamic cache stale when old", () => {
		__setModelCapabilitiesCacheForTests([
			{
				model: "gpt-5.2-codex",
				supportedReasoningEfforts: ["low", "medium", "high"],
				defaultReasoningEffort: "high",
				source: "dynamic",
				updatedAt: Date.now(),
			},
		]);

		const nowSpy = vi.spyOn(Date, "now");
		const originalNow = Date.now();
		nowSpy.mockReturnValue(originalNow + 700_000);

		const record = getModelCapabilityRecord("gpt-5.2-codex", {
			mode: "safe",
		});
		expect(record.source).toBe("dynamic_stale");
	});

	it("prepareModelCapabilitiesFor skips network in test mode", async () => {
		const fetchSpy = vi.fn();
		globalThis.fetch = fetchSpy as unknown as typeof fetch;

		await prepareModelCapabilitiesFor("gpt-5-codex", { mode: "safe" });
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it("prepareModelCapabilitiesFor refreshes dynamic cache when allowed", async () => {
		process.env.VITEST = "false";
		process.env.NODE_ENV = "production";

		const payload = {
			models: [
				{
					slug: "gpt-5-codex",
					default_reasoning_level: "high",
					supported_reasoning_levels: [{ effort: "low" }, { effort: "high" }],
				},
				{
					display_name: "gpt-5.2-codex",
					default_reasoning_level: "xhigh",
					supported_reasoning_levels: [{ effort: "medium" }, { effort: "xhigh" }],
				},
			],
		};
		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			statusText: "OK",
			json: async () => payload,
		}) as unknown as typeof fetch;

		await prepareModelCapabilitiesFor("gpt-5-codex", {
			mode: "safe",
			cacheTtlMs: 1_000,
		});

		const codexRecord = getModelCapabilityRecord("gpt-5-codex", {
			mode: "safe",
		});
		expect(codexRecord.source).toBe("dynamic");
		expect(codexRecord.supportedReasoningEfforts).toEqual(["low", "high"]);

		const codex52Record = getModelCapabilityRecord("gpt-5.2-codex", {
			mode: "safe",
		});
		expect(codex52Record.supportedReasoningEfforts).toEqual(["medium", "xhigh"]);
	});

	it("prepareModelCapabilitiesFor tolerates refresh failures", async () => {
		process.env.VITEST = "false";
		process.env.NODE_ENV = "production";

		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: false,
			status: 503,
			statusText: "Service Unavailable",
			json: async () => ({}),
		}) as unknown as typeof fetch;

		await expect(
			prepareModelCapabilitiesFor("gpt-5-codex", { mode: "safe" }),
		).resolves.toBeUndefined();

		const record = getModelCapabilityRecord("gpt-5-codex", { mode: "safe" });
		expect(record.source).toBe("static");
	});
});
