import { TOOL_REMAP_MESSAGE } from "./codex.mjs";

/**
 * Normalize model name to Codex-supported variants
 * @param {string} model - Original model name
 * @returns {string} Normalized model name
 */
export function normalizeModel(model) {
	if (!model) return "gpt-5";

	if (model.includes("codex")) {
		return "gpt-5-codex";
	}
	if (model.includes("gpt-5")) {
		return "gpt-5";
	}

	return "gpt-5"; // Default fallback
}

/**
 * Extract configuration for a specific model
 * Merges global options with model-specific options (model-specific takes precedence)
 * @param {string} modelName - Model name (e.g., "gpt-5-codex")
 * @param {object} userConfig - Full user configuration object
 * @returns {object} Merged configuration for this model
 */
export function getModelConfig(modelName, userConfig = {}) {
	const globalOptions = userConfig.global || {};
	const modelOptions = userConfig.models?.[modelName]?.options || {};

	// Model-specific options override global options
	return { ...globalOptions, ...modelOptions };
}

/**
 * Configure reasoning parameters based on model variant and user config
 *
 * NOTE: This plugin follows Codex CLI defaults instead of opencode defaults because:
 * - We're accessing the ChatGPT backend API (not OpenAI Platform API)
 * - opencode explicitly excludes gpt-5-codex from automatic reasoning configuration
 * - Codex CLI has been thoroughly tested against this backend
 *
 * @param {string} originalModel - Original model name before normalization
 * @param {object} userConfig - User configuration object
 * @returns {object} Reasoning configuration
 */
export function getReasoningConfig(originalModel, userConfig = {}) {
	const isLightweight =
		originalModel?.includes("nano") || originalModel?.includes("mini");
	const isCodex = originalModel?.includes("codex");

	// Default based on model type (Codex CLI defaults)
	const defaultEffort = isLightweight ? "minimal" : "medium";

	// Get user-requested effort
	let effort = userConfig.reasoningEffort || defaultEffort;

	// Normalize "minimal" to "low" for gpt-5-codex
	// Codex CLI does not provide a "minimal" preset for gpt-5-codex
	// (only low/medium/high - see model_presets.rs:20-40)
	if (isCodex && effort === "minimal") {
		effort = "low";
	}

	return {
		effort,
		summary: userConfig.reasoningSummary || "auto", // Changed from "detailed" to match Codex CLI
	};
}

/**
 * Filter input array to remove stored conversation history references
 * @param {Array} input - Original input array
 * @returns {Array} Filtered input array
 */
export function filterInput(input) {
	if (!Array.isArray(input)) return input;

	return input.filter((item) => {
		// Keep items without IDs (new messages)
		if (!item.id) return true;
		// Remove items with response/result IDs (rs_*)
		if (item.id?.startsWith("rs_")) return false;
		return true;
	});
}

/**
 * Add tool remapping message to input if tools are present
 * @param {Array} input - Input array
 * @param {boolean} hasTools - Whether tools are present in request
 * @returns {Array} Input array with tool remap message prepended if needed
 */
export function addToolRemapMessage(input, hasTools) {
	if (!hasTools || !Array.isArray(input)) return input;

	const toolRemapMessage = {
		type: "message",
		role: "developer",
		content: [
			{
				type: "input_text",
				text: TOOL_REMAP_MESSAGE,
			},
		],
	};

	return [toolRemapMessage, ...input];
}

/**
 * Transform request body for Codex API
 *
 * NOTE: Configuration follows Codex CLI patterns instead of opencode defaults:
 * - opencode sets textVerbosity="low" for gpt-5, but Codex CLI uses "medium"
 * - opencode excludes gpt-5-codex from reasoning configuration
 * - This plugin uses store=false (stateless), requiring encrypted reasoning content
 *
 * @param {object} body - Original request body
 * @param {string} codexInstructions - Codex system instructions
 * @param {object} userConfig - User configuration from loader
 * @returns {object} Transformed request body
 */
export function transformRequestBody(body, codexInstructions, userConfig = {}) {
	const originalModel = body.model;
	const normalizedModel = normalizeModel(body.model);

	// Get model-specific configuration (merges global + per-model options)
	const modelConfig = getModelConfig(normalizedModel, userConfig);

	// Normalize model name
	body.model = normalizedModel;

	// Codex required fields
	body.store = false;
	body.stream = true;
	body.instructions = codexInstructions;

	// Filter and transform input
	if (body.input && Array.isArray(body.input)) {
		body.input = filterInput(body.input);
		body.input = addToolRemapMessage(body.input, !!body.tools);
	}

	// Configure reasoning (use model-specific config)
	const reasoningConfig = getReasoningConfig(originalModel, modelConfig);
	body.reasoning = {
		...body.reasoning,
		...reasoningConfig,
	};

	// Configure text verbosity (support user config)
	// Default: "medium" (matches Codex CLI default for all GPT-5 models)
	body.text = {
		...body.text,
		verbosity: modelConfig.textVerbosity || "medium",
	};

	// Add include for encrypted reasoning content
	// Default: ["reasoning.encrypted_content"] (required for stateless operation with store=false)
	// This allows reasoning context to persist across turns without server-side storage
	body.include = modelConfig.include || ["reasoning.encrypted_content"];

	// Remove unsupported parameters
	body.max_output_tokens = undefined;
	body.max_completion_tokens = undefined;

	return body;
}
