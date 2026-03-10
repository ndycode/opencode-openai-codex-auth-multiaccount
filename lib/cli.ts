import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import type { AccountIdSource } from "./types.js";
import {
	showAuthMenu,
	showAccountDetails,
	showSyncToolsMenu,
	isTTY,
	type AccountStatus,
} from "./ui/auth-menu.js";

/**
 * Detect if running in OpenCode Desktop/TUI mode where readline prompts don't work.
 * In TUI mode, stdin/stdout are controlled by the TUI renderer, so readline breaks.
 * Exported for testing purposes.
 */
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
		console.log("\nTIP: use private browsing or sign out before adding another account.\n");
		const answer = await rl.question(`Add another account? (${currentCount} added) (y/n): `);
		const normalized = answer.trim().toLowerCase();
		return normalized === "y" || normalized === "yes";
	} finally {
		rl.close();
	}
}

export type LoginMode =
	| "add"
	| "fresh"
	| "manage"
	| "check"
	| "deep-check"
	| "verify-flagged"
	| "experimental-toggle-sync"
	| "experimental-sync-now"
	| "experimental-cleanup-overlaps"
	| "cancel";

export interface ExistingAccountInfo {
	accountId?: string;
	accountLabel?: string;
	email?: string;
	index: number;
	addedAt?: number;
	lastUsed?: number;
	status?: AccountStatus;
	isCurrentAccount?: boolean;
	enabled?: boolean;
}

export interface LoginMenuOptions {
	flaggedCount?: number;
	syncFromCodexMultiAuthEnabled?: boolean;
}

export interface LoginMenuResult {
	mode: LoginMode;
	deleteAccountIndex?: number;
	refreshAccountIndex?: number;
	toggleAccountIndex?: number;
	deleteAll?: boolean;
}

function formatAccountLabel(account: ExistingAccountInfo, index: number): string {
	const num = index + 1;
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
	if (details.length > 0) {
		return `${num}. ${details.join(" | ")}`;
	}
	return `${num}. Account`;
}

async function promptDeleteAllTypedConfirm(): Promise<boolean> {
	const rl = createInterface({ input, output });
	try {
		const answer = await rl.question("Type DELETE to confirm removing all accounts: ");
		return answer.trim() === "DELETE";
	} finally {
		rl.close();
	}
}

async function promptSyncToolsFallback(
	rl: ReturnType<typeof createInterface>,
	syncEnabled: boolean,
): Promise<LoginMenuResult | null> {
	while (true) {
		const syncState = syncEnabled ? "enabled" : "disabled";
		const answer = await rl.question(
			`Sync tools: (t)oggle [${syncState}], (i)mport now, (o)verlap cleanup, (b)ack [t/i/o/b]: `,
		);
		const normalized = answer.trim().toLowerCase();
		if (normalized === "t" || normalized === "toggle") return { mode: "experimental-toggle-sync" };
		if (normalized === "i" || normalized === "import") return { mode: "experimental-sync-now" };
		if (normalized === "o" || normalized === "overlap") return { mode: "experimental-cleanup-overlaps" };
		if (normalized === "b" || normalized === "back") return null;
		console.log("Please enter one of: t, i, o, b.");
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

			const tokens = normalized.split(",").map((value) => value.trim());
			if (tokens.length === 0 || tokens.some((value) => !/^\d+$/.test(value))) {
				console.log("Enter comma-separated account numbers (for example: 1,2).");
				continue;
			}
			const allowedIndexes = new Set(candidates.map((candidate) => candidate.index));
			const unique = Array.from(new Set(tokens.map((value) => Number.parseInt(value, 10) - 1)));
			if (unique.some((index) => !allowedIndexes.has(index))) {
				console.log("Enter only account numbers shown above.");
				continue;
			}
			if (unique.length < neededCount) {
				console.log(`Select at least ${neededCount} unique account number(s).`);
				continue;
			}
			return unique;
		}
	} finally {
		rl.close();
	}
}

async function promptLoginModeFallback(
	existingAccounts: ExistingAccountInfo[],
	options: LoginMenuOptions,
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
			const answer = await rl.question("(a)dd, (f)resh, (c)heck, (d)eep, (v)erify flagged, s(y)nc tools, or (q)uit? [a/f/c/d/v/s/q]: ");
			const normalized = answer.trim().toLowerCase();
			if (normalized === "a" || normalized === "add") return { mode: "add" };
			if (normalized === "f" || normalized === "fresh") return { mode: "fresh", deleteAll: true };
			if (normalized === "c" || normalized === "check") return { mode: "check" };
			if (normalized === "d" || normalized === "deep") return { mode: "deep-check" };
			if (normalized === "v" || normalized === "verify") return { mode: "verify-flagged" };
			if (normalized === "s" || normalized === "sync" || normalized === "y") {
				const syncAction = await promptSyncToolsFallback(
					rl,
					options.syncFromCodexMultiAuthEnabled === true,
				);
				if (syncAction) return syncAction;
				continue;
			}
			if (normalized === "q" || normalized === "quit") return { mode: "cancel" };
			console.log("Please enter one of: a, f, c, d, v, s, q.");
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
			syncFromCodexMultiAuthEnabled: options.syncFromCodexMultiAuthEnabled === true,
		});

		switch (action.type) {
			case "add":
				return { mode: "add" };
			case "fresh":
				if (!(await promptDeleteAllTypedConfirm())) {
					console.log("\nDelete-all cancelled.\n");
					continue;
				}
				return { mode: "fresh", deleteAll: true };
			case "check":
				return { mode: "check" };
			case "deep-check":
				return { mode: "deep-check" };
			case "verify-flagged":
				return { mode: "verify-flagged" };
			case "sync-tools": {
				const syncAction = await showSyncToolsMenu(options.syncFromCodexMultiAuthEnabled === true);
				if (syncAction === "toggle-sync") return { mode: "experimental-toggle-sync" };
				if (syncAction === "sync-now") return { mode: "experimental-sync-now" };
				if (syncAction === "cleanup-overlaps") return { mode: "experimental-cleanup-overlaps" };
				continue;
			}
			case "select-account": {
				const accountAction = await showAccountDetails(action.account);
				if (accountAction === "delete") {
					return { mode: "manage", deleteAccountIndex: action.account.index };
				}
				if (accountAction === "refresh") {
					return { mode: "manage", refreshAccountIndex: action.account.index };
				}
				if (accountAction === "toggle") {
					return { mode: "manage", toggleAccountIndex: action.account.index };
				}
				continue;
			}
			case "delete-all":
				if (!(await promptDeleteAllTypedConfirm())) {
					console.log("\nDelete-all cancelled.\n");
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
