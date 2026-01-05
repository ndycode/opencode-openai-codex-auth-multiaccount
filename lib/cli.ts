import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

export async function promptAddAnotherAccount(
  currentCount: number,
): Promise<boolean> {
  const rl = createInterface({ input, output });
  try {
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
  email?: string;
  index: number;
}

function formatAccountLabel(account: ExistingAccountInfo, index: number): string {
  if (account.email?.trim()) {
    return `Account ${index + 1} (${account.email})`;
  }
  if (account.accountId?.trim()) {
    const suffix = account.accountId.length > 6 ? account.accountId.slice(-6) : account.accountId;
    return `Account ${index + 1} (${suffix})`;
  }
  return `Account ${index + 1}`;
}

export async function promptLoginMode(
  existingAccounts: ExistingAccountInfo[],
): Promise<LoginMode> {
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
