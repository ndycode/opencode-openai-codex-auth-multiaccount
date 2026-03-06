import type { ConfigOptions } from "./types.js";

type ProviderModelVariant = ConfigOptions & {
	disabled?: boolean;
	[key: string]: unknown;
};

export type ProviderModelConfig = {
	name?: string;
	limit?: {
		context?: number;
		output?: number;
	};
	modalities?: {
		input?: string[];
		output?: string[];
	};
	options?: (ConfigOptions & Record<string, unknown>) | undefined;
	variants?: Record<string, ProviderModelVariant | undefined>;
	[key: string]: unknown;
};

export type ProviderConfigLike = {
	options?: Record<string, unknown>;
	models?: Record<string, ProviderModelConfig>;
	[key: string]: unknown;
};

const GPT_5_4_MODEL_ID = "gpt-5.4";
const GPT_5_4_TEMPLATE_IDS = [
	"gpt-5.2",
	"gpt-5.1",
	"gpt-5-codex",
	"gpt-5.1-codex",
	"gpt-5.1-codex-max",
	"gpt-5.1-codex-mini",
] as const;

const GPT_5_4_VARIANTS: Record<string, ProviderModelVariant> = {
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
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object";
}

function cloneProviderModelConfig(model: ProviderModelConfig): ProviderModelConfig {
	return structuredClone(model);
}

function isProviderConfigLike(value: unknown): value is ProviderConfigLike {
	if (!isRecord(value)) return false;
	return value.models === undefined || isRecord(value.models);
}

function resolveTemplateModel(
	models: Record<string, ProviderModelConfig>,
): ProviderModelConfig | undefined {
	for (const modelId of GPT_5_4_TEMPLATE_IDS) {
		const candidate = models[modelId];
		if (candidate && isRecord(candidate)) {
			return candidate;
		}
	}

	return Object.values(models).find((candidate) => isRecord(candidate));
}

function buildGpt54Model(template: ProviderModelConfig): ProviderModelConfig {
	const restored = cloneProviderModelConfig(template);
	restored.id = GPT_5_4_MODEL_ID;
	restored.name = "GPT 5.4 (OAuth)";
	if (!restored.providerID) {
		restored.providerID = "openai";
	}

	const limit = isRecord(restored.limit) ? { ...restored.limit } : {};
	limit.context = 1_047_576;
	limit.output = 128_000;
	restored.limit = limit;

	if (isRecord(restored.options)) {
		const options = { ...restored.options };
		delete options.reasoningEffort;
		delete options.reasoningSummary;
		delete options.textVerbosity;
		restored.options = options;
	}

	restored.variants = cloneProviderModelConfig(GPT_5_4_VARIANTS) as Record<
		string,
		ProviderModelVariant | undefined
	>;

	return restored;
}

/**
 * Restore exact OpenAI models that OpenCode's built-in Codex auth plugin strips
 * from the provider model registry before external plugins run. The restored
 * entry is cloned from an existing OpenAI model so the host keeps the SDK
 * fields it expects when listing and selecting models.
 */
export function restoreExactOpenAIModels(provider: unknown): string[] {
	if (!isProviderConfigLike(provider) || !provider.models) {
		return [];
	}

	const restored: string[] = [];
	if (!provider.models[GPT_5_4_MODEL_ID]) {
		const template = resolveTemplateModel(provider.models);
		if (!template) {
			return restored;
		}
		provider.models[GPT_5_4_MODEL_ID] = buildGpt54Model(template);
		restored.push(GPT_5_4_MODEL_ID);
	}

	return restored;
}
