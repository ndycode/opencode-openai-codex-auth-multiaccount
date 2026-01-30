import { promises as fs, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { ACCOUNT_LIMITS } from "./constants.js";
import { homedir } from "node:os";
import { createLogger } from "./logger.js";
import { MODEL_FAMILIES, type ModelFamily } from "./prompts/codex.js";
import type { AccountIdSource } from "./types.js";

const log = createLogger("storage");

let storageMutex: Promise<void> = Promise.resolve();

function withStorageLock<T>(fn: () => Promise<T>): Promise<T> {
  const previousMutex = storageMutex;
  let releaseLock: () => void;
  storageMutex = new Promise<void>((resolve) => {
    releaseLock = resolve;
  });
  return previousMutex.then(fn).finally(() => releaseLock());
}

export type CooldownReason = "auth-failure" | "network-error";

export interface RateLimitStateV3 {
  [key: string]: number | undefined;
}

export interface AccountMetadataV1 {
  accountId?: string;
  accountIdSource?: AccountIdSource;
  accountLabel?: string;
  email?: string;
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

export interface AccountMetadataV3 {
  accountId?: string;
  accountIdSource?: AccountIdSource;
  accountLabel?: string;
  email?: string;
  refreshToken: string;
  addedAt: number;
  lastUsed: number;
  lastSwitchReason?: "rate-limit" | "initial" | "rotation";
  rateLimitResetTimes?: RateLimitStateV3;
  coolingDownUntil?: number;
  cooldownReason?: CooldownReason;
}

export interface AccountStorageV3 {
  version: 3;
  accounts: AccountMetadataV3[];
  activeIndex: number;
  activeIndexByFamily?: Partial<Record<ModelFamily, number>>;
}

type AnyAccountStorage = AccountStorageV1 | AccountStorageV3;

type AccountLike = {
  accountId?: string;
  email?: string;
  refreshToken: string;
  addedAt?: number;
  lastUsed?: number;
};

function getConfigDir(): string {
  return join(homedir(), ".opencode");
}

function getProjectConfigDir(projectPath: string): string {
  return join(projectPath, ".opencode");
}

const PROJECT_MARKERS = [".git", "package.json", "Cargo.toml", "go.mod", "pyproject.toml", ".opencode"];

function isProjectDirectory(dir: string): boolean {
  return PROJECT_MARKERS.some((marker) => existsSync(join(dir, marker)));
}

/**
 * Walk up the directory tree to find the nearest project root.
 * Returns the first directory containing a project marker, or null if none found.
 */
function findProjectRoot(startDir: string): string | null {
  let current = startDir;
  const root = dirname(current) === current ? current : null;
  
  while (current) {
    if (isProjectDirectory(current)) {
      return current;
    }
    
    const parent = dirname(current);
    // Reached filesystem root
    if (parent === current) {
      break;
    }
    current = parent;
  }
  
  return root && isProjectDirectory(root) ? root : null;
}

let currentStoragePath: string | null = null;

export function setStoragePath(projectPath: string | null): void {
  if (!projectPath) {
    currentStoragePath = null;
    return;
  }
  
  const projectRoot = findProjectRoot(projectPath);
  if (projectRoot) {
    currentStoragePath = join(getProjectConfigDir(projectRoot), "openai-codex-accounts.json");
  } else {
    currentStoragePath = null;
  }
}

/**
 * Returns the file path for the account storage JSON file.
 * @returns Absolute path to the accounts.json file
 */
export function getStoragePath(): string {
  if (currentStoragePath) {
    return currentStoragePath;
  }
  return join(getConfigDir(), "openai-codex-accounts.json");
}

function nowMs(): number {
  return Date.now();
}

function selectNewestAccount<T extends AccountLike>(
  current: T | undefined,
  candidate: T,
): T {
  if (!current) return candidate;
  const currentLastUsed = current.lastUsed || 0;
  const candidateLastUsed = candidate.lastUsed || 0;
  if (candidateLastUsed > currentLastUsed) return candidate;
  if (candidateLastUsed < currentLastUsed) return current;
  const currentAddedAt = current.addedAt || 0;
  const candidateAddedAt = candidate.addedAt || 0;
  return candidateAddedAt >= currentAddedAt ? candidate : current;
}

function deduplicateAccountsByKey<T extends AccountLike>(accounts: T[]): T[] {
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

  const result: T[] = [];
  for (let i = 0; i < accounts.length; i += 1) {
    if (indicesToKeep.has(i)) {
      const account = accounts[i];
      if (account) result.push(account);
    }
  }
  return result;
}

/**
 * Removes duplicate accounts, keeping the most recently used entry for each unique key.
 * Deduplication is based on accountId or refreshToken.
 * @param accounts - Array of accounts to deduplicate
 * @returns New array with duplicates removed
 */
export function deduplicateAccounts<T extends { accountId?: string; refreshToken: string; lastUsed?: number; addedAt?: number }>(
  accounts: T[],
): T[] {
  return deduplicateAccountsByKey(accounts);
}

/**
 * Removes duplicate accounts by email, keeping the most recently used entry.
 * Accounts without email are always preserved.
 * @param accounts - Array of accounts to deduplicate
 * @returns New array with email duplicates removed
 */
export function deduplicateAccountsByEmail<T extends { email?: string; lastUsed?: number; addedAt?: number }>(
  accounts: T[],
): T[] {
  const emailToNewestIndex = new Map<string, number>();
  const indicesToKeep = new Set<number>();

  for (let i = 0; i < accounts.length; i += 1) {
    const account = accounts[i];
    if (!account) continue;

    const email = account.email?.trim();
    if (!email) {
      indicesToKeep.add(i);
      continue;
    }

    const existingIndex = emailToNewestIndex.get(email);
    if (existingIndex === undefined) {
      emailToNewestIndex.set(email, i);
      continue;
    }

    const existing = accounts[existingIndex];
    if (!existing) {
      emailToNewestIndex.set(email, i);
      continue;
    }

    const existingLastUsed = existing.lastUsed || 0;
    const candidateLastUsed = account.lastUsed || 0;
    const existingAddedAt = existing.addedAt || 0;
    const candidateAddedAt = account.addedAt || 0;

    const isNewer =
      candidateLastUsed > existingLastUsed ||
      (candidateLastUsed === existingLastUsed && candidateAddedAt > existingAddedAt);

    if (isNewer) {
      emailToNewestIndex.set(email, i);
    }
  }

  for (const idx of emailToNewestIndex.values()) {
    indicesToKeep.add(idx);
  }

  const result: T[] = [];
  for (let i = 0; i < accounts.length; i += 1) {
    if (indicesToKeep.has(i)) {
      const account = accounts[i];
      if (account) result.push(account);
    }
  }
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function clampIndex(index: number, length: number): number {
  if (length <= 0) return 0;
  return Math.max(0, Math.min(index, length - 1));
}

function toAccountKey(account: Pick<AccountMetadataV3, "accountId" | "refreshToken">): string {
  return account.accountId || account.refreshToken;
}

function extractActiveKey(accounts: unknown[], activeIndex: number): string | undefined {
  const candidate = accounts[activeIndex];
  if (!isRecord(candidate)) return undefined;

  const accountId =
    typeof candidate.accountId === "string" && candidate.accountId.trim()
      ? candidate.accountId
      : undefined;
  const refreshToken =
    typeof candidate.refreshToken === "string" && candidate.refreshToken.trim()
      ? candidate.refreshToken
      : undefined;

  return accountId || refreshToken;
}

function migrateV1ToV3(v1: AccountStorageV1): AccountStorageV3 {
  const now = nowMs();
  return {
    version: 3,
    accounts: v1.accounts.map((account) => {
      const rateLimitResetTimes: RateLimitStateV3 = {};
      if (typeof account.rateLimitResetTime === "number" && account.rateLimitResetTime > now) {
        for (const family of MODEL_FAMILIES) {
          rateLimitResetTimes[family] = account.rateLimitResetTime;
        }
      }
      return {
        accountId: account.accountId,
        accountIdSource: account.accountIdSource,
        accountLabel: account.accountLabel,
        email: account.email,
        refreshToken: account.refreshToken,
        addedAt: account.addedAt,
        lastUsed: account.lastUsed,
        lastSwitchReason: account.lastSwitchReason,
        rateLimitResetTimes: Object.keys(rateLimitResetTimes).length > 0 ? rateLimitResetTimes : undefined,
        coolingDownUntil: account.coolingDownUntil,
        cooldownReason: account.cooldownReason,
      };
    }),
    activeIndex: v1.activeIndex,
    activeIndexByFamily: {
      "gpt-5.2-codex": v1.activeIndex,
      "codex-max": v1.activeIndex,
      codex: v1.activeIndex,
      "gpt-5.2": v1.activeIndex,
      "gpt-5.1": v1.activeIndex,
    },
  };
}

/**
 * Normalizes and validates account storage data, migrating from v1 to v3 if needed.
 * Handles deduplication, index clamping, and per-family active index mapping.
 * @param data - Raw storage data (unknown format)
 * @returns Normalized AccountStorageV3 or null if invalid
 */
export function normalizeAccountStorage(data: unknown): AccountStorageV3 | null {
  if (!isRecord(data)) {
    log.warn("Invalid storage format, ignoring");
    return null;
  }

  if (data.version !== 1 && data.version !== 3) {
    log.warn("Unknown storage version, ignoring", {
      version: (data as { version?: unknown }).version,
    });
    return null;
  }

  const rawAccounts = data.accounts;
  if (!Array.isArray(rawAccounts)) {
    log.warn("Invalid storage format, ignoring");
    return null;
  }

  const activeIndexValue =
    typeof data.activeIndex === "number" && Number.isFinite(data.activeIndex)
      ? data.activeIndex
      : 0;

  const rawActiveIndex = clampIndex(activeIndexValue, rawAccounts.length);
  const activeKey = extractActiveKey(rawAccounts, rawActiveIndex);

  const fromVersion = data.version as AnyAccountStorage["version"];
  const baseStorage: AccountStorageV3 =
    fromVersion === 1
      ? migrateV1ToV3(data as unknown as AccountStorageV1)
      : (data as unknown as AccountStorageV3);

  const validAccounts = rawAccounts.filter(
    (account): account is AccountMetadataV3 =>
      isRecord(account) && typeof account.refreshToken === "string" && !!account.refreshToken.trim(),
  );

  const deduplicatedAccounts = deduplicateAccountsByEmail(
    deduplicateAccountsByKey(validAccounts),
  );

  const activeIndex = (() => {
    if (deduplicatedAccounts.length === 0) return 0;

    if (activeKey) {
      const mappedIndex = deduplicatedAccounts.findIndex(
        (account) => toAccountKey(account) === activeKey,
      );
      if (mappedIndex >= 0) return mappedIndex;
    }

    return clampIndex(rawActiveIndex, deduplicatedAccounts.length);
  })();

  const activeIndexByFamily: Partial<Record<ModelFamily, number>> = {};
  const rawFamilyIndices = isRecord(baseStorage.activeIndexByFamily)
    ? (baseStorage.activeIndexByFamily as Record<string, unknown>)
    : {};

  for (const family of MODEL_FAMILIES) {
    const rawIndexValue = rawFamilyIndices[family];
    const rawIndex =
      typeof rawIndexValue === "number" && Number.isFinite(rawIndexValue)
        ? rawIndexValue
        : rawActiveIndex;

    const clampedRawIndex = clampIndex(rawIndex, rawAccounts.length);
    const familyKey = extractActiveKey(rawAccounts, clampedRawIndex);

    let mappedIndex = clampIndex(rawIndex, deduplicatedAccounts.length);
    if (familyKey && deduplicatedAccounts.length > 0) {
      const idx = deduplicatedAccounts.findIndex(
        (account) => toAccountKey(account) === familyKey,
      );
      if (idx >= 0) {
        mappedIndex = idx;
      }
    }

    activeIndexByFamily[family] = mappedIndex;
  }

  return {
    version: 3,
    accounts: deduplicatedAccounts,
    activeIndex,
    activeIndexByFamily,
  };
}

/**
 * Loads OAuth accounts from disk storage.
 * Automatically migrates v1 storage to v3 format if needed.
 * @returns AccountStorageV3 if file exists and is valid, null otherwise
 */
export async function loadAccounts(): Promise<AccountStorageV3 | null> {
  try {
    const path = getStoragePath();
    const content = await fs.readFile(path, "utf-8");
    const data = JSON.parse(content) as unknown;

    const normalized = normalizeAccountStorage(data);

    const storedVersion = isRecord(data) ? (data as { version?: unknown }).version : undefined;
    if (normalized && storedVersion !== normalized.version) {
      log.info("Migrating account storage to v3", { from: storedVersion, to: normalized.version });
      try {
        await saveAccounts(normalized);
      } catch (saveError) {
        log.warn("Failed to persist migrated storage", { error: String(saveError) });
      }
    }

    return normalized;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return null;
    }
    log.error("Failed to load account storage", { error: String(error) });
    return null;
  }
}

/**
 * Persists account storage to disk.
 * Creates the .opencode directory if it doesn't exist.
 * @param storage - Account storage data to save
 */
export async function saveAccounts(storage: AccountStorageV3): Promise<void> {
  return withStorageLock(async () => {
    const path = getStoragePath();
    await fs.mkdir(dirname(path), { recursive: true });
    const content = JSON.stringify(storage, null, 2);
    await fs.writeFile(path, content, "utf-8");
  });
}

/**
 * Deletes the account storage file from disk.
 * Silently ignores if file doesn't exist.
 */
export async function clearAccounts(): Promise<void> {
  return withStorageLock(async () => {
    try {
      const path = getStoragePath();
      await fs.unlink(path);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        log.error("Failed to clear account storage", { error: String(error) });
      }
    }
  });
}

/**
 * Resolves a file path, expanding tilde to home directory.
 */
function resolvePath(filePath: string): string {
  if (filePath.startsWith("~")) {
    return join(homedir(), filePath.slice(1));
  }
  return resolve(filePath);
}

/**
 * Exports current accounts to a JSON file for backup/migration.
 * @param filePath - Destination file path
 * @param force - If true, overwrite existing file (default: true)
 * @throws Error if file exists and force is false, or if no accounts to export
 */
export async function exportAccounts(filePath: string, force = true): Promise<void> {
  const resolvedPath = resolvePath(filePath);
  
  if (!force && existsSync(resolvedPath)) {
    throw new Error(`File already exists: ${resolvedPath}`);
  }
  
  const storage = await loadAccounts();
  if (!storage || storage.accounts.length === 0) {
    throw new Error("No accounts to export");
  }
  
  await fs.mkdir(dirname(resolvedPath), { recursive: true });
  
  const content = JSON.stringify(storage, null, 2);
  await fs.writeFile(resolvedPath, content, "utf-8");
  log.info("Exported accounts", { path: resolvedPath, count: storage.accounts.length });
}

/**
 * Imports accounts from a JSON file, merging with existing accounts.
 * Deduplicates by accountId/email, preserving most recently used entries.
 * @param filePath - Source file path
 * @throws Error if file is invalid or would exceed MAX_ACCOUNTS
 */
export async function importAccounts(filePath: string): Promise<{ imported: number; total: number }> {
  const resolvedPath = resolvePath(filePath);
  
  const content = await fs.readFile(resolvedPath, "utf-8");
  const imported = JSON.parse(content) as unknown;
  
  const normalized = normalizeAccountStorage(imported);
  if (!normalized) {
    throw new Error("Invalid account storage format");
  }
  
  const existing = await loadAccounts();
  const existingAccounts = existing?.accounts ?? [];
  const existingActiveIndex = existing?.activeIndex ?? 0;
  
  const merged = [...existingAccounts, ...normalized.accounts];
  
  if (merged.length > ACCOUNT_LIMITS.MAX_ACCOUNTS) {
    const deduped = deduplicateAccountsByEmail(deduplicateAccounts(merged));
    if (deduped.length > ACCOUNT_LIMITS.MAX_ACCOUNTS) {
      throw new Error(
        `Import would exceed maximum of ${ACCOUNT_LIMITS.MAX_ACCOUNTS} accounts (would have ${deduped.length})`
      );
    }
  }
  
  const deduplicatedAccounts = deduplicateAccountsByEmail(deduplicateAccounts(merged));
  
  const newStorage: AccountStorageV3 = {
    version: 3,
    accounts: deduplicatedAccounts,
    activeIndex: existingActiveIndex,
    activeIndexByFamily: existing?.activeIndexByFamily,
  };
  
  await saveAccounts(newStorage);
  
  const importedCount = deduplicatedAccounts.length - existingAccounts.length;
  log.info("Imported accounts", { path: resolvedPath, imported: importedCount, total: deduplicatedAccounts.length });
  
  return { imported: importedCount, total: deduplicatedAccounts.length };
}
