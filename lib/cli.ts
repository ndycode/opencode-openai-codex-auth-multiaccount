import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import type { AccountIdSource } from "./types.js";

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

export async function promptAddAnotherAccount(
  currentCount: number,
): Promise<boolean> {
  if (isNonInteractiveMode()) {
    return false;
  }

  const rl = createInterface({ input, output });
  try {
    console.log(
      "\n⚠️  TIP: Use incognito/private browsing or log out of ChatGPT before adding another account.\n",
    );
    const answer = await rl.question(
      `Add another account? (${currentCount} added) (y/n): `,
    );
    const normalized = answer.trim().toLowerCase();
    return normalized === "y" || normalized === "yes";
  } finally {
    rl.close();
  }
}

export type LoginMode = "add" | "fresh";

export interface ExistingAccountInfo {
  accountId?: string;
  accountLabel?: string;
  email?: string;
  index: number;
}

function formatAccountLabel(account: ExistingAccountInfo, index: number): string {
  const num = index + 1;
  const label = account.accountLabel?.trim();
  if (account.email?.trim()) {
    return label ? `${num}. ${label} (${account.email})` : `${num}. ${account.email}`;
  }
  if (label) {
    return `${num}. ${label}`;
  }
  if (account.accountId?.trim()) {
    const suffix = account.accountId.length > 6 ? account.accountId.slice(-6) : account.accountId;
    return `${num}. ${suffix}`;
  }
  return `${num}. Account`;
}

export async function promptLoginMode(
  existingAccounts: ExistingAccountInfo[],
): Promise<LoginMode> {
  if (isNonInteractiveMode()) {
    return "add";
  }

  const rl = createInterface({ input, output });
  try {
    console.log(`\n${existingAccounts.length} account(s) saved:`);
    for (const account of existingAccounts) {
      console.log(`  ${formatAccountLabel(account, account.index)}`);
    }
    console.log("");

    while (true) {
      const answer = await rl.question(
        "(a)dd new account(s) or (f)resh start? [a/f]: ",
      );
      const normalized = answer.trim().toLowerCase();
      if (normalized === "a" || normalized === "add") {
        return "add";
      }
      if (normalized === "f" || normalized === "fresh") {
        return "fresh";
      }
      console.log("Please enter 'a' to add accounts or 'f' to start fresh.");
    }
  } finally {
    rl.close();
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
      const answer = await rl.question(
        `Select workspace [${defaultIndex + 1}]: `,
      );
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
