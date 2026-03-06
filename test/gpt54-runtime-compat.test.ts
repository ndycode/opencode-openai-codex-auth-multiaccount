import { describe, expect, it } from "vitest";
import {
	getModelConfig,
	transformRequestBody,
} from "../lib/request/request-transformer.js";
import type { RequestBody, UserConfig } from "../lib/types.js";

const codexInstructions = "You are Codex.";

describe("GPT-5.4 runtime compatibility routing", () => {
	it("keeps the exact requested model when no targetModel override is configured", async () => {
		const gpt54Body: RequestBody = {
			model: "gpt-5.4",
			input: [],
		};
		const codexBody: RequestBody = {
			model: "gpt-5-codex",
			input: [],
		};
		const userConfig: UserConfig = {
			global: {},
			models: {
				"gpt-5.4": {
					options: {
						reasoningEffort: "high",
					},
				},
				"gpt-5-codex": {
					options: {
						reasoningEffort: "high",
					},
				},
			},
		};

		const gpt54Result = await transformRequestBody(
			gpt54Body,
			codexInstructions,
			userConfig,
		);
		const codexResult = await transformRequestBody(
			codexBody,
			codexInstructions,
			userConfig,
		);

		expect(gpt54Result.model).toBe("gpt-5.4");
		expect(codexResult.model).toBe("gpt-5-codex");
	});

	it("routes gpt-5-codex to the real gpt-5.4 upstream model", async () => {
		const body: RequestBody = {
			model: "gpt-5-codex",
			input: [],
		};
		const userConfig: UserConfig = {
			global: {},
			models: {
				"gpt-5-codex": {
					options: {
						reasoningEffort: "high",
						reasoningSummary: "detailed",
					},
				},
			},
		};

		const result = await transformRequestBody(
			body,
			codexInstructions,
			userConfig,
			true,
			false,
			"hybrid",
			30,
			{ "gpt-5-codex": "gpt-5.4" },
		);

		expect(result.model).toBe("gpt-5.4");
		expect(result.reasoning?.effort).toBe("high");
		expect(result.reasoning?.summary).toBe("detailed");
	});

	it("honors exact legacy selectors before base compatibility aliases", async () => {
		const body: RequestBody = {
			model: "gpt-5-codex-high",
			input: [],
		};
		const userConfig: UserConfig = {
			global: {},
			models: {
				"gpt-5-codex": {
					options: {
						reasoningEffort: "low",
						reasoningSummary: "auto",
					},
				},
				"gpt-5-codex-high": {
					options: {
						reasoningEffort: "high",
						reasoningSummary: "detailed",
					},
				},
			},
		};

		const result = await transformRequestBody(
			body,
			codexInstructions,
			userConfig,
			true,
			false,
			"hybrid",
			30,
			{
				"gpt-5-codex": "gpt-5.1",
				"gpt-5-codex-high": "gpt-5.4",
			},
		);

		expect(result.model).toBe("gpt-5.4");
		expect(result.reasoning?.effort).toBe("high");
		expect(result.reasoning?.summary).toBe("detailed");
	});

	it("normalizes provider-prefixed targetModel values to real gpt-5.4", async () => {
		const body: RequestBody = {
			model: "gpt-5-codex",
			input: [],
		};
		const userConfig: UserConfig = {
			global: {
				reasoningEffort: "none",
			},
			models: {},
		};

		const result = await transformRequestBody(
			body,
			codexInstructions,
			userConfig,
			true,
			false,
			"hybrid",
			30,
			{ "gpt-5-codex": "openai/gpt-5.4" },
		);

		expect(result.model).toBe("gpt-5.4");
		expect(result.reasoning?.effort).toBe("none");
	});

	it("supports explicit gpt-5.4-pro routing via the compatibility alias", async () => {
		const body: RequestBody = {
			model: "gpt-5-codex",
			input: [],
		};
		const userConfig: UserConfig = {
			global: {
				reasoningEffort: "none",
			},
			models: {},
		};

		const result = await transformRequestBody(
			body,
			codexInstructions,
			userConfig,
			true,
			false,
			"hybrid",
			30,
			{ "gpt-5-codex": "gpt-5.4-pro" },
		);

		expect(result.model).toBe("gpt-5.4-pro");
		expect(result.reasoning?.effort).toBe("low");
	});

	it("keeps config merging behavior unchanged for compatibility alias entries", () => {
		const userConfig: UserConfig = {
			global: {
				reasoningEffort: "medium",
				textVerbosity: "medium",
			},
			models: {
				"gpt-5-codex": {
					options: {
						reasoningSummary: "detailed",
					},
				},
			},
		};

		expect(getModelConfig("gpt-5-codex", userConfig)).toEqual({
			reasoningEffort: "medium",
			reasoningSummary: "detailed",
			textVerbosity: "medium",
		});
	});

	it("never overrides an exact gpt-5.4 selection with a compatibility alias", async () => {
		const body: RequestBody = {
			model: "gpt-5.4",
			input: [],
		};
		const userConfig: UserConfig = {
			global: {},
			models: {},
		};

		const result = await transformRequestBody(
			body,
			codexInstructions,
			userConfig,
			true,
			false,
			"hybrid",
			30,
			{ "gpt-5-codex": "gpt-5.1" },
		);

		expect(result.model).toBe("gpt-5.4");
	});
});
