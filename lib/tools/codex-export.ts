/**
 * `codex-export` tool — export accounts to JSON file.
 * Extracted from `index.ts` per RC-1 Phase 2.
 */

import { tool, type ToolDefinition } from "@opencode-ai/plugin/tool";
import {
	createTimestampedBackupPath,
	exportAccounts,
	loadAccounts,
} from "../storage.js";
import { formatUiHeader, formatUiItem, formatUiKeyValue } from "../ui/format.js";
import type { ToolContext } from "./index.js";

export function createCodexExportTool(ctx: ToolContext): ToolDefinition {
	const { resolveUiRuntime, getStatusMarker } = ctx;
	return tool({
		description:
			"Export accounts to a JSON file for backup or migration. Can auto-generate timestamped backup paths.",
		args: {
			path: tool.schema
				.string()
				.optional()
				.describe(
					"File path to export to (e.g., ~/codex-backup.json). If omitted, a timestamped backup path is used.",
				),
			force: tool.schema
				.boolean()
				.optional()
				.describe("Overwrite existing file (default: false)"),
			timestamped: tool.schema
				.boolean()
				.optional()
				.describe(
					"When true (default), omitted paths use a timestamped backup filename.",
				),
		},
		async execute({
			path: filePath,
			force,
			timestamped,
		}: {
			path?: string;
			force?: boolean;
			timestamped?: boolean;
		}) {
			const ui = resolveUiRuntime();
			const shouldTimestamp = timestamped ?? true;
			const resolvedExportPath =
				filePath && filePath.trim().length > 0
					? filePath
					: shouldTimestamp
						? createTimestampedBackupPath()
						: "codex-backup.json";
			try {
				await exportAccounts(resolvedExportPath, force ?? false);
				const storage = await loadAccounts();
				const count = storage?.accounts.length ?? 0;
				if (ui.v2Enabled) {
					return [
						...formatUiHeader(ui, "Export accounts"),
						"",
						formatUiItem(
							ui,
							`${getStatusMarker(ui, "ok")} Exported ${count} account(s)`,
							"success",
						),
						formatUiKeyValue(ui, "Path", resolvedExportPath, "muted"),
					].join("\n");
				}
				return `Exported ${count} account(s) to: ${resolvedExportPath}`;
			} catch (error) {
				const msg = error instanceof Error ? error.message : String(error);
				if (ui.v2Enabled) {
					return [
						...formatUiHeader(ui, "Export accounts"),
						"",
						formatUiItem(
							ui,
							`${getStatusMarker(ui, "error")} Export failed`,
							"danger",
						),
						formatUiKeyValue(ui, "Error", msg, "danger"),
					].join("\n");
				}
				return `Export failed: ${msg}`;
			}
		},
	});
}
