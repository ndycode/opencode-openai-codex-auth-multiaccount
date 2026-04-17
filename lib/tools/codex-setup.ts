/**
 * `codex-setup` tool — beginner onboarding checklist + optional wizard.
 * Extracted from `index.ts` per RC-1 Phase 2.
 */

import { tool, type ToolDefinition } from "@opencode-ai/plugin/tool";
import type { ToolContext } from "./index.js";

export function createCodexSetupTool(ctx: ToolContext): ToolDefinition {
	const {
		resolveUiRuntime,
		buildSetupChecklistState,
		renderSetupChecklistOutput,
		runSetupWizard,
	} = ctx;
	return tool({
		description: "Beginner checklist for first-time setup and account readiness.",
		args: {
			wizard: tool.schema
				.boolean()
				.optional()
				.describe("Launch menu-driven setup wizard when terminal supports it."),
		},
		async execute({ wizard }: { wizard?: boolean } = {}) {
			const ui = resolveUiRuntime();
			const state = await buildSetupChecklistState();
			if (wizard) {
				return runSetupWizard(ui, state);
			}
			return renderSetupChecklistOutput(ui, state);
		},
	});
}
