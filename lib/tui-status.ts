import type { Config } from "@opencode-ai/sdk/v2";

export type ReasoningVariant = "none" | "low" | "medium" | "high" | "xhigh";

export type CompactQuotaLimit = {
	label: string;
	leftPercent: number | null;
};

export type CompactQuotaStatus =
	| { type: "loading" }
	| { type: "missing" }
	| { type: "unavailable" }
	| {
			type: "ready";
			limits: readonly CompactQuotaLimit[];
			stale: boolean;
	  };

export type PromptStatusMessage = {
	role: "user" | "assistant";
	modelID?: string;
	variant?: string;
	userModel?: {
		modelID?: string;
		variant?: string;
	};
};

export type PromptStatusConfig = Pick<
	Config,
	"model" | "default_agent" | "agent" | "mode" | "provider"
>;

const variantSuffixes: ReasoningVariant[] = [
	"xhigh",
	"high",
	"medium",
	"low",
	"none",
];

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function getString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function normalizeReasoningVariant(
	value: string | undefined,
): ReasoningVariant | undefined {
	const normalized = value?.trim().toLowerCase();
	if (!normalized) return undefined;
	if (normalized === "extra-high" || normalized === "extra_high") {
		return "xhigh";
	}
	return variantSuffixes.find((variant) => variant === normalized);
}

export function inferReasoningVariantFromModelId(
	modelID: string | undefined,
): ReasoningVariant | undefined {
	const modelPart = modelID?.split("/").pop()?.toLowerCase();
	if (!modelPart) return undefined;
	for (const variant of variantSuffixes) {
		if (modelPart.endsWith(`-${variant}`)) return variant;
	}
	return undefined;
}

function splitProviderModel(model: string | undefined): {
	providerID: string;
	modelID: string;
} | undefined {
	const trimmed = model?.trim();
	if (!trimmed) return undefined;
	const slashIndex = trimmed.indexOf("/");
	if (slashIndex <= 0 || slashIndex === trimmed.length - 1) {
		return { providerID: "openai", modelID: trimmed };
	}
	return {
		providerID: trimmed.slice(0, slashIndex),
		modelID: trimmed.slice(slashIndex + 1),
	};
}

function resolveAgentConfig(
	config: PromptStatusConfig,
): Record<string, unknown> | undefined {
	const agentName = config.default_agent ?? "build";
	const agents = config.agent;
	const selectedAgent = agents?.[agentName];
	if (isRecord(selectedAgent)) return selectedAgent;
	if (isRecord(agents?.build)) return agents.build;
	if (isRecord(agents?.general)) return agents.general;
	const legacyMode = config.mode;
	if (isRecord(legacyMode?.build)) return legacyMode.build;
	return undefined;
}

function resolveProviderReasoningVariant(
	config: PromptStatusConfig,
	model: string | undefined,
): ReasoningVariant | undefined {
	const resolved = splitProviderModel(model);
	if (!resolved) return undefined;
	const provider = config.provider?.[resolved.providerID];
	const modelConfig = provider?.models?.[resolved.modelID];
	const modelOptions = isRecord(modelConfig?.options)
		? modelConfig.options
		: undefined;
	const providerOptions = isRecord(provider?.options)
		? provider.options
		: undefined;

	return (
		normalizeReasoningVariant(getString(modelOptions?.reasoningEffort)) ??
		normalizeReasoningVariant(getString(providerOptions?.reasoningEffort))
	);
}

function resolveAgentReasoningVariant(
	agent: Record<string, unknown> | undefined,
): ReasoningVariant | undefined {
	if (!agent) return undefined;
	const options = isRecord(agent.options) ? agent.options : undefined;
	return (
		normalizeReasoningVariant(getString(agent.variant)) ??
		normalizeReasoningVariant(getString(agent.reasoningEffort)) ??
		normalizeReasoningVariant(getString(options?.reasoningEffort))
	);
}

export function resolvePromptReasoningVariant(params: {
	messages?: readonly PromptStatusMessage[];
	config?: PromptStatusConfig;
}): ReasoningVariant | undefined {
	const messages = params.messages ?? [];
	for (let i = messages.length - 1; i >= 0; i -= 1) {
		const message = messages[i];
		if (!message) continue;
		if (message.role === "user") {
			const variant =
				normalizeReasoningVariant(message.userModel?.variant) ??
				inferReasoningVariantFromModelId(message.userModel?.modelID);
			if (variant) return variant;
			continue;
		}
		const variant =
			normalizeReasoningVariant(message.variant) ??
			inferReasoningVariantFromModelId(message.modelID);
		if (variant) return variant;
	}

	const config = params.config;
	if (!config) return undefined;
	const agent = resolveAgentConfig(config);
	const agentVariant = resolveAgentReasoningVariant(agent);
	if (agentVariant) return agentVariant;

	const agentModel = getString(agent?.model);
	const model = agentModel ?? config.model;
	return (
		inferReasoningVariantFromModelId(model) ??
		resolveProviderReasoningVariant(config, model)
	);
}

function isPercent(value: number | null): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

function formatQuotaLimit(limit: CompactQuotaLimit): string | undefined {
	if (!isPercent(limit.leftPercent)) return undefined;
	const label = limit.label.trim() || "quota";
	return `${label} ${limit.leftPercent}%`;
}

function formatQuota(quota: CompactQuotaStatus): string | undefined {
	if (quota.type === "ready") {
		const parts = quota.limits
			.map(formatQuotaLimit)
			.filter((part): part is string => Boolean(part));
		return parts.length > 0 ? parts.join(" · ") : undefined;
	}
	if (quota.type === "missing") return "no auth";
	if (quota.type === "unavailable") return "limits ?";
	if (quota.type === "loading") return "limits ...";
	return undefined;
}

function maxStatusChars(width: number | undefined): number {
	if (!width || !Number.isFinite(width)) return 32;
	if (width >= 120) return 34;
	if (width >= 96) return 30;
	if (width >= 78) return 24;
	if (width >= 60) return 18;
	return 10;
}

export function formatPromptStatusText(params: {
	variant?: ReasoningVariant;
	quota: CompactQuotaStatus;
	width?: number;
}): string {
	const variant = params.variant;
	const quota = formatQuota(params.quota);
	const candidates = [
		[variant, quota].filter(Boolean).join(" · "),
		variant,
		quota,
	].filter((candidate): candidate is string => Boolean(candidate));
	const maxChars = maxStatusChars(params.width);
	return candidates.find((candidate) => candidate.length <= maxChars) ?? "";
}
