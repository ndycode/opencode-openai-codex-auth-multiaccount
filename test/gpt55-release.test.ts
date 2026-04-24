import { describe, expect, it } from "vitest";
import { getModelFamily } from "../lib/prompts/codex.js";
import {
	normalizeModel,
	getReasoningConfig,
} from "../lib/request/request-transformer.js";
import {
	getNormalizedModel,
	isKnownModel,
	MODEL_MAP,
} from "../lib/request/helpers/model-map.js";
import { resolveUnsupportedCodexFallbackModel } from "../lib/request/fetch-helpers.js";

describe("GPT-5.5 activation", () => {
	it("maps GPT-5.5 aliases to the public Codex model ids", () => {
		expect(MODEL_MAP["gpt-5.5"]).toBe("gpt-5.5");
		expect(MODEL_MAP["gpt-5.5-pro"]).toBe("gpt-5.5-pro");
		expect(MODEL_MAP["gpt-5-xhigh"]).toBe("gpt-5.5");
		expect(getNormalizedModel("gpt-5.5")).toBe("gpt-5.5");
		expect(getNormalizedModel("gpt-5-xhigh")).toBe("gpt-5.5");
		expect(getNormalizedModel("gpt-5.5-pro-high")).toBe("gpt-5.5-pro");
		expect(isKnownModel("gpt-5.5")).toBe(true);
		expect(isKnownModel("gpt-5-xhigh")).toBe(true);
		expect(isKnownModel("gpt-5.5-pro-xhigh")).toBe(true);
	});

	it("normalizes provider-prefixed model aliases", () => {
		expect(normalizeModel("openai/gpt-5.5")).toBe("gpt-5.5");
		expect(normalizeModel("openai/gpt-5.5-high")).toBe("gpt-5.5");
		expect(normalizeModel("openai/gpt-5.5-pro-high")).toBe(
			"gpt-5.5-pro",
		);
	});

	it("uses the same reasoning rules as the prior latest general/pro families", () => {
		expect(getReasoningConfig("gpt-5.5", { reasoningEffort: "none" }).effort).toBe(
			"none",
		);
		expect(getReasoningConfig("gpt-5.5", {}).effort).toBe("high");
		expect(
			getReasoningConfig("gpt-5.5-pro", { reasoningEffort: "low" }).effort,
		).toBe("medium");
	});

	it("routes GPT-5.5 prompts through the existing GPT-5.4 prompt families", () => {
		expect(getModelFamily("gpt-5.5")).toBe("gpt-5.4");
		expect(getModelFamily("gpt-5.5-high")).toBe("gpt-5.4");
		expect(getModelFamily("gpt-5.5-pro")).toBe("gpt-5.4-pro");
		expect(getModelFamily("gpt-5.5-pro-high")).toBe("gpt-5.4-pro");
	});

	it("falls back from GPT-5.5 Pro to GPT-5.5 when entitlement fallback is enabled", () => {
		const fallback = resolveUnsupportedCodexFallbackModel({
			requestedModel: "gpt-5.5-pro",
			errorBody: {
				error: {
					code: "model_not_supported_with_chatgpt_account",
					message:
						"The 'gpt-5.5-pro' model is not supported when using Codex with a ChatGPT account.",
				},
			},
			attemptedModels: ["gpt-5.5-pro"],
			fallbackOnUnsupportedCodexModel: true,
			fallbackToGpt52OnUnsupportedGpt53: false,
		});

		expect(fallback).toBe("gpt-5.5");
	});

	it("falls back from GPT-5.5 to GPT-5.4 when GPT-5.5 is unsupported for ChatGPT accounts", () => {
		const fallback = resolveUnsupportedCodexFallbackModel({
			requestedModel: "gpt-5.5-medium",
			errorBody: {
				detail:
					"The 'gpt-5.5' model is not supported when using Codex with a ChatGPT account.",
			},
			attemptedModels: ["gpt-5.5"],
			fallbackOnUnsupportedCodexModel: true,
			fallbackToGpt52OnUnsupportedGpt53: false,
		});

		expect(fallback).toBe("gpt-5.4");
	});

	it("does not fallback when GPT-5.5 entitlement fallback is disabled", () => {
		const fallback = resolveUnsupportedCodexFallbackModel({
			requestedModel: "gpt-5.5-pro",
			errorBody: {
				error: {
					code: "model_not_supported_with_chatgpt_account",
					message:
						"The 'gpt-5.5-pro' model is not supported when using Codex with a ChatGPT account.",
				},
			},
			attemptedModels: ["gpt-5.5-pro"],
			fallbackOnUnsupportedCodexModel: false,
			fallbackToGpt52OnUnsupportedGpt53: true,
		});

		expect(fallback).toBeUndefined();
	});
});
