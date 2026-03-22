/**
 * Model Configuration Map
 *
 * Maps model config IDs to their normalized API model names.
 * Only includes exact config IDs that OpenCode will pass to the plugin.
 */

/**
 * Map of config model IDs to normalized API model names
 *
 * Key: The model ID as specified in opencode.json config
 * Value: The normalized model name to send to the API
 */
const DATED_ALIAS_EFFORT_SUFFIXES = [
	"",
	"-none",
	"-low",
	"-medium",
	"-high",
	"-xhigh",
] as const;
const GPT_54_SNAPSHOT_DATE = "2026-03-05" as const;

function expandDatedAliases(prefix: string, target: string): Record<string, string> {
	return Object.fromEntries(
		DATED_ALIAS_EFFORT_SUFFIXES.map((suffix) => [`${prefix}${suffix}`, target]),
	);
}

export const MODEL_MAP: Record<string, string> = {
	// ============================================================================
	// GPT-5 Codex Models (canonical stable family)
	// ============================================================================
	"gpt-5-codex": "gpt-5-codex",
	"gpt-5-codex-none": "gpt-5-codex",
	"gpt-5-codex-minimal": "gpt-5-codex",
	"gpt-5-codex-low": "gpt-5-codex",
	"gpt-5-codex-medium": "gpt-5-codex",
	"gpt-5-codex-high": "gpt-5-codex",
	"gpt-5-codex-xhigh": "gpt-5-codex",

	// ============================================================================
	// GPT-5.3 Codex Spark Models (legacy aliases)
	// ============================================================================
	"gpt-5.3-codex-spark": "gpt-5-codex",
	"gpt-5.3-codex-spark-low": "gpt-5-codex",
	"gpt-5.3-codex-spark-medium": "gpt-5-codex",
	"gpt-5.3-codex-spark-high": "gpt-5-codex",
	"gpt-5.3-codex-spark-xhigh": "gpt-5-codex",

	// ============================================================================
	// GPT-5.3 Codex Models (legacy aliases)
	// ============================================================================
	"gpt-5.3-codex": "gpt-5-codex",
	"gpt-5.3-codex-low": "gpt-5-codex",
	"gpt-5.3-codex-medium": "gpt-5-codex",
	"gpt-5.3-codex-high": "gpt-5-codex",
	"gpt-5.3-codex-xhigh": "gpt-5-codex",

	// ============================================================================
	// GPT-5.1 Codex Models (legacy aliases)
	// ============================================================================
	"gpt-5.1-codex": "gpt-5-codex",
	"gpt-5.1-codex-low": "gpt-5-codex",
	"gpt-5.1-codex-medium": "gpt-5-codex",
	"gpt-5.1-codex-high": "gpt-5-codex",

	// ============================================================================
	// GPT-5.1 Codex Max Models
	// ============================================================================
	"gpt-5.1-codex-max": "gpt-5.1-codex-max",
	"gpt-5.1-codex-max-low": "gpt-5.1-codex-max",
	"gpt-5.1-codex-max-medium": "gpt-5.1-codex-max",
	"gpt-5.1-codex-max-high": "gpt-5.1-codex-max",
	"gpt-5.1-codex-max-xhigh": "gpt-5.1-codex-max",

	// ============================================================================
	// GPT-5.4 Models (latest general-purpose family)
	// ============================================================================
	"gpt-5.4": "gpt-5.4",
	"gpt-5.4-none": "gpt-5.4",
	"gpt-5.4-low": "gpt-5.4",
	"gpt-5.4-medium": "gpt-5.4",
	"gpt-5.4-high": "gpt-5.4",
	"gpt-5.4-xhigh": "gpt-5.4",
	...expandDatedAliases(`gpt-5.4-${GPT_54_SNAPSHOT_DATE}`, "gpt-5.4"),

	// ============================================================================
	// GPT-5.4 Pro Models (optional/manual config)
	// ============================================================================
	"gpt-5.4-pro": "gpt-5.4-pro",
	"gpt-5.4-pro-medium": "gpt-5.4-pro",
	"gpt-5.4-pro-high": "gpt-5.4-pro",
	"gpt-5.4-pro-xhigh": "gpt-5.4-pro",
	...expandDatedAliases(`gpt-5.4-pro-${GPT_54_SNAPSHOT_DATE}`, "gpt-5.4-pro"),

	// ============================================================================
	// GPT-5.4 Mini Models (latest efficient family)
	// ============================================================================
	"gpt-5.4-mini": "gpt-5.4-mini",
	"gpt-5.4-mini-none": "gpt-5.4-mini",
	"gpt-5.4-mini-low": "gpt-5.4-mini",
	"gpt-5.4-mini-medium": "gpt-5.4-mini",
	"gpt-5.4-mini-high": "gpt-5.4-mini",
	"gpt-5.4-mini-xhigh": "gpt-5.4-mini",
	...expandDatedAliases(`gpt-5.4-mini-${GPT_54_SNAPSHOT_DATE}`, "gpt-5.4-mini"),

	// ============================================================================
	// GPT-5.4 Nano Models (lightweight efficient family)
	// ============================================================================
	"gpt-5.4-nano": "gpt-5.4-nano",
	"gpt-5.4-nano-none": "gpt-5.4-nano",
	"gpt-5.4-nano-low": "gpt-5.4-nano",
	"gpt-5.4-nano-medium": "gpt-5.4-nano",
	"gpt-5.4-nano-high": "gpt-5.4-nano",
	"gpt-5.4-nano-xhigh": "gpt-5.4-nano",
	...expandDatedAliases(`gpt-5.4-nano-${GPT_54_SNAPSHOT_DATE}`, "gpt-5.4-nano"),

	// ============================================================================
	// GPT-5.2 Models (supports none/low/medium/high/xhigh per OpenAI API docs)
	// ============================================================================
	"gpt-5.2": "gpt-5.2",
	"gpt-5.2-none": "gpt-5.2",
	"gpt-5.2-low": "gpt-5.2",
	"gpt-5.2-medium": "gpt-5.2",
	"gpt-5.2-high": "gpt-5.2",
	"gpt-5.2-xhigh": "gpt-5.2",

	// ============================================================================
	// GPT-5.2 Codex Models (legacy aliases)
	// ============================================================================
	"gpt-5.2-codex": "gpt-5-codex",
	"gpt-5.2-codex-low": "gpt-5-codex",
	"gpt-5.2-codex-medium": "gpt-5-codex",
	"gpt-5.2-codex-high": "gpt-5-codex",
	"gpt-5.2-codex-xhigh": "gpt-5-codex",

	// ============================================================================
	// GPT-5.1 Codex Mini Models
	// ============================================================================
	"gpt-5.1-codex-mini": "gpt-5.1-codex-mini",
	"gpt-5.1-codex-mini-medium": "gpt-5.1-codex-mini",
	"gpt-5.1-codex-mini-high": "gpt-5.1-codex-mini",

	// ============================================================================
	// GPT-5.1 General Purpose Models (supports none/low/medium/high per OpenAI API docs)
	// ============================================================================
	"gpt-5.1": "gpt-5.1",
	"gpt-5.1-none": "gpt-5.1",
	"gpt-5.1-low": "gpt-5.1",
	"gpt-5.1-medium": "gpt-5.1",
	"gpt-5.1-high": "gpt-5.1",
	"gpt-5.1-chat-latest": "gpt-5.1",

	// ============================================================================
	// GPT-5 Codex alias (legacy/case variants)
	// ============================================================================
	"gpt_5_codex": "gpt-5-codex",

	// ============================================================================
	// GPT-5 Codex Mini Models (LEGACY - maps to gpt-5.1-codex-mini)
	// ============================================================================
	"codex-mini-latest": "gpt-5.1-codex-mini",
	"gpt-5-codex-mini": "gpt-5.1-codex-mini",
	"gpt-5-codex-mini-medium": "gpt-5.1-codex-mini",
	"gpt-5-codex-mini-high": "gpt-5.1-codex-mini",

	// ============================================================================
	// GPT-5 General Purpose Models (LEGACY - maps to gpt-5.4 latest)
	// ============================================================================
	"gpt-5": "gpt-5.4",
	"gpt-5-mini": "gpt-5.4-mini",
	"gpt-5-nano": "gpt-5.4-nano",
};

/**
 * Get normalized model name from config ID
 *
 * @param modelId - Model ID from config (e.g., "gpt-5.1-codex-low")
 * @returns Normalized model name (e.g., "gpt-5.1-codex") or undefined if not found
 */
export function getNormalizedModel(modelId: string): string | undefined {
	try {
		if (Object.hasOwn(MODEL_MAP, modelId)) {
			return MODEL_MAP[modelId];
		}

		const lowerModelId = modelId.toLowerCase();
		const match = Object.keys(MODEL_MAP).find(
			(key) => key.toLowerCase() === lowerModelId,
		);

		return match ? MODEL_MAP[match] : undefined;
	} catch {
		return undefined;
	}
}

/**
 * Check if a model ID is in the model map
 *
 * @param modelId - Model ID to check
 * @returns True if model is in the map
 */
export function isKnownModel(modelId: string): boolean {
	return getNormalizedModel(modelId) !== undefined;
}
