import { describe, expect, it } from "vitest";
import {
	restoreExactOpenAIModels,
	type ProviderConfigLike,
	type ProviderModelConfig,
} from "../lib/provider-models.js";

function createProvider(models: Record<string, ProviderModelConfig>): ProviderConfigLike {
	return {
		options: {
			reasoningEffort: "medium",
		},
		models,
	};
}

describe("restoreExactOpenAIModels", () => {
	it("restores the missing exact gpt-5.4 model", () => {
		const provider = createProvider({
			"gpt-5-codex": {
				name: "GPT 5 Codex (OAuth)",
				limit: { context: 272_000, output: 128_000 },
			},
			"gpt-5.2": {
				name: "GPT 5.2 (OAuth)",
				limit: { context: 272_000, output: 128_000 },
				modalities: {
					input: ["text", "image"],
					output: ["text"],
				},
			},
		});

		const restored = restoreExactOpenAIModels(provider);

		expect(restored).toEqual(["gpt-5.4"]);
		expect(provider.models?.["gpt-5.4"]).toMatchObject({
			id: "gpt-5.4",
			providerID: "openai",
			name: "GPT 5.4 (OAuth)",
			limit: {
				context: 1_047_576,
				output: 128_000,
			},
			modalities: {
				input: ["text", "image"],
				output: ["text"],
			},
			variants: {
				none: {
					reasoningEffort: "none",
					reasoningSummary: "auto",
					textVerbosity: "medium",
				},
				low: {
					reasoningEffort: "low",
					reasoningSummary: "auto",
					textVerbosity: "medium",
				},
				medium: {
					reasoningEffort: "medium",
					reasoningSummary: "auto",
					textVerbosity: "medium",
				},
				high: {
					reasoningEffort: "high",
					reasoningSummary: "detailed",
					textVerbosity: "medium",
				},
				xhigh: {
					reasoningEffort: "xhigh",
					reasoningSummary: "detailed",
					textVerbosity: "medium",
				},
			},
		});
	});

	it("does not overwrite an existing exact gpt-5.4 model", () => {
		const existingModel: ProviderModelConfig = {
			name: "Custom GPT 5.4",
			limit: {
				context: 222_222,
				output: 33_333,
			},
		};
		const provider = createProvider({
			"gpt-5.4": existingModel,
		});

		const restored = restoreExactOpenAIModels(provider);

		expect(restored).toEqual([]);
		expect(provider.models?.["gpt-5.4"]).toBe(existingModel);
	});

	it("clones restored model config for each provider mutation", () => {
		const firstProvider = createProvider({
			"gpt-5.2": {
				name: "GPT 5.2 (OAuth)",
				limit: { context: 272_000, output: 128_000 },
			},
		});
		const secondProvider = createProvider({
			"gpt-5.2": {
				name: "GPT 5.2 (OAuth)",
				limit: { context: 272_000, output: 128_000 },
			},
		});

		restoreExactOpenAIModels(firstProvider);
		restoreExactOpenAIModels(secondProvider);

		const firstModel = firstProvider.models?.["gpt-5.4"];
		const secondModel = secondProvider.models?.["gpt-5.4"];

		if (!firstModel || !secondModel || !firstModel.variants || !secondModel.variants) {
			throw new Error("Expected both providers to receive gpt-5.4 variants");
		}

		firstModel.variants.high = {
			reasoningEffort: "low",
			reasoningSummary: "concise",
			textVerbosity: "low",
		};

		expect(secondModel.variants.high).toEqual({
			reasoningEffort: "high",
			reasoningSummary: "detailed",
			textVerbosity: "medium",
		});
	});

	it("preserves SDK model metadata required by the OpenCode runtime", () => {
		const provider = createProvider({
			"gpt-5.2": {
				id: "gpt-5.2",
				providerID: "openai",
				api: {
					id: "responses",
					url: "https://api.openai.com/v1",
					npm: "@ai-sdk/openai",
				},
				name: "GPT 5.2 (OAuth)",
				capabilities: {
					temperature: false,
					reasoning: true,
					attachment: true,
					toolcall: true,
					input: {
						text: true,
						audio: false,
						image: true,
						video: false,
						pdf: true,
					},
					output: {
						text: true,
						audio: false,
						image: false,
						video: false,
						pdf: false,
					},
				},
				cost: {
					input: 0,
					output: 0,
					cache: {
						read: 0,
						write: 0,
					},
				},
				limit: {
					context: 272_000,
					output: 128_000,
				},
				status: "active",
				options: {},
				headers: {},
			},
		});

		restoreExactOpenAIModels(provider);

		expect(provider.models?.["gpt-5.4"]).toMatchObject({
			id: "gpt-5.4",
			providerID: "openai",
			api: {
				id: "responses",
				url: "https://api.openai.com/v1",
				npm: "@ai-sdk/openai",
			},
			capabilities: {
				reasoning: true,
				attachment: true,
			},
			status: "active",
		});
	});

	it("ignores invalid provider inputs", () => {
		expect(restoreExactOpenAIModels(undefined)).toEqual([]);
		expect(restoreExactOpenAIModels(null)).toEqual([]);
		expect(restoreExactOpenAIModels({})).toEqual([]);
		expect(restoreExactOpenAIModels({ models: null })).toEqual([]);
	});
});
