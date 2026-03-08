import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import type { AccountIdSource } from "./types.js";
import {
	showAuthMenu,
	showAccountDetails,
	showSettingsMenu,
	showSyncPruneMenu,
	isTTY,
	type AccountStatus,
} from "./ui/auth-menu.js";
import { UI_COPY } from "./ui/copy.js";

export function isNonInteractiveMode(): boolean {
	if (process.env.FORCE_INTERACTIVE_MODE === "1") return false;
	if (!input.isTTY || !output.isTTY) return true;
	if (process.env.OPENCODE_TUI === "1") return true;
	if (process.env.OPENCODE_DESKTOP === "1") return true;
	if (process.env.TERM_PROGRAM === "opencode") return true;
	if (process.env.ELECTRON_RUN_AS_NODE === "1") return true;
	return false;
}

export async function promptAddAnotherAccount(currentCount: number): Promise<boolean> {
	if (isNonInteractiveMode()) {
		return false;
	}

	const rl = createInterface({ input, output });
	try {
		console.log(`\n${UI_COPY.fallback.addAnotherTip}\n`);
		const answer = await rl.question(UI_COPY.fallback.addAnotherQuestion(currentCount));
		const normalized = answer.trim().toLowerCase();
		return normalized === "y" || normalized === "yes";
	} finally {
		rl.close();
	}
}

export interface SyncPruneCandidate {
	index: number;
	email?: string;
	accountLabel?: string;
	isCurrentAccount?: boolean;
	reason?: string;
}

function formatPruneCandidate(candidate: SyncPruneCandidate): string {
	const label = formatAccountLabel(
		{
			index: candidate.index,
			email: candidate.email,
			accountLabel: candidate.accountLabel,
			isCurrentAccount: candidate.isCurrentAccount,
		},
		candidate.index,
	);
	const details: string[] = [];
	if (candidate.isCurrentAccount) details.push("current");
	if (candidate.reason) details.push(candidate.reason);
	return details.length > 0 ? `${label} | ${details.join(" | ")}` : label;
}

export async function promptCodexMultiAuthSyncPrune(
	neededCount: number,
	candidates: SyncPruneCandidate[],
): Promise<number[] | null> {
	if (isNonInteractiveMode()) {
		return null;
	}

	const suggested = candidates
		.filter((candidate) => candidate.isCurrentAccount !== true)
		.slice(0, neededCount)
		.map((candidate) => candidate.index);

	if (isTTY()) {
		return showSyncPruneMenu(neededCount, candidates);
	}

	const rl = createInterface({ input, output });
	try {
		console.log("");
		console.log(`Sync needs ${neededCount} free slot(s).`);
		console.log("Suggested removals:");
		for (const candidate of candidates) {
			console.log(`  ${formatPruneCandidate(candidate)}`);
		}
		console.log("");
		console.log(
			suggested.length >= neededCount
				? "Press Enter to remove the suggested accounts, or enter comma-separated numbers."
				: "Enter comma-separated account numbers to remove, or Q to cancel.",
		);

		while (true) {
			const answer = await rl.question(`Remove at least ${neededCount} account(s): `);
			const normalized = answer.trim();
			if (!normalized) {
				if (suggested.length >= neededCount) {
					return suggested;
				}
				console.log("No default suggestion is available. Enter one or more account numbers.");
				continue;
			}

			if (normalized.toLowerCase() === "q" || normalized.toLowerCase() === "quit") {
				return null;
			}

			const parsed = normalized
				.split(",")
				.map((value) => Number.parseInt(value.trim(), 10))
				.filter((value) => Number.isFinite(value))
				.map((value) => value - 1);
			const unique = Array.from(new Set(parsed));
			if (unique.length < neededCount) {
				console.log(`Select at least ${neededCount} unique account number(s).`);
				continue;
			}

			const invalid = unique.filter((index) => !candidates.some((candidate) => candidate.index === index));
			if (invalid.length > 0) {
				console.log("One or more selected account numbers are not valid for removal.");
				continue;
			}

			return unique;
		}
	} finally {
		rl.close();
	}
}

export type LoginMode =
	| "add"
	| "forecast"
	| "fix"
	| "settings"
	| "experimental-toggle-sync"
	| "experimental-sync-now"
	| "experimental-cleanup-overlaps"
	| "maintenance-clean-duplicate-emails"
	| "fresh"
	| "manage"
	| "check"
	| "deep-check"
	| "verify-flagged"
	| "cancel";

export interface ExistingAccountInfo {
	accountId?: string;
	accountLabel?: string;
	email?: string;
	index: number;
	sourceIndex?: number;
	quickSwitchNumber?: number;
	addedAt?: number;
	lastUsed?: number;
	status?: AccountStatus;
	quotaSummary?: string;
	isCurrentAccount?: boolean;
	enabled?: boolean;
}

export interface LoginMenuOptions {
	flaggedCount?: number;
	syncFromCodexMultiAuthEnabled?: boolean;
	statusMessage?: string | (() => string | undefined);
}

export interface LoginMenuResult {
	mode: LoginMode;
	deleteAccountIndex?: number;
	refreshAccountIndex?: number;
	toggleAccountIndex?: number;
	switchAccountIndex?: number;
	deleteAll?: boolean;
}

function formatAccountLabel(account: ExistingAccountInfo, index: number): string {
	const num = account.quickSwitchNumber ?? (index + 1);
	const label = account.accountLabel?.trim();
	const email = account.email?.trim();
	const accountId = account.accountId?.trim();
	const accountIdDisplay =
		accountId && accountId.length > 14
			? `${accountId.slice(0, 8)}...${accountId.slice(-6)}`
			: accountId;
	const details: string[] = [];
	if (email) details.push(email);
	if (label) details.push(`workspace:${label}`);
	if (accountIdDisplay) details.push(`id:${accountIdDisplay}`);
	return details.length > 0 ? `${num}. ${details.join(" | ")}` : `${num}. Account`;
}

function resolveAccountSourceIndex(account: ExistingAccountInfo): number {
	const sourceIndex =
		typeof account.sourceIndex === "number" && Number.isFinite(account.sourceIndex)
			? Math.max(0, Math.floor(account.sourceIndex))
			: undefined;
	if (typeof sourceIndex === "number") return sourceIndex;
	if (typeof account.index === "number" && Number.isFinite(account.index)) {
		return Math.max(0, Math.floor(account.index));
	}
	return -1;
}

async function promptDeleteAllTypedConfirm(): Promise<boolean> {
	const rl = createInterface({ input, output });
	try {
		const answer = await rl.question("Type DELETE to remove all saved accounts: ");
		return answer.trim() === "DELETE";
	} finally {
		rl.close();
	}
}

async function promptSettingsModeFallback(
	rl: ReturnType<typeof createInterface>,
	syncFromCodexMultiAuthEnabled: boolean,
): Promise<LoginMenuResult | null> {
	while (true) {
		const syncState = syncFromCodexMultiAuthEnabled ? "enabled" : "disabled";
		const answer = await rl.question(
			`(t) toggle sync [${syncState}], (i) sync now, (c) cleanup overlaps, (d) clean legacy duplicate emails, (b) back [t/i/c/d/b]: `,
		);
		const normalized = answer.trim().toLowerCase();
		if (normalized === "t" || normalized === "toggle") {
			return { mode: "experimental-toggle-sync" };
		}
		if (normalized === "i" || normalized === "import" || normalized === "sync") {
			return { mode: "experimental-sync-now" };
		}
		if (normalized === "c" || normalized === "cleanup") {
			return { mode: "experimental-cleanup-overlaps" };
		}
		if (normalized === "d" || normalized === "dedupe" || normalized === "duplicates") {
			return { mode: "maintenance-clean-duplicate-emails" };
		}
		if (normalized === "b" || normalized === "back") {
			return null;
		}
		console.log("Use one of: t, i, c, d, b.");
	}
}

async function promptLoginModeFallback(
	existingAccounts: ExistingAccountInfo[],
	options: LoginMenuOptions = {},
): Promise<LoginMenuResult> {
	const rl = createInterface({ input, output });
	try {
		if (existingAccounts.length > 0) {
			console.log(`\n${existingAccounts.length} account(s) saved:`);
			for (const account of existingAccounts) {
				console.log(`  ${formatAccountLabel(account, account.index)}`);
			}
			console.log("");
		}

		while (true) {
			const answer = await rl.question(UI_COPY.fallback.selectModePrompt);
			const normalized = answer.trim().toLowerCase();
			if (normalized === "a" || normalized === "add") return { mode: "add" };
			if (normalized === "b" || normalized === "forecast") return { mode: "forecast" };
			if (normalized === "x" || normalized === "fix") return { mode: "fix" };
			if (normalized === "s" || normalized === "settings") {
				const settingsResult = await promptSettingsModeFallback(
					rl,
					options.syncFromCodexMultiAuthEnabled === true,
				);
				if (settingsResult) return settingsResult;
				continue;
			}
			if (normalized === "f" || normalized === "fresh") return { mode: "fresh", deleteAll: true };
			if (normalized === "c" || normalized === "check") return { mode: "check" };
			if (normalized === "d" || normalized === "deep") return { mode: "deep-check" };
			if (normalized === "g" || normalized === "verify" || normalized === "problem") return { mode: "verify-flagged" };
			if (normalized === "q" || normalized === "quit") return { mode: "cancel" };
			console.log(UI_COPY.fallback.invalidModePrompt);
		}
	} finally {
		rl.close();
	}
}

export async function promptLoginMode(
	existingAccounts: ExistingAccountInfo[],
	options: LoginMenuOptions = {},
): Promise<LoginMenuResult> {
	if (isNonInteractiveMode()) {
		return { mode: "add" };
	}

	if (!isTTY()) {
		return promptLoginModeFallback(existingAccounts, options);
	}

	while (true) {
		const action = await showAuthMenu(existingAccounts, {
			flaggedCount: options.flaggedCount ?? 0,
			statusMessage: options.statusMessage,
		});

		switch (action.type) {
			case "add":
				return { mode: "add" };
			case "forecast":
				return { mode: "forecast" };
			case "fix":
				return { mode: "fix" };
			case "settings": {
				const settingsAction = await showSettingsMenu(options.syncFromCodexMultiAuthEnabled === true);
				if (settingsAction === "toggle-sync") return { mode: "experimental-toggle-sync" };
				if (settingsAction === "sync-now") return { mode: "experimental-sync-now" };
				if (settingsAction === "cleanup-overlaps") return { mode: "experimental-cleanup-overlaps" };
				if (settingsAction === "cleanup-duplicate-emails") return { mode: "maintenance-clean-duplicate-emails" };
				continue;
			}
			case "fresh":
				if (!(await promptDeleteAllTypedConfirm())) {
					console.log("\nDelete all cancelled.\n");
					continue;
				}
				return { mode: "fresh", deleteAll: true };
			case "check":
				return { mode: "check" };
			case "deep-check":
				return { mode: "deep-check" };
			case "verify-flagged":
				return { mode: "verify-flagged" };
			case "set-current-account": {
				const index = resolveAccountSourceIndex(action.account);
				if (index >= 0) return { mode: "manage", switchAccountIndex: index };
				continue;
			}
			case "select-account": {
				const accountAction = await showAccountDetails(action.account);
				if (accountAction === "delete") {
					const index = resolveAccountSourceIndex(action.account);
					if (index >= 0) return { mode: "manage", deleteAccountIndex: index };
					continue;
				}
				if (accountAction === "set-current") {
					const index = resolveAccountSourceIndex(action.account);
					if (index >= 0) return { mode: "manage", switchAccountIndex: index };
					continue;
				}
				if (accountAction === "refresh") {
					const index = resolveAccountSourceIndex(action.account);
					if (index >= 0) return { mode: "manage", refreshAccountIndex: index };
					continue;
				}
				if (accountAction === "toggle") {
					const index = resolveAccountSourceIndex(action.account);
					if (index >= 0) return { mode: "manage", toggleAccountIndex: index };
					continue;
				}
				continue;
			}
			case "search":
				continue;
			case "delete-all":
				if (!(await promptDeleteAllTypedConfirm())) {
					console.log("\nDelete all cancelled.\n");
					continue;
				}
				return { mode: "fresh", deleteAll: true };
			case "cancel":
				return { mode: "cancel" };
		}
	}
}

export interface AccountSelectionCandidate {
	accountId: string;
	label: string;
	source?: AccountIdSource;
	isDefault?: boolean;
}

export interface AccountSelectionOptions {
	defaultIndex?: number;
	title?: string;
}

export async function promptAccountSelection(
	candidates: AccountSelectionCandidate[],
	options: AccountSelectionOptions = {},
): Promise<AccountSelectionCandidate | null> {
	if (candidates.length === 0) return null;
	const defaultIndex =
		typeof options.defaultIndex === "number" && Number.isFinite(options.defaultIndex)
			? Math.max(0, Math.min(options.defaultIndex, candidates.length - 1))
			: 0;

	if (isNonInteractiveMode()) {
		return candidates[defaultIndex] ?? candidates[0] ?? null;
	}

	const rl = createInterface({ input, output });
	try {
		console.log(`\n${options.title ?? "Multiple workspaces detected for this account:"}`);
		candidates.forEach((candidate, index) => {
			const isDefault = candidate.isDefault ? " (default)" : "";
			console.log(`  ${index + 1}. ${candidate.label}${isDefault}`);
		});
		console.log("");

		while (true) {
			const answer = await rl.question(`Select workspace [${defaultIndex + 1}]: `);
			const normalized = answer.trim().toLowerCase();
			if (!normalized) {
				return candidates[defaultIndex] ?? candidates[0] ?? null;
			}
			if (normalized === "q" || normalized === "quit") {
				return candidates[defaultIndex] ?? candidates[0] ?? null;
			}
			const parsed = Number.parseInt(normalized, 10);
			if (Number.isFinite(parsed)) {
				const idx = parsed - 1;
				if (idx >= 0 && idx < candidates.length) {
					return candidates[idx] ?? null;
				}
			}
			console.log(`Please enter a number between 1 and ${candidates.length}.`);
		}
	} finally {
		rl.close();
	}
}

export { isTTY };
export type { AccountStatus };
