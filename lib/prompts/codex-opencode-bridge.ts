/**
 * Codex-OpenCode Bridge Prompt
 *
 * This prompt bridges Codex CLI instructions to the OpenCode environment.
 * It focuses on runtime-tool authority, schema discipline, and execution guardrails
 * to avoid tool-name drift across OpenCode versions.
 *
 * Token Count: ~450 tokens (~90% reduction vs full OpenCode prompt)
 */

import type { HashlineBridgeHintsMode } from "../types.js";

export const CODEX_OPENCODE_BRIDGE = `# Codex Running in OpenCode

You are running Codex through OpenCode, an open-source terminal coding assistant.

## Runtime Tooling Rule (Highest Priority)

<critical_rule priority="0">
Treat the runtime tool manifest as the only authoritative tool list.
- Call ONLY tool names listed in that manifest.
- Do NOT translate, alias, or rename tool names.
- If a base instruction references a tool name that is not listed, ignore that alias and use the listed names only.
</critical_rule>

## Tool-Call Guardrails

- Follow the current tool schema exactly for parameters.
- Do not invent wrapper namespaces unless they are explicitly listed as tools.
- If no explicit parallel helper tool is listed, run calls sequentially.
- If a tool call fails validation, correct arguments to match schema and retry.
- If a \`task\` tool is available, always include \`run_in_background\` in every call (\`false\` for normal delegation, \`true\` only for explicit parallel exploration).
- For legacy oldString/newString edits, oldString must be literal text from the current file (no unresolved placeholders like \${TARGET_SNIPPET}).

## Planning & Modes

- Never call \`update_plan\`, \`read_plan\`, or similarly named aliases.
- Use planning tools only if they are explicitly listed in the runtime manifest.
- \`request_user_input\` is Plan-mode only; never call it in Default mode.

## Path & Execution Discipline

- Follow per-tool path conventions from the active schema; do not assume absolute/relative behavior.
- Prefer specialized tools over shell when an equivalent listed tool exists.
- Use non-destructive checks before destructive commands.

## Verification Checklist

Before each tool call:
1. Is the tool name exactly listed in the runtime manifest?
2. Do arguments match the listed schema?
3. Am I avoiding unlisted aliases and wrapper namespaces?
4. Am I following mode/path constraints for this environment?

If any answer is NO, correct it before proceeding.

## OpenCode Working Style

**Communication:**
- Send brief preambles before tool calls.
- Provide concise progress updates during longer tasks.

**Execution:**
- Continue working until the user request is fully resolved.
- Do not return partial solutions unless blocked.

**Code Approach:**
- New projects: be creative and deliberate.
- Existing codebases: make precise, minimal changes aligned to request.

**Testing:**
- If tests exist, run focused tests first, then broader validation.

## What Remains from Codex

Sandbox policies, approvals, final formatting, git protocols, and file reference formats still follow Codex instructions.

## Approvals & Safety

- Treat destructive commands (for example \`rm\`, \`git reset --hard\`) as requiring explicit user request or approval.
- Never run \`git reset --hard\`, \`git checkout --\`, or force deletes unless explicitly requested.
- When uncertain, prefer non-destructive verification first.`;

const MAX_MANIFEST_TOOLS = 32;
const HASHLINE_TOOL_PATTERN = /(hashline|line[_-]?hash|anchor[_-]?insert)/i;
type RuntimeToolCapabilitySummary = {
	hasHashlineCapabilities?: boolean;
	hasApplyPatch?: boolean;
	hasPatch?: boolean;
	hasGenericEdit?: boolean;
	hasReplace?: boolean;
	hasUpdatePlan?: boolean;
	hasTodoWrite?: boolean;
	hasTaskDelegation?: boolean;
	supportsBackgroundDelegation?: boolean;
	primaryEditStrategy?: "hashline-like" | "edit" | "patch" | "apply_patch" | "replace" | "none";
};
const HASHLINE_BETA_BRIDGE_SECTION = `## Hashline Edit Preference (Beta)

- If runtime tools include hashline-style edit tools, prefer them for targeted edits.
- Keep patch/edit for broad structural rewrites or when hashline tools are absent.
- On hash mismatch, re-read before retrying to avoid stale-anchor edits.`;

const HASHLINE_STRICT_BRIDGE_SECTION = `## Hashline Edit Policy (Strict)

- If runtime tools include hashline-style edit tools, use them first for targeted edits.
- Do not default to patch/edit for small in-place edits when hashline tools are available.
- Re-read and retry with fresh anchors on hash mismatch before switching strategy.
- Use patch/edit only for broad structural rewrites or when hashline tools are absent.`;

const HASHLINE_BETA_BRIDGE_SECTION_INACTIVE = `## Hashline Edit Preference (Beta) [Inactive]

- Hashline beta mode is enabled, but no hashline-style tools were found in the runtime manifest.
- Do not attempt unlisted hashline tool names.
- Use available edit tools from the runtime manifest instead.`;

const HASHLINE_STRICT_BRIDGE_SECTION_INACTIVE = `## Hashline Edit Policy (Strict) [Inactive]

- Strict hashline mode is enabled, but no hashline-style tools were found in the runtime manifest.
- Do not attempt unlisted hashline tool names.
- Use available edit tools from the runtime manifest for targeted edits.`;

const normalizeRuntimeToolNames = (toolNames: readonly string[]): string[] => {
	const unique = new Set<string>();
	for (const rawName of toolNames) {
		const name = rawName.trim();
		if (!name) continue;
		if (unique.size >= MAX_MANIFEST_TOOLS) break;
		unique.add(name);
	}
	return Array.from(unique);
};

const renderRuntimeAliasCompatibilitySection = (
	runtimeToolNames: readonly string[],
	capabilitySummary?: RuntimeToolCapabilitySummary,
): string | null => {
	if (runtimeToolNames.length === 0 && !capabilitySummary) return null;
	const lower = new Set(runtimeToolNames.map((name) => name.toLowerCase()));
	const hasApplyPatch =
		capabilitySummary?.hasApplyPatch ??
		(lower.has("apply_patch") || lower.has("applypatch"));
	const hasPatch = capabilitySummary?.hasPatch ?? lower.has("patch");
	const hasEdit = capabilitySummary?.hasGenericEdit ?? lower.has("edit");
	const hasTodoWrite = capabilitySummary?.hasTodoWrite ?? lower.has("todowrite");
	const hasUpdatePlan =
		capabilitySummary?.hasUpdatePlan ??
		(lower.has("update_plan") || lower.has("updateplan"));
	const hasTask = capabilitySummary?.hasTaskDelegation ?? lower.has("task");

	const lines: string[] = [];
	if (hasApplyPatch && !hasPatch && !hasEdit) {
		lines.push("- Runtime includes `apply_patch` but not `patch`/`edit`; use `apply_patch` exactly as listed.");
	}
	if (hasUpdatePlan && !hasTodoWrite) {
		lines.push("- Runtime includes `update_plan` but not `todowrite`; use `update_plan` exactly as listed.");
	}
	if (hasTask) {
		lines.push(
			"- Runtime includes `task`; always pass `run_in_background` (`false` for normal delegation, `true` only for explicit parallel exploration).",
		);
	}
	if (lines.length === 0) return null;

	return [
		"## Runtime Alias Compatibility",
		"When static alias guidance conflicts with the runtime manifest, the manifest wins.",
		...lines,
	].join("\n");
};

const renderRuntimeStrategySection = (
	capabilitySummary?: RuntimeToolCapabilitySummary,
): string | null => {
	if (!capabilitySummary) return null;
	const strategy = capabilitySummary.primaryEditStrategy ?? "none";
	const lines: string[] = [];
	if (strategy === "hashline-like") {
		lines.push("- Hashline-like edit capability detected; prefer it for targeted in-place edits.");
	} else if (strategy !== "none") {
		lines.push(`- Primary edit strategy detected: \`${strategy}\`. Use runtime-listed names exactly.`);
	}
	if (capabilitySummary.supportsBackgroundDelegation) {
		lines.push("- Task delegation supports explicit `run_in_background`; include it when the schema marks it required.");
	}
	if (lines.length === 0) return null;
	return [
		"## Runtime Tool Strategy",
		"These capabilities were inferred from the runtime manifest for this request.",
		...lines,
	].join("\n");
};

export const renderCodexOpenCodeBridge = (toolNames: readonly string[]): string => {
	const runtimeToolNames = normalizeRuntimeToolNames(toolNames);
	return renderCodexOpenCodeBridgeWithOptions(runtimeToolNames);
};

export const renderCodexOpenCodeBridgeWithOptions = (
	toolNames: readonly string[],
	options?: {
		hashlineBridgeHintsMode?: HashlineBridgeHintsMode | boolean;
		runtimeHasHashlineCapabilities?: boolean;
		runtimeCapabilitySummary?: RuntimeToolCapabilitySummary;
	},
): string => {
	const runtimeToolNames = normalizeRuntimeToolNames(toolNames);
	const hasHashlineRuntimeTool =
		(options?.runtimeCapabilitySummary?.hasHashlineCapabilities ?? false) ||
		(options?.runtimeHasHashlineCapabilities ?? false) ||
		runtimeToolNames.some((name) => HASHLINE_TOOL_PATTERN.test(name));

	const sections: string[] = [];
	if (runtimeToolNames.length > 0) {
		const manifest = [
			"## Runtime Tool Manifest",
			"The host has provided these exact tool names for this request:",
			...runtimeToolNames.map((name) => `- \`${name}\``),
			"",
			"Do not translate tool names. Use the exact names above.",
		].join("\n");
		sections.push(manifest);
	}

	const aliasCompat = renderRuntimeAliasCompatibilitySection(
		runtimeToolNames,
		options?.runtimeCapabilitySummary,
	);
	if (aliasCompat) {
		sections.push(aliasCompat);
	}
	const strategySection = renderRuntimeStrategySection(options?.runtimeCapabilitySummary);
	if (strategySection) {
		sections.push(strategySection);
	}

	const mode = normalizeHashlineBridgeHintsMode(options?.hashlineBridgeHintsMode);
	const effectiveMode: Exclude<HashlineBridgeHintsMode, "auto"> =
		mode === "auto" ? (hasHashlineRuntimeTool ? "hints" : "off") : mode;
	if (effectiveMode !== "off") {
		if (hasHashlineRuntimeTool) {
			sections.push(
				effectiveMode === "strict"
					? HASHLINE_STRICT_BRIDGE_SECTION
					: HASHLINE_BETA_BRIDGE_SECTION,
			);
		} else {
			sections.push(
				effectiveMode === "strict"
					? HASHLINE_STRICT_BRIDGE_SECTION_INACTIVE
					: HASHLINE_BETA_BRIDGE_SECTION_INACTIVE,
			);
		}
	}

	sections.push(CODEX_OPENCODE_BRIDGE);
	return sections.join("\n\n");
};

function normalizeHashlineBridgeHintsMode(
	mode: HashlineBridgeHintsMode | boolean | undefined,
): HashlineBridgeHintsMode {
	if (mode === true) return "hints";
	if (mode === false) return "off";
	if (mode === undefined) return "auto";
	if (mode === "strict" || mode === "hints" || mode === "auto") return mode;
	return "auto";
}

export interface CodexOpenCodeBridgeMeta {
	estimatedTokens: number;
	reductionVsCurrent: string;
	reductionVsToolRemap: string;
	protects: string[];
	omits: string[];
}

export const CODEX_OPENCODE_BRIDGE_META: CodexOpenCodeBridgeMeta = {
	estimatedTokens: 500,
	reductionVsCurrent: "88%",
	reductionVsToolRemap: "15%",
	protects: [
		"Tool name drift across OpenCode versions",
		"Tool alias hallucinations (apply_patch/patch mismatch)",
		"Planning alias hallucinations (update_plan/read_plan)",
		"Missing tool awareness",
		"Unknown tool-name hallucinations",
		"Premature yielding to user",
		"Over-modification of existing code",
		"Environment confusion",
	],
	omits: [
		"Sandbox details (in Codex)",
		"Formatting rules (in Codex)",
		"Tool schemas (in tool JSONs)",
		"Git protocols (in Codex)",
	],
};
