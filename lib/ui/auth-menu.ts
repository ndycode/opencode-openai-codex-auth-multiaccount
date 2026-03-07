import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { ANSI, isTTY } from "./ansi.js";
import { confirm } from "./confirm.js";
import { getUiRuntimeOptions } from "./runtime.js";
import { select, type MenuItem } from "./select.js";
import { paintUiText, formatUiBadge } from "./format.js";
import { UI_COPY, formatCheckFlaggedLabel } from "./copy.js";

export type AccountStatus =
	| "active"
	| "ok"
	| "rate-limited"
	| "cooldown"
	| "disabled"
	| "error"
	| "flagged"
	| "unknown";

export interface AccountInfo {
	index: number;
	sourceIndex?: number;
	quickSwitchNumber?: number;
	accountId?: string;
	accountLabel?: string;
	email?: string;
	addedAt?: number;
	lastUsed?: number;
	status?: AccountStatus;
	quotaSummary?: string;
	isCurrentAccount?: boolean;
	enabled?: boolean;
}

export interface AuthMenuOptions {
	flaggedCount?: number;
	statusMessage?: string | (() => string | undefined);
}

export type AuthMenuAction =
	| { type: "add" }
	| { type: "forecast" }
	| { type: "fix" }
	| { type: "settings" }
	| { type: "fresh" }
	| { type: "check" }
	| { type: "deep-check" }
	| { type: "verify-flagged" }
	| { type: "select-account"; account: AccountInfo }
	| { type: "set-current-account"; account: AccountInfo }
	| { type: "search" }
	| { type: "delete-all" }
	| { type: "cancel" };

export type AccountAction = "back" | "delete" | "refresh" | "toggle" | "set-current" | "cancel";
export type SettingsAction =
	| "toggle-sync"
	| "sync-now"
	| "cleanup-duplicate-emails"
	| "cleanup-overlaps"
	| "back"
	| "cancel";

type SettingsHubAction = "sync" | "maintenance" | "back" | "cancel";

// biome-ignore lint/suspicious/noControlCharactersInRegex: matching ANSI escape codes
const ANSI_CSI_REGEX = new RegExp("\\x1b\\[[0-?]*[ -/]*[@-~]", "g");
const CONTROL_CHAR_REGEX = new RegExp("[\\u0000-\\u001f\\u007f]", "g");
export interface SyncPruneCandidate {
	index: number;
	email?: string;
	accountLabel?: string;
	isCurrentAccount?: boolean;
	score?: number;
	reason?: string;
}

type SyncPruneAction =
	| { type: "toggle"; candidate: SyncPruneCandidate }
	| { type: "confirm" }
	| { type: "cancel" };

function sanitizeTerminalText(value: string | undefined): string | undefined {
	if (!value) return undefined;
	return value.replace(ANSI_CSI_REGEX, "").replace(CONTROL_CHAR_REGEX, "").trim();
}

function formatRelativeTime(timestamp: number | undefined): string {
	if (!timestamp) return "never";
	const days = Math.floor((Date.now() - timestamp) / 86_400_000);
	if (days <= 0) return "today";
	if (days === 1) return "yesterday";
	if (days < 7) return `${days}d ago`;
	if (days < 30) return `${Math.floor(days / 7)}w ago`;
	return new Date(timestamp).toLocaleDateString();
}

function formatDate(timestamp: number | undefined): string {
	if (!timestamp) return "unknown";
	return new Date(timestamp).toLocaleDateString();
}

function statusBadge(status: AccountStatus | undefined): string {
	const ui = getUiRuntimeOptions();
	const withTone = (
		label: string,
		tone: "accent" | "success" | "warning" | "danger" | "muted",
	): string => {
		if (ui.v2Enabled) return formatUiBadge(ui, label, tone);
		switch (tone) {
			case "success":
				return `${ANSI.green}[${label}]${ANSI.reset}`;
			case "warning":
				return `${ANSI.yellow}[${label}]${ANSI.reset}`;
			case "danger":
				return `${ANSI.red}[${label}]${ANSI.reset}`;
			case "accent":
				return `${ANSI.cyan}[${label}]${ANSI.reset}`;
			default:
				return `${ANSI.dim}[${label}]${ANSI.reset}`;
		}
	};

	switch (status) {
		case "active":
			return withTone("active", "success");
		case "ok":
			return withTone("ok", "success");
		case "rate-limited":
			return withTone("rate-limited", "warning");
		case "cooldown":
			return withTone("cooldown", "warning");
		case "flagged":
			return withTone("flagged", "danger");
		case "disabled":
			return withTone("disabled", "danger");
		case "error":
			return withTone("error", "danger");
		default:
			return withTone("unknown", "muted");
	}
}

function formatAccountIdSuffix(accountId: string | undefined): string | undefined {
	const trimmed = accountId?.trim();
	if (!trimmed) return undefined;
	return trimmed.length > 14 ? `${trimmed.slice(0, 8)}...${trimmed.slice(-6)}` : trimmed;
}

function accountTitle(account: AccountInfo): string {
	const number = account.quickSwitchNumber ?? (account.index + 1);
	const email = sanitizeTerminalText(account.email);
	const label = sanitizeTerminalText(account.accountLabel);
	const accountIdSuffix = formatAccountIdSuffix(account.accountId);
	const details: string[] = [];
	if (email) details.push(email);
	if (label) details.push(label.startsWith("workspace:") ? label : `workspace:${label}`);
	if (accountIdSuffix && (!label || !label.includes(accountIdSuffix))) {
		details.push(`id:${accountIdSuffix}`);
	}
	return details.length > 0 ? `${number}. ${details.join(" | ")}` : `${number}. Account`;
}

function accountSearchText(account: AccountInfo): string {
	return [
		sanitizeTerminalText(account.email),
		sanitizeTerminalText(account.accountLabel),
		sanitizeTerminalText(account.accountId),
		String(account.quickSwitchNumber ?? (account.index + 1)),
	]
		.filter((value): value is string => typeof value === "string" && value.length > 0)
		.join(" ")
		.toLowerCase();
}

function accountRowColor(account: AccountInfo): MenuItem<AuthMenuAction>["color"] {
	if (account.isCurrentAccount) return "green";
	switch (account.status) {
		case "active":
		case "ok":
			return "green";
		case "rate-limited":
		case "cooldown":
			return "yellow";
		case "disabled":
		case "error":
		case "flagged":
			return "red";
		default:
			return undefined;
	}
}

function formatAccountHint(account: AccountInfo, ui = getUiRuntimeOptions()): string {
	const parts: string[] = [];
	parts.push(ui.v2Enabled ? paintUiText(ui, `used ${formatRelativeTime(account.lastUsed)}`, "muted") : `used ${formatRelativeTime(account.lastUsed)}`);
	const quotaSummary = sanitizeTerminalText(account.quotaSummary);
	if (quotaSummary) {
		parts.push(ui.v2Enabled ? paintUiText(ui, quotaSummary, "muted") : quotaSummary);
	}
	return parts.join(ui.v2Enabled ? ` ${paintUiText(ui, "|", "muted")} ` : " | ");
}

async function promptSearchQuery(current: string): Promise<string> {
	if (!input.isTTY || !output.isTTY) {
		return current;
	}
	const rl = createInterface({ input, output });
	try {
		const suffix = current ? ` (${current})` : "";
		const answer = await rl.question(`Search${suffix} (blank clears): `);
		return answer.trim().toLowerCase();
	} finally {
		rl.close();
	}
}

function authMenuFocusKey(action: AuthMenuAction): string {
	switch (action.type) {
		case "select-account":
		case "set-current-account":
			return `account:${action.account.sourceIndex ?? action.account.index}`;
		default:
			return `action:${action.type}`;
	}
}

export async function showAuthMenu(
	accounts: AccountInfo[],
	options: AuthMenuOptions = {},
): Promise<AuthMenuAction> {
	const flaggedCount = options.flaggedCount ?? 0;
	const verifyLabel = formatCheckFlaggedLabel(flaggedCount);
	const ui = getUiRuntimeOptions();
	let showDetailedHelp = false;
	let searchQuery = "";
	let focusKey = "action:add";

	while (true) {
		const normalizedSearch = searchQuery.trim().toLowerCase();
		const visibleAccounts = normalizedSearch.length > 0
			? accounts.filter((account) => accountSearchText(account).includes(normalizedSearch))
			: accounts;
		const visibleByNumber = new Map<number, AccountInfo>();
		const duplicateQuickSwitchNumbers = new Set<number>();
		for (const account of visibleAccounts) {
			const quickSwitchNumber = account.quickSwitchNumber ?? (account.index + 1);
			if (visibleByNumber.has(quickSwitchNumber)) {
				duplicateQuickSwitchNumbers.add(quickSwitchNumber);
				continue;
			}
			visibleByNumber.set(quickSwitchNumber, account);
		}

		const items: MenuItem<AuthMenuAction>[] = [
			{ label: UI_COPY.mainMenu.quickStart, value: { type: "cancel" }, kind: "heading" },
			{ label: UI_COPY.mainMenu.addAccount, value: { type: "add" }, color: "green" },
			{ label: UI_COPY.mainMenu.checkAccounts, value: { type: "check" }, color: "green" },
			{ label: UI_COPY.mainMenu.bestAccount, value: { type: "forecast" }, color: "green" },
			{ label: UI_COPY.mainMenu.fixIssues, value: { type: "fix" }, color: "green" },
			{ label: "", value: { type: "cancel" }, separator: true },
			{ label: UI_COPY.mainMenu.moreChecks, value: { type: "cancel" }, kind: "heading" },
			{ label: UI_COPY.mainMenu.refreshChecks, value: { type: "deep-check" }, color: "green" },
			{ label: verifyLabel, value: { type: "verify-flagged" }, color: flaggedCount > 0 ? "red" : "yellow" },
			{ label: "", value: { type: "cancel" }, separator: true },
			{ label: UI_COPY.mainMenu.settingsSection, value: { type: "cancel" }, kind: "heading" },
			{ label: UI_COPY.mainMenu.settings, value: { type: "settings" }, color: "green" },
			{ label: "", value: { type: "cancel" }, separator: true },
			{ label: UI_COPY.mainMenu.accounts, value: { type: "cancel" }, kind: "heading" },
		];

		if (visibleAccounts.length === 0) {
			items.push({ label: UI_COPY.mainMenu.noSearchMatches, value: { type: "cancel" }, disabled: true });
		} else {
			items.push(
				...visibleAccounts.map((account) => {
					const currentBadge = account.isCurrentAccount
						? (ui.v2Enabled ? ` ${formatUiBadge(ui, "current", "accent")}` : ` ${ANSI.cyan}[current]${ANSI.reset}`)
						: "";
					const badge = statusBadge(account.status);
					const title = ui.v2Enabled
						? paintUiText(ui, accountTitle(account), account.isCurrentAccount ? "accent" : "heading")
						: accountTitle(account);
					return {
						label: `${title}${currentBadge} ${badge}`.trim(),
						hint: formatAccountHint(account, ui),
						selectedLabel: `${accountTitle(account)}${currentBadge} ${badge}`.trim(),
						color: accountRowColor(account),
						value: { type: "select-account" as const, account },
					};
				}),
			);
		}

		items.push({ label: "", value: { type: "cancel" }, separator: true });
		items.push({ label: UI_COPY.mainMenu.dangerZone, value: { type: "cancel" }, kind: "heading" });
		items.push({ label: UI_COPY.mainMenu.removeAllAccounts, value: { type: "delete-all" }, color: "red" });

		const buildSubtitle = (): string | undefined => {
			const parts: string[] = [];
			if (normalizedSearch.length > 0) {
				parts.push(`${UI_COPY.mainMenu.searchSubtitlePrefix} ${normalizedSearch}`);
			}
			const statusText = typeof options.statusMessage === "function" ? options.statusMessage() : options.statusMessage;
			if (typeof statusText === "string" && statusText.trim().length > 0) {
				parts.push(statusText.trim());
			}
			return parts.length > 0 ? parts.join(" | ") : undefined;
		};

		const initialCursor = items.findIndex((item) => {
			if (item.separator || item.disabled || item.kind === "heading") return false;
			return authMenuFocusKey(item.value) === focusKey;
		});

		const result = await select(items, {
			message: UI_COPY.mainMenu.title,
			subtitle: buildSubtitle(),
			dynamicSubtitle: buildSubtitle,
			help: showDetailedHelp ? UI_COPY.mainMenu.helpDetailed : UI_COPY.mainMenu.helpCompact,
			clearScreen: true,
			selectedEmphasis: "minimal",
			focusStyle: "row-invert",
			showHintsForUnselected: false,
			refreshIntervalMs: 200,
			initialCursor: initialCursor >= 0 ? initialCursor : undefined,
			theme: ui.theme,
			onInput: (input, context) => {
				const lower = input.toLowerCase();
				if (lower === "?") {
					showDetailedHelp = !showDetailedHelp;
					context.requestRerender();
					return undefined;
				}
				if (lower === "q") return { type: "cancel" as const };
				if (lower === "/") return { type: "search" as const };
				const parsed = Number.parseInt(input, 10);
				if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 9) {
					if (duplicateQuickSwitchNumbers.has(parsed)) return undefined;
					const direct = visibleByNumber.get(parsed);
					if (direct) {
						return { type: "set-current-account" as const, account: direct };
					}
				}
				return undefined;
			},
			onCursorChange: ({ cursor }) => {
				const selected = items[cursor];
				if (!selected || selected.separator || selected.disabled || selected.kind === "heading") return;
				focusKey = authMenuFocusKey(selected.value);
			},
		});

		if (!result) return { type: "cancel" };
		if (result.type === "search") {
			searchQuery = await promptSearchQuery(searchQuery);
			focusKey = "action:search";
			continue;
		}
		if (result.type === "delete-all") {
			const confirmed = await confirm("Delete all accounts?");
			if (!confirmed) continue;
		}
		focusKey = authMenuFocusKey(result);
		return result;
	}
}

export async function showSettingsMenu(
	syncFromCodexMultiAuthEnabled: boolean,
): Promise<SettingsAction> {
	const ui = getUiRuntimeOptions();
	let focus: SettingsHubAction = "sync";

	while (true) {
		const hubItems: MenuItem<SettingsHubAction>[] = [
			{ label: UI_COPY.settings.sectionTitle, value: "cancel", kind: "heading" },
			{ label: UI_COPY.settings.syncCategory, value: "sync", color: "green" },
			{ label: UI_COPY.settings.maintenanceCategory, value: "maintenance", color: "green" },
			{ label: "", value: "cancel", separator: true },
			{ label: UI_COPY.settings.navigationHeading, value: "cancel", kind: "heading" },
			{ label: UI_COPY.settings.back, value: "back", color: "red" },
		];
		const initialCursor = hubItems.findIndex((item) => {
			if (item.separator || item.disabled || item.kind === "heading") return false;
			return item.value === focus;
		});
		const action = await select<SettingsHubAction>(hubItems, {
			message: UI_COPY.settings.title,
			subtitle: UI_COPY.settings.subtitle,
			help: UI_COPY.settings.help,
			clearScreen: true,
			selectedEmphasis: "minimal",
			focusStyle: "row-invert",
			theme: ui.theme,
			initialCursor: initialCursor >= 0 ? initialCursor : undefined,
		});

		if (!action || action === "cancel" || action === "back") {
			return action ?? "cancel";
		}

		if (action === "sync") {
			const syncBadge = syncFromCodexMultiAuthEnabled
				? formatUiBadge(ui, "enabled", "success")
				: formatUiBadge(ui, "disabled", "danger");
			const syncLabel = ui.v2Enabled
				? `${UI_COPY.settings.syncToggle} ${syncBadge}`
				: `${UI_COPY.settings.syncToggle} ${syncFromCodexMultiAuthEnabled ? `${ANSI.green}[enabled]${ANSI.reset}` : `${ANSI.red}[disabled]${ANSI.reset}`}`;
			const syncAction = await select<SettingsAction>(
				[
					{ label: UI_COPY.settings.syncHeading, value: "cancel", kind: "heading" },
					{ label: syncLabel, value: "toggle-sync", color: syncFromCodexMultiAuthEnabled ? "green" : "yellow" },
					{ label: UI_COPY.settings.syncNow, value: "sync-now", color: "cyan" },
					{ label: "", value: "cancel", separator: true },
					{ label: UI_COPY.settings.navigationHeading, value: "cancel", kind: "heading" },
					{ label: UI_COPY.settings.back, value: "back" },
				],
				{
					message: UI_COPY.settings.title,
					subtitle: UI_COPY.settings.syncCategory,
					help: UI_COPY.settings.help,
					clearScreen: true,
					selectedEmphasis: "minimal",
					focusStyle: "row-invert",
					theme: ui.theme,
				},
			);
			if (syncAction && syncAction !== "back" && syncAction !== "cancel") {
				return syncAction;
			}
			focus = "sync";
			continue;
		}

		const maintenanceAction = await select<SettingsAction>(
			[
				{ label: UI_COPY.settings.maintenanceHeading, value: "cancel", kind: "heading" },
				{ label: UI_COPY.settings.cleanupDuplicateEmails, value: "cleanup-duplicate-emails", color: "yellow" },
				{ label: UI_COPY.settings.cleanupOverlaps, value: "cleanup-overlaps", color: "yellow" },
				{ label: "", value: "cancel", separator: true },
				{ label: UI_COPY.settings.navigationHeading, value: "cancel", kind: "heading" },
				{ label: UI_COPY.settings.back, value: "back" },
			],
			{
				message: UI_COPY.settings.title,
				subtitle: UI_COPY.settings.maintenanceCategory,
				help: UI_COPY.settings.help,
				clearScreen: true,
				selectedEmphasis: "minimal",
				focusStyle: "row-invert",
				theme: ui.theme,
			},
		);
		if (maintenanceAction && maintenanceAction !== "back" && maintenanceAction !== "cancel") {
			return maintenanceAction;
		}
		focus = "maintenance";
	}
}

export async function showAccountDetails(account: AccountInfo): Promise<AccountAction> {
	const ui = getUiRuntimeOptions();
	const header = `${accountTitle(account)} ${statusBadge(account.status)}`;
	const subtitle = `Added: ${formatDate(account.addedAt)} | Used: ${formatRelativeTime(account.lastUsed)} | Status: ${account.status ?? "unknown"}`;
	let focusAction: AccountAction = "back";

	while (true) {
		const items: MenuItem<AccountAction>[] = [
			{ label: UI_COPY.accountDetails.back, value: "back" },
			{
				label: account.enabled === false ? UI_COPY.accountDetails.enable : UI_COPY.accountDetails.disable,
				value: "toggle",
				color: account.enabled === false ? "green" : "yellow",
			},
			{ label: UI_COPY.accountDetails.setCurrent, value: "set-current", color: "green" },
			{ label: UI_COPY.accountDetails.refresh, value: "refresh", color: "green" },
			{ label: UI_COPY.accountDetails.remove, value: "delete", color: "red" },
		];
		const initialCursor = items.findIndex((item) => item.value === focusAction);
		const action = await select<AccountAction>(items, {
			message: header,
			subtitle,
			help: UI_COPY.accountDetails.help,
			clearScreen: true,
			selectedEmphasis: "minimal",
			focusStyle: "row-invert",
			initialCursor: initialCursor >= 0 ? initialCursor : undefined,
			theme: ui.theme,
			onInput: (input) => {
				const lower = input.toLowerCase();
				if (lower === "q") return "cancel";
				if (lower === "s") return "set-current";
				if (lower === "r") return "refresh";
				if (lower === "d") return "delete";
				if (lower === "e" || lower === "t" || lower === "x") return "toggle";
				return undefined;
			},
			onCursorChange: ({ cursor }) => {
				const selected = items[cursor];
				if (!selected || selected.separator || selected.disabled || selected.kind === "heading") return;
				focusAction = selected.value;
			},
		});

		if (!action) return "cancel";
		focusAction = action;
		if (action === "delete") {
			const confirmed = await confirm(`Delete ${accountTitle(account)}?`);
			if (!confirmed) continue;
		}
		if (action === "refresh") {
			const confirmed = await confirm(`Re-authenticate ${accountTitle(account)}?`);
			if (!confirmed) continue;
		}
		return action;
	}
}

function syncPruneTitle(candidate: SyncPruneCandidate): string {
	const title = accountTitle({
		index: candidate.index,
		email: candidate.email,
		accountLabel: candidate.accountLabel,
		isCurrentAccount: candidate.isCurrentAccount,
	});
	const ui = getUiRuntimeOptions();
	const chips: string[] = [];
	if (candidate.isCurrentAccount) {
		chips.push(ui.v2Enabled ? formatUiBadge(ui, UI_COPY.syncPrune.current, "accent") : `${ANSI.cyan}[${UI_COPY.syncPrune.current}]${ANSI.reset}`);
	}
	return [title, ...chips].join(" ").trim();
}

function syncPruneHint(candidate: SyncPruneCandidate): string {
	const parts: string[] = [];
	if (typeof candidate.score === "number") {
		parts.push(`score ${candidate.score}`);
	}
	if (candidate.reason?.trim()) {
		parts.push(candidate.reason.trim());
	}
	return parts.join(" | ") || "selected for removal";
}

export async function showSyncPruneMenu(
	neededCount: number,
	candidates: SyncPruneCandidate[],
): Promise<number[] | null> {
	const ui = getUiRuntimeOptions();
	const selected = new Set<number>();
	for (const candidate of candidates) {
		if (candidate.isCurrentAccount !== true && selected.size < neededCount) {
			selected.add(candidate.index);
		}
	}
	let focusKey = candidates[0] ? `candidate:${candidates[0].index}` : "confirm";

	while (true) {
		const items: MenuItem<SyncPruneAction>[] = candidates.map((candidate) => {
			const isSelected = selected.has(candidate.index);
			const selectionBadge = isSelected
				? ui.v2Enabled
					? formatUiBadge(ui, UI_COPY.syncPrune.selected, "warning")
					: `${ANSI.yellow}[${UI_COPY.syncPrune.selected}]${ANSI.reset}`
				: "";
			return {
				label: `${syncPruneTitle(candidate)} ${selectionBadge}`.trim(),
				selectedLabel: `${syncPruneTitle(candidate)} ${selectionBadge}`.trim(),
				hint: syncPruneHint(candidate),
				color: isSelected ? "yellow" : candidate.isCurrentAccount ? "cyan" : "green",
				value: { type: "toggle", candidate },
			};
		});

		items.push({ label: "", value: { type: "cancel" }, separator: true });
		items.push({
			label: `${UI_COPY.syncPrune.confirm}${selected.size >= neededCount ? "" : ` (${selected.size}/${neededCount})`}`,
			value: { type: "confirm" },
			color: selected.size >= neededCount ? "green" : "yellow",
		});
		items.push({ label: UI_COPY.syncPrune.cancel, value: { type: "cancel" }, color: "red" });

		const initialCursor = items.findIndex((item) => {
			if (item.separator || item.disabled || item.kind === "heading") return false;
			if (item.value.type === "toggle") return focusKey === `candidate:${item.value.candidate.index}`;
			return focusKey === item.value.type;
		});

		const action = await select(items, {
			message: UI_COPY.syncPrune.title,
			subtitle: `${UI_COPY.syncPrune.subtitle(neededCount)} | Selected ${selected.size}`,
			help: UI_COPY.syncPrune.help,
			clearScreen: true,
			selectedEmphasis: "minimal",
			focusStyle: "row-invert",
			initialCursor: initialCursor >= 0 ? initialCursor : undefined,
			theme: ui.theme,
			onInput: (input, context) => {
				const lower = input.toLowerCase();
				if (lower === "q") return { type: "cancel" as const };
				if (lower === "c") return { type: "confirm" as const };
				if (input === " ") {
					const current = items[context.cursor];
					if (current?.value.type === "toggle") {
						return current.value;
					}
					return undefined;
				}
				return undefined;
			},
			onCursorChange: ({ cursor }) => {
				const current = items[cursor];
				if (!current || current.separator || current.disabled || current.kind === "heading") return;
				if (current.value.type === "toggle") focusKey = `candidate:${current.value.candidate.index}`;
				else focusKey = current.value.type;
			},
		});

		if (!action || action.type === "cancel") {
			return null;
		}
		if (action.type === "toggle") {
			if (selected.has(action.candidate.index)) selected.delete(action.candidate.index);
			else selected.add(action.candidate.index);
			focusKey = `candidate:${action.candidate.index}`;
			continue;
		}
		if (action.type === "confirm") {
			if (selected.size < neededCount) {
				continue;
			}
			return Array.from(selected);
		}
	}
}

export { isTTY };
