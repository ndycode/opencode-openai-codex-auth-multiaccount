import { promises as fs } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { createLogger } from "./logger.js";

const log = createLogger("storage");

export type CooldownReason = "auth-failure" | "network-error";

export interface AccountMetadataV1 {
  accountId?: string;
  refreshToken: string;
  addedAt: number;
  lastUsed: number;
  lastSwitchReason?: "rate-limit" | "initial" | "rotation";
  rateLimitResetTime?: number;
  coolingDownUntil?: number;
  cooldownReason?: CooldownReason;
}

export interface AccountStorageV1 {
  version: 1;
  accounts: AccountMetadataV1[];
  activeIndex: number;
}

type AnyAccountStorage = AccountStorageV1;

function getConfigDir(): string {
  return join(homedir(), ".opencode");
}

export function getStoragePath(): string {
  return join(getConfigDir(), "openai-codex-accounts.json");
}

function selectNewestAccount(
  current: AccountMetadataV1 | undefined,
  candidate: AccountMetadataV1,
): AccountMetadataV1 {
  if (!current) return candidate;
  const currentLastUsed = current.lastUsed || 0;
  const candidateLastUsed = candidate.lastUsed || 0;
  if (candidateLastUsed > currentLastUsed) return candidate;
  if (candidateLastUsed < currentLastUsed) return current;
  const currentAddedAt = current.addedAt || 0;
  const candidateAddedAt = candidate.addedAt || 0;
  return candidateAddedAt >= currentAddedAt ? candidate : current;
}

export function deduplicateAccounts(
  accounts: AccountMetadataV1[],
): AccountMetadataV1[] {
  const keyToIndex = new Map<string, number>();
  const indicesToKeep = new Set<number>();

  for (let i = 0; i < accounts.length; i += 1) {
    const account = accounts[i];
    if (!account) continue;
    const key = account.accountId || account.refreshToken;
    if (!key) continue;

    const existingIndex = keyToIndex.get(key);
    if (existingIndex === undefined) {
      keyToIndex.set(key, i);
      continue;
    }

    const existing = accounts[existingIndex];
    const newest = selectNewestAccount(existing, account);
    keyToIndex.set(key, newest === account ? i : existingIndex);
  }

  for (const idx of keyToIndex.values()) {
    indicesToKeep.add(idx);
  }

  const result: AccountMetadataV1[] = [];
  for (let i = 0; i < accounts.length; i += 1) {
    if (indicesToKeep.has(i)) {
      const account = accounts[i];
      if (account) result.push(account);
    }
  }
  return result;
}

export async function loadAccounts(): Promise<AccountStorageV1 | null> {
  try {
    const path = getStoragePath();
    const content = await fs.readFile(path, "utf-8");
    const data = JSON.parse(content) as AnyAccountStorage;

    if (!Array.isArray(data.accounts)) {
      log.warn("Invalid storage format, ignoring");
      return null;
    }

    if (data.version !== 1) {
      log.warn("Unknown storage version, ignoring", {
        version: (data as { version?: unknown }).version,
      });
      return null;
    }

    const validAccounts = data.accounts.filter(
      (account): account is AccountMetadataV1 =>
        !!account && typeof account.refreshToken === "string",
    );

    const deduplicatedAccounts = deduplicateAccounts(validAccounts);

    let activeIndex =
      typeof data.activeIndex === "number" && Number.isFinite(data.activeIndex)
        ? data.activeIndex
        : 0;
    if (deduplicatedAccounts.length > 0) {
      activeIndex = Math.max(0, Math.min(activeIndex, deduplicatedAccounts.length - 1));
    } else {
      activeIndex = 0;
    }

    return {
      version: 1,
      accounts: deduplicatedAccounts,
      activeIndex,
    };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return null;
    }
    log.error("Failed to load account storage", { error: String(error) });
    return null;
  }
}

export async function saveAccounts(storage: AccountStorageV1): Promise<void> {
  const path = getStoragePath();
  await fs.mkdir(dirname(path), { recursive: true });
  const content = JSON.stringify(storage, null, 2);
  await fs.writeFile(path, content, "utf-8");
}

export async function clearAccounts(): Promise<void> {
  try {
    const path = getStoragePath();
    await fs.unlink(path);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      log.error("Failed to clear account storage", { error: String(error) });
    }
  }
}
