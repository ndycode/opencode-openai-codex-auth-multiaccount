/**
 * `codex-next` tool — single best next action.
 * Extracted from `index.ts` per RC-1 Phase 2.
 */

import { tool, type ToolDefinition } from "@opencode-ai/plugin/tool";
import { loadAccounts } from "../storage.js";
import {
	recommendBeginnerNextAction,
} from "../ui/beginner.js";
import { formatUiHeader, formatUiItem } from "../ui/format.js";
import { normalizeToolOutputFormat, renderJsonOutput } from "../runtime.js";
import type { ToolContext } from "./index.js";

export function createCodexNextTool(ctx: ToolContext): ToolDefinition {
	const {
		resolveUiRuntime,
		resolveActiveIndex,
		toBeginnerAccountSnapshots,
		getBeginnerRuntimeSnapshot,
	} = ctx;
	return tool({
		description:
			"Show the single most recommended next action for beginners.",
		args: {
			format: tool.schema
				.string()
				.optional()
				.describe('Output format: "text" (default) or "json".'),
		},
		async execute({ format }: { format?: string } = {}) {
			const ui = resolveUiRuntime();
			const outputFormat = normalizeToolOutputFormat(format);
			const storage = await loadAccounts();
			const now = Date.now();
			const activeIndex =
				storage && storage.accounts.length > 0
					? resolveActiveIndex(storage, "codex")
					: 0;
			const snapshots = storage
				? toBeginnerAccountSnapshots(storage, activeIndex, now)
				: [];
			const action = recommendBeginnerNextAction({
				accounts: snapshots,
				now,
				runtime: getBeginnerRuntimeSnapshot(),
			});
			if (outputFormat === "json") {
				return renderJsonOutput({
					recommendedNextAction: action,
					totalAccounts: snapshots.length,
					activeIndex:
						storage && storage.accounts.length > 0 ? activeIndex + 1 : null,
				});
			}
			if (ui.v2Enabled) {
				return [
					...formatUiHeader(ui, "Recommended next action"),
					"",
					formatUiItem(ui, action, "accent"),
				].join("\n");
			}
			return `Recommended next action:\n${action}`;
		},
	});
}
