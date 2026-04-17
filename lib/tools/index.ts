/**
 * Tool registry — RC-1 Phase 2 (incremental).
 *
 * `ToolContext` bundles the plugin-closure state and helpers each
 * `codex-*` tool needs. The plugin builds a `ToolContext` inside
 * `OpenAIOAuthPlugin` and passes it to `createToolRegistry` so that every
 * tool factory can access closure state (mutable refs, helpers) without
 * living inside the plugin function body.
 *
 * **Status**: This PR lands the scaffolding plus the first three tool
 * extractions (`codex-help`, `codex-next`, `codex-setup`). The remaining
 * 15 inline tools in `index.ts` will move into per-file modules in
 * follow-up PRs using the same pattern. The factories below reference
 * only the already-extracted files to keep the build green.
 *
 * See `docs/audits/07-refactoring-plan.md#rc-1` and `lib/tools/AGENTS.md`.
 */

import type { AccountManager } from "../accounts.js";
import type {
	AccountStorageV3,
	FlaggedAccountMetadataV1,
} from "../storage.js";
import type { UiRuntimeOptions } from "../ui/runtime.js";
import type {
	BeginnerAccountSnapshot,
	BeginnerDiagnosticSeverity,
	BeginnerRuntimeSnapshot,
} from "../ui/beginner.js";
import type { ModelFamily } from "../prompts/codex.js";
import type { RoutingVisibilitySnapshot, RuntimeMetrics } from "../runtime.js";
import type { ToolDefinition } from "@opencode-ai/plugin/tool";

import { createCodexHelpTool } from "./codex-help.js";
import { createCodexNextTool } from "./codex-next.js";
import { createCodexSetupTool } from "./codex-setup.js";

/**
 * Mutable reference wrapper.
 *
 * Used for plugin-closure state that tools both read and write
 * (e.g. `cachedAccountManager`). The plugin hands a single `MutableRef`
 * to every factory so writes made inside a tool propagate to the outer
 * closure and all other tools without depending on module-level state.
 */
export type MutableRef<T> = { current: T };

/**
 * Shared tool context.
 *
 * Every `codex-*` tool factory receives this object. Fields fall into
 * three groups:
 *
 * - Plugin-state refs (`cachedAccountManagerRef`, …) — mutable
 * - Read-only runtime handles (`runtimeMetrics`, `beginnerSafeModeRef`)
 * - Helper functions captured from the plugin closure
 *
 * The factory `create<Name>Tool(ctx)` returns a standard `tool({...})`
 * result. Keeping the surface in one type lets us evolve it without
 * threading dozens of arguments through 18 call sites.
 *
 * The type already lists every field the remaining 15 tools will
 * eventually need so that later PRs can extract them without churning
 * this interface. Each tool only destructures the subset it uses.
 */
export interface ToolContext {
	// --- Mutable plugin-closure state ---------------------------------------
	cachedAccountManagerRef: MutableRef<AccountManager | null>;
	accountManagerPromiseRef: MutableRef<Promise<AccountManager> | null>;

	// --- Read-only plugin-closure state -------------------------------------
	runtimeMetrics: RuntimeMetrics;
	beginnerSafeModeRef: { readonly current: boolean };

	// --- Closure helpers ----------------------------------------------------
	resolveUiRuntime: () => UiRuntimeOptions;
	getStatusMarker: (
		ui: UiRuntimeOptions,
		status: "ok" | "warning" | "error",
	) => string;
	formatCommandAccountLabel: (
		account:
			| {
					email?: string;
					accountId?: string;
					accountLabel?: string;
					accountTags?: string[];
					accountNote?: string;
			  }
			| undefined,
		index: number,
	) => string;
	normalizeAccountTags: (raw: string) => string[];
	supportsInteractiveMenus: () => boolean;
	promptAccountIndexSelection: (
		ui: UiRuntimeOptions,
		storage: AccountStorageV3,
		title: string,
	) => Promise<number | null>;
	resolveActiveIndex: (
		storage: {
			activeIndex: number;
			activeIndexByFamily?: Partial<Record<ModelFamily, number>>;
			accounts: unknown[];
		},
		family?: ModelFamily,
	) => number;
	getRateLimitResetTimeForFamily: (
		account: { rateLimitResetTimes?: Record<string, number | undefined> },
		now: number,
		family: ModelFamily,
	) => number | null;
	formatRateLimitEntry: (
		account: { rateLimitResetTimes?: Record<string, number | undefined> },
		now: number,
		family?: ModelFamily,
	) => string | null;
	buildJsonAccountIdentity: (
		index: number,
		options?: {
			includeSensitive?: boolean;
			account?: {
				email?: string;
				accountId?: string;
				accountLabel?: string;
				accountTags?: string[];
				accountNote?: string;
			};
			label?: string;
		},
	) => Record<string, unknown>;
	buildRoutingVisibilitySnapshot: (overrides?: {
		modelFamily?: ModelFamily | null;
		effectiveModel?: string | null;
		quotaKey?: string | null;
		selectedAccountIndex?: number | null;
		selectionExplainability?: unknown;
	}) => RoutingVisibilitySnapshot;
	appendRoutingVisibilityText: (
		lines: string[],
		routing: RoutingVisibilitySnapshot,
		options?: { includeExplainability?: boolean },
	) => void;
	appendRoutingVisibilityUi: (
		ui: UiRuntimeOptions,
		lines: string[],
		routing: RoutingVisibilitySnapshot,
		options?: { includeExplainability?: boolean },
	) => void;
	toBeginnerAccountSnapshots: (
		storage: AccountStorageV3,
		activeIndex: number,
		now: number,
	) => BeginnerAccountSnapshot[];
	getBeginnerRuntimeSnapshot: () => BeginnerRuntimeSnapshot;
	formatDoctorSeverity: (
		ui: UiRuntimeOptions,
		severity: BeginnerDiagnosticSeverity,
	) => string;
	formatDoctorSeverityText: (severity: BeginnerDiagnosticSeverity) => string;
	buildSetupChecklistState: () => Promise<{
		now: number;
		storage: AccountStorageV3 | null;
		activeIndex: number;
		snapshots: BeginnerAccountSnapshot[];
		runtime: BeginnerRuntimeSnapshot;
		checklist: ReturnType<
			typeof import("../ui/beginner.js").buildBeginnerChecklist
		>;
		summary: ReturnType<
			typeof import("../ui/beginner.js").summarizeBeginnerAccounts
		>;
		nextAction: string;
	}>;
	renderSetupChecklistOutput: (
		ui: UiRuntimeOptions,
		state: Awaited<ReturnType<ToolContext["buildSetupChecklistState"]>>,
	) => string;
	runSetupWizard: (
		ui: UiRuntimeOptions,
		state: Awaited<ReturnType<ToolContext["buildSetupChecklistState"]>>,
	) => Promise<string>;
	invalidateAccountManagerCache: () => void;
	upsertFlaggedAccountRecord: (
		accounts: FlaggedAccountMetadataV1[],
		record: FlaggedAccountMetadataV1,
	) => void;
}

/**
 * Build the codex-* tool registry from a prepared context.
 *
 * Returned shape matches the `tool: { … }` map the plugin exposes on the
 * `Plugin` output object.
 *
 * Only the first three extracted tools are wired here today. When each
 * remaining inline tool moves into `lib/tools/codex-<name>.ts`, its
 * factory import + map entry is added below and the corresponding
 * inline definition is deleted from `index.ts`.
 */
export type CodexToolRegistry = Record<string, ToolDefinition>;

export function createToolRegistry(ctx: ToolContext): CodexToolRegistry {
	return {
		"codex-help": createCodexHelpTool(ctx),
		"codex-next": createCodexNextTool(ctx),
		"codex-setup": createCodexSetupTool(ctx),
	};
}
