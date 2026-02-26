import { promises as fs, existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { ACCOUNT_LIMITS } from "./constants.js";
import { createLogger } from "./logger.js";
import { MODEL_FAMILIES, type ModelFamily } from "./prompts/codex.js";
import { AnyAccountStorageSchema, getValidationErrors } from "./schemas.js";
import { getConfigDir, getProjectConfigDir, getProjectGlobalConfigDir, findProjectRoot, resolvePath } from "./storage/paths.js";
import {
  migrateV1ToV3,
  type CooldownReason,
  type RateLimitStateV3,
  type AccountMetadataV1,
  type AccountStorageV1,
  type AccountMetadataV3,
  type AccountStorageV3,
} from "./storage/migrations.js";

export type { CooldownReason, RateLimitStateV3, AccountMetadataV1, AccountStorageV1, AccountMetadataV3, AccountStorageV3 };

const log = createLogger("storage");
const ACCOUNTS_FILE_NAME = "openai-codex-accounts.json";
const FLAGGED_ACCOUNTS_FILE_NAME = "openai-codex-flagged-accounts.json";
const LEGACY_FLAGGED_ACCOUNTS_FILE_NAME = "openai-codex-blocked-accounts.json";

export interface FlaggedAccountMetadataV1 extends AccountMetadataV3 {
	flaggedAt: number;
	flaggedReason?: string;
	lastError?: string;
}

export interface FlaggedAccountStorageV1 {
	version: 1;
	accounts: FlaggedAccountMetadataV1[];
}

export type ImportBackupMode = "none" | "best-effort" | "required";

export interface ImportAccountsOptions {
	/**
	 * Optional prefix used for pre-import backup file names.
	 * Only applied when backupMode is not "none".
	 */
	preImportBackupPrefix?: string;
	/**
	 * Backup policy before import apply:
	 * - none: do not create a pre-import backup
	 * - best-effort: attempt backup, continue on failure
	 * - required: backup must succeed or import aborts
	 */
	backupMode?: ImportBackupMode;
}

export type ImportBackupStatus = "created" | "skipped" | "failed";

export interface ImportAccountsResult {
	imported: number;
	total: number;
	skipped: number;
	backupStatus: ImportBackupStatus;
	backupPath?: string;
	backupError?: string;
}

/**
 * Custom error class for storage operations with platform-aware hints.
 */
export class StorageError extends Error {
  readonly code: string;
  readonly path: string;
  readonly hint: string;

  constructor(message: string, code: string, path: string, hint: string, cause?: Error) {
    super(message, { cause });
    this.name = "StorageError";
    this.code = code;
    this.path = path;
    this.hint = hint;
  }
}

/**
 * Generate platform-aware troubleshooting hint based on error code.
 */
export function formatStorageErrorHint(error: unknown, path: string): string {
  const err = error as NodeJS.ErrnoException;
  const code = err?.code || "UNKNOWN";
  const isWindows = process.platform === "win32";

  switch (code) {
    case "EACCES":
    case "EPERM":
      return isWindows
        ? `Permission denied writing to ${path}. Check antivirus exclusions for this folder. Ensure you have write permissions.`
        : `Permission denied writing to ${path}. Check folder permissions. Try: chmod 755 ~/.opencode`;
    case "EBUSY":
      return `File is locked at ${path}. The file may be open in another program. Close any editors or processes accessing it.`;
    case "ENOSPC":
      return `Disk is full. Free up space and try again. Path: ${path}`;
    case "EEMPTY":
      return `File written but is empty. This may indicate a disk or filesystem issue. Path: ${path}`;
    default:
      return isWindows
        ? `Failed to write to ${path}. Check folder permissions and ensure path contains no special characters.`
        : `Failed to write to ${path}. Check folder permissions and disk space.`;
  }
}

let storageMutex: Promise<void> = Promise.resolve();

function withStorageLock<T>(fn: () => Promise<T>): Promise<T> {
  const previousMutex = storageMutex;
  let releaseLock: () => void;
  storageMutex = new Promise<void>((resolve) => {
    releaseLock = resolve;
  });
  return previousMutex.then(fn).finally(() => releaseLock());
}

const WINDOWS_RENAME_RETRY_ATTEMPTS = 5;
const WINDOWS_RENAME_RETRY_BASE_DELAY_MS = 10;
const PRE_IMPORT_BACKUP_WRITE_TIMEOUT_MS = 3_000;

function isWindowsLockError(error: unknown): error is NodeJS.ErrnoException {
  const code = (error as NodeJS.ErrnoException)?.code;
  return code === "EPERM" || code === "EBUSY";
}

async function renameWithWindowsRetry(sourcePath: string, destinationPath: string): Promise<void> {
  let lastError: NodeJS.ErrnoException | null = null;

  for (let attempt = 0; attempt < WINDOWS_RENAME_RETRY_ATTEMPTS; attempt += 1) {
    try {
      await fs.rename(sourcePath, destinationPath);
      return;
    } catch (error) {
      if (isWindowsLockError(error)) {
        lastError = error;
        await new Promise((resolve) =>
          setTimeout(resolve, WINDOWS_RENAME_RETRY_BASE_DELAY_MS * 2 ** attempt),
        );
        continue;
      }
      throw error;
    }
  }

  if (lastError) {
    throw lastError;
  }
}

async function writeFileWithTimeout(filePath: string, content: string, timeoutMs: number): Promise<void> {
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);
  try {
    await fs.writeFile(filePath, content, {
      encoding: "utf-8",
      mode: 0o600,
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      const timeoutError = Object.assign(
        new Error(`Timed out writing file after ${timeoutMs}ms`),
        { code: "ETIMEDOUT" },
      );
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeoutHandle);
  }
}

async function writePreImportBackupFile(backupPath: string, snapshot: AccountStorageV3): Promise<void> {
  const uniqueSuffix = `${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
  const tempPath = `${backupPath}.${uniqueSuffix}.tmp`;

  try {
    await fs.mkdir(dirname(backupPath), { recursive: true });
    const backupContent = JSON.stringify(snapshot, null, 2);
    await writeFileWithTimeout(tempPath, backupContent, PRE_IMPORT_BACKUP_WRITE_TIMEOUT_MS);
    await renameWithWindowsRetry(tempPath, backupPath);
  } catch (error) {
    try {
      await fs.unlink(tempPath);
    } catch {
      // Best effort temp-file cleanup.
    }
    throw error;
  }
}

type AnyAccountStorage = AccountStorageV1 | AccountStorageV3;

type AccountLike = {
  organizationId?: string;
  accountId?: string;
  accountIdSource?: AccountMetadataV3["accountIdSource"];
  accountLabel?: string;
  email?: string;
  refreshToken: string;
  addedAt?: number;
  lastUsed?: number;
};

async function ensureGitignore(storagePath: string): Promise<void> {
  if (!currentStoragePath) return;

  const configDir = dirname(storagePath);
  const inferredProjectRoot = dirname(configDir);
  const candidateRoots = [currentProjectRoot, inferredProjectRoot].filter(
    (root): root is string => typeof root === "string" && root.length > 0,
  );
  const projectRoot = candidateRoots.find((root) => existsSync(join(root, ".git")));
  if (!projectRoot) return;
  const gitignorePath = join(projectRoot, ".gitignore");

  try {
    let content = "";
    if (existsSync(gitignorePath)) {
      content = await fs.readFile(gitignorePath, "utf-8");
      const lines = content.split("\n").map((l) => l.trim());
      if (lines.includes(".opencode") || lines.includes(".opencode/") || lines.includes("/.opencode") || lines.includes("/.opencode/")) {
        return;
      }
    }

    const newContent = content.endsWith("\n") || content === "" ? content : content + "\n";
    await fs.writeFile(gitignorePath, newContent + ".opencode/\n", "utf-8");
    log.debug("Added .opencode to .gitignore", { path: gitignorePath });
  } catch (error) {
    log.warn("Failed to update .gitignore", { error: String(error) });
  }
}

let currentStoragePath: string | null = null;
let currentLegacyProjectStoragePath: string | null = null;
let currentProjectRoot: string | null = null;

export function setStoragePath(projectPath: string | null): void {
  if (!projectPath) {
    currentStoragePath = null;
    currentLegacyProjectStoragePath = null;
    currentProjectRoot = null;
    return;
  }
  
  const projectRoot = findProjectRoot(projectPath);
  if (projectRoot) {
    currentProjectRoot = projectRoot;
    currentStoragePath = join(getProjectGlobalConfigDir(projectRoot), ACCOUNTS_FILE_NAME);
    currentLegacyProjectStoragePath = join(getProjectConfigDir(projectRoot), ACCOUNTS_FILE_NAME);
  } else {
    currentStoragePath = null;
    currentLegacyProjectStoragePath = null;
    currentProjectRoot = null;
  }
}

export function setStoragePathDirect(path: string | null): void {
  currentStoragePath = path;
  currentLegacyProjectStoragePath = null;
  currentProjectRoot = null;
}

/**
 * Returns the file path for the account storage JSON file.
 * @returns Absolute path to the accounts.json file
 */
export function getStoragePath(): string {
  if (currentStoragePath) {
    return currentStoragePath;
  }
  return join(getConfigDir(), ACCOUNTS_FILE_NAME);
}

export function getFlaggedAccountsPath(): string {
	return join(dirname(getStoragePath()), FLAGGED_ACCOUNTS_FILE_NAME);
}

function getLegacyFlaggedAccountsPath(): string {
	return join(dirname(getStoragePath()), LEGACY_FLAGGED_ACCOUNTS_FILE_NAME);
}

async function migrateLegacyProjectStorageIfNeeded(
  persist: (storage: AccountStorageV3) => Promise<void> = saveAccounts,
): Promise<AccountStorageV3 | null> {
  if (
    !currentStoragePath ||
    !currentLegacyProjectStoragePath ||
    currentLegacyProjectStoragePath === currentStoragePath ||
    !existsSync(currentLegacyProjectStoragePath)
  ) {
    return null;
  }

  try {
    const legacyContent = await fs.readFile(currentLegacyProjectStoragePath, "utf-8");
    const legacyData = JSON.parse(legacyContent) as unknown;
    const normalized = normalizeAccountStorage(legacyData);
    if (!normalized) return null;

    await persist(normalized);
    try {
      await fs.unlink(currentLegacyProjectStoragePath);
      log.info("Removed legacy project account storage file after migration", {
        path: currentLegacyProjectStoragePath,
      });
    } catch (unlinkError) {
      const code = (unlinkError as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        log.warn("Failed to remove legacy project account storage file after migration", {
          path: currentLegacyProjectStoragePath,
          error: String(unlinkError),
        });
      }
    }
    log.info("Migrated legacy project account storage", {
      from: currentLegacyProjectStoragePath,
      to: currentStoragePath,
      accounts: normalized.accounts.length,
    });
    return normalized;
  } catch (error) {
    log.warn("Failed to migrate legacy project account storage", {
      from: currentLegacyProjectStoragePath,
      to: currentStoragePath,
      error: String(error),
    });
    return null;
  }
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
    const key = toAccountIdentityKey(account);
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

function pickNewestAccountIndex<T extends AccountLike>(
  accounts: T[],
  existingIndex: number,
  candidateIndex: number,
): number {
  const existing = accounts[existingIndex];
  const candidate = accounts[candidateIndex];
  if (!existing) return candidateIndex;
  if (!candidate) return existingIndex;
  const newest = selectNewestAccount(existing, candidate);
  return newest === candidate ? candidateIndex : existingIndex;
}

function mergeAccountRecords<T extends AccountLike>(target: T, source: T): T {
  const newest = selectNewestAccount(target, source);
  const older = newest === target ? source : target;
  return {
    ...older,
    ...newest,
    organizationId: target.organizationId ?? source.organizationId,
    accountId: target.accountId ?? source.accountId,
    accountIdSource: target.accountIdSource ?? source.accountIdSource,
    accountLabel: target.accountLabel ?? source.accountLabel,
    email: target.email ?? source.email,
  };
}

function deduplicateAccountsByRefreshToken<T extends AccountLike>(accounts: T[]): T[] {
  const working = [...accounts];
  const indicesToRemove = new Set<number>();
  const refreshMap = new Map<string, { byOrg: Map<string, number>; fallbackIndex?: number }>();

  for (let i = 0; i < working.length; i += 1) {
    const account = working[i];
    if (!account) continue;

    const refreshToken = account.refreshToken?.trim();
    if (!refreshToken) continue;
    const orgKey = account.organizationId?.trim() ?? "";

    let entry = refreshMap.get(refreshToken);
    if (!entry) {
      entry = { byOrg: new Map<string, number>(), fallbackIndex: undefined };
      refreshMap.set(refreshToken, entry);
    }

    if (orgKey) {
      const existingIndex = entry.byOrg.get(orgKey);
      if (existingIndex !== undefined) {
        const newestIndex = pickNewestAccountIndex(working, existingIndex, i);
        const obsoleteIndex = newestIndex === existingIndex ? i : existingIndex;
        const target = working[newestIndex];
        const source = working[obsoleteIndex];
        if (target && source) {
          working[newestIndex] = mergeAccountRecords(target, source);
        }
        indicesToRemove.add(obsoleteIndex);
        entry.byOrg.set(orgKey, newestIndex);
        continue;
      }
      entry.byOrg.set(orgKey, i);
      continue;
    }

    const existingFallback = entry.fallbackIndex;
    if (typeof existingFallback === "number") {
      const newestIndex = pickNewestAccountIndex(working, existingFallback, i);
      const obsoleteIndex = newestIndex === existingFallback ? i : existingFallback;
      const target = working[newestIndex];
      const source = working[obsoleteIndex];
      if (target && source) {
        working[newestIndex] = mergeAccountRecords(target, source);
      }
      indicesToRemove.add(obsoleteIndex);
      entry.fallbackIndex = newestIndex;
      continue;
    }
    entry.fallbackIndex = i;
  }

  for (const entry of refreshMap.values()) {
    const fallbackIndex = entry.fallbackIndex;
    if (typeof fallbackIndex !== "number") continue;
    const orgIndices = Array.from(entry.byOrg.values());
    if (orgIndices.length === 0) continue;

    const [firstOrgIndex, ...otherOrgIndices] = orgIndices;
    if (typeof firstOrgIndex !== "number") continue;

    let preferredOrgIndex = firstOrgIndex;
    for (const orgIndex of otherOrgIndices) {
      preferredOrgIndex = pickNewestAccountIndex(working, preferredOrgIndex, orgIndex);
    }

    const preferredOrg = working[preferredOrgIndex];
    const fallback = working[fallbackIndex];
    if (preferredOrg && fallback) {
      working[preferredOrgIndex] = mergeAccountRecords(preferredOrg, fallback);
    }
    indicesToRemove.add(fallbackIndex);
  }

  const result: T[] = [];
  for (let i = 0; i < working.length; i += 1) {
    if (indicesToRemove.has(i)) continue;
    const account = working[i];
    if (account) result.push(account);
  }
  return result;
}

/**
 * Removes duplicate accounts, keeping the most recently used entry for each unique key.
 * Deduplication identity hierarchy: organizationId -> accountId -> refreshToken.
 * @param accounts - Array of accounts to deduplicate
 * @returns New array with duplicates removed
 */
export function deduplicateAccounts<T extends { organizationId?: string; accountId?: string; refreshToken: string; lastUsed?: number; addedAt?: number }>(
  accounts: T[],
): T[] {
  return deduplicateAccountsByKey(accounts);
}

/**
 * Applies storage deduplication semantics used by normalize/import paths.
 * 1) Always dedupe by identity key first (organizationId -> accountId -> refreshToken).
 * 2) Then apply legacy email dedupe only for entries that still do not have organizationId/accountId.
 */
function deduplicateAccountsForStorage<T extends AccountLike & { email?: string }>(accounts: T[]): T[] {
  return deduplicateAccountsByRefreshToken(
    deduplicateAccountsByEmail(deduplicateAccountsByKey(accounts)),
  );
}

/**
 * Removes duplicate legacy accounts by email, keeping the most recently used entry.
 * Accounts with organizationId/accountId are never merged by email to avoid collapsing workspace variants.
 * Accounts without email are always preserved.
 * @param accounts - Array of accounts to deduplicate
 * @returns New array with email duplicates removed
 */
export function deduplicateAccountsByEmail<T extends { organizationId?: string; accountId?: string; email?: string; lastUsed?: number; addedAt?: number }>(
  accounts: T[],
): T[] {
  const emailToNewestIndex = new Map<string, number>();
  const indicesToKeep = new Set<number>();

  for (let i = 0; i < accounts.length; i += 1) {
    const account = accounts[i];
    if (!account) continue;

    const organizationId = account.organizationId?.trim();
    if (organizationId) {
      indicesToKeep.add(i);
      continue;
    }

    const accountId = account.accountId?.trim();
    if (accountId) {
      indicesToKeep.add(i);
      continue;
    }

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
    // istanbul ignore next -- defensive code: existingIndex always refers to valid account
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

function toAccountIdentityKeys(
  account: Pick<AccountMetadataV3, "organizationId" | "accountId" | "refreshToken">,
): string[] {
  const keys: string[] = [];
  const organizationId = typeof account.organizationId === "string" ? account.organizationId.trim() : "";
  if (organizationId) {
    keys.push(`organizationId:${organizationId}`);
  }

  const accountId = typeof account.accountId === "string" ? account.accountId.trim() : "";
  if (accountId) {
    keys.push(`accountId:${accountId}`);
  }

  const refreshToken = typeof account.refreshToken === "string" ? account.refreshToken.trim() : "";
  if (refreshToken) {
    keys.push(`refreshToken:${refreshToken}`);
  }

  return keys;
}

function toAccountIdentityKey(account: Pick<AccountMetadataV3, "organizationId" | "accountId" | "refreshToken">): string | undefined {
  return toAccountIdentityKeys(account)[0];
}

function extractActiveKeys(accounts: unknown[], activeIndex: number): string[] {
  const candidate = accounts[activeIndex];
  if (!isRecord(candidate)) return [];

  return toAccountIdentityKeys({
    organizationId: typeof candidate.organizationId === "string" ? candidate.organizationId : undefined,
    accountId: typeof candidate.accountId === "string" ? candidate.accountId : undefined,
    refreshToken: typeof candidate.refreshToken === "string" ? candidate.refreshToken : "",
  });
}

function findAccountIndexByIdentityKeys(
  accounts: Pick<AccountMetadataV3, "organizationId" | "accountId" | "refreshToken">[],
  identityKeys: string[],
): number {
  if (identityKeys.length === 0) return -1;
  for (const identityKey of identityKeys) {
    const idx = accounts.findIndex((account) => toAccountIdentityKeys(account).includes(identityKey));
    if (idx >= 0) {
      return idx;
    }
  }
  return -1;
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
  const activeKeys = extractActiveKeys(rawAccounts, rawActiveIndex);

  const fromVersion = data.version as AnyAccountStorage["version"];
  const baseStorage: AccountStorageV3 =
    fromVersion === 1
      ? migrateV1ToV3(data as unknown as AccountStorageV1)
      : (data as unknown as AccountStorageV3);

  const validAccounts = rawAccounts.filter(
    (account): account is AccountMetadataV3 =>
      isRecord(account) && typeof account.refreshToken === "string" && !!account.refreshToken.trim(),
  );

  const deduplicatedAccounts = deduplicateAccountsForStorage(validAccounts);

  const activeIndex = (() => {
    if (deduplicatedAccounts.length === 0) return 0;

    if (activeKeys.length > 0) {
      const mappedIndex = findAccountIndexByIdentityKeys(deduplicatedAccounts, activeKeys);
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
    const familyKeys = extractActiveKeys(rawAccounts, clampedRawIndex);

    let mappedIndex = clampIndex(rawIndex, deduplicatedAccounts.length);
    if (familyKeys.length > 0 && deduplicatedAccounts.length > 0) {
      const idx = findAccountIndexByIdentityKeys(deduplicatedAccounts, familyKeys);
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
  return loadAccountsInternal(saveAccounts);
}

async function loadAccountsInternal(
  persistMigration: ((storage: AccountStorageV3) => Promise<void>) | null,
): Promise<AccountStorageV3 | null> {
  try {
    const path = getStoragePath();
    const content = await fs.readFile(path, "utf-8");
    const data = JSON.parse(content) as unknown;

    const schemaErrors = getValidationErrors(AnyAccountStorageSchema, data);
    if (schemaErrors.length > 0) {
      log.warn("Account storage schema validation warnings", { errors: schemaErrors.slice(0, 5) });
    }

    const normalized = normalizeAccountStorage(data);

    const storedVersion = isRecord(data) ? (data as { version?: unknown }).version : undefined;
    if (normalized && storedVersion !== normalized.version) {
      log.info("Migrating account storage to v3", { from: storedVersion, to: normalized.version });
      if (persistMigration) {
        try {
          await persistMigration(normalized);
        } catch (saveError) {
          log.warn("Failed to persist migrated storage", { error: String(saveError) });
        }
      }
    }

    return normalized;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      const migrated = persistMigration
        ? await migrateLegacyProjectStorageIfNeeded(persistMigration)
        : null;
      if (migrated) return migrated;
      return null;
    }
    log.error("Failed to load account storage", { error: String(error) });
    return null;
  }
}

async function saveAccountsUnlocked(storage: AccountStorageV3): Promise<void> {
  const path = getStoragePath();
  const uniqueSuffix = `${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
  const tempPath = `${path}.${uniqueSuffix}.tmp`;

  try {
    await fs.mkdir(dirname(path), { recursive: true });
    await ensureGitignore(path);

    // Normalize before persisting so every write path enforces dedup semantics
    // (organizationId/accountId identity plus refresh-token collision collapse).
    const normalizedStorage = normalizeAccountStorage(storage) ?? storage;
    const content = JSON.stringify(normalizedStorage, null, 2);
    await fs.writeFile(tempPath, content, { encoding: "utf-8", mode: 0o600 });

    const stats = await fs.stat(tempPath);
    if (stats.size === 0) {
      const emptyError = Object.assign(new Error("File written but size is 0"), { code: "EEMPTY" });
      throw emptyError;
    }

    await renameWithWindowsRetry(tempPath, path);
  } catch (error) {
    try {
      await fs.unlink(tempPath);
    } catch {
      // Ignore cleanup failure.
    }

    const err = error as NodeJS.ErrnoException;
    const code = err?.code || "UNKNOWN";
    const hint = formatStorageErrorHint(error, path);

    log.error("Failed to save accounts", {
      path,
      code,
      message: err?.message,
      hint,
    });

    throw new StorageError(
      `Failed to save accounts: ${err?.message || "Unknown error"}`,
      code,
      path,
      hint,
      err instanceof Error ? err : undefined
    );
  }
}

export async function withAccountStorageTransaction<T>(
  handler: (
    current: AccountStorageV3 | null,
    persist: (storage: AccountStorageV3) => Promise<void>,
  ) => Promise<T>,
): Promise<T> {
  return withStorageLock(async () => {
    const current = await loadAccountsInternal(saveAccountsUnlocked);
    return handler(current, saveAccountsUnlocked);
  });
}

/**
 * Persists account storage to disk using atomic write (temp file + rename).
 * Creates the .opencode directory if it doesn't exist.
 * Verifies file was written correctly and provides detailed error messages.
 * @param storage - Account storage data to save
 * @throws StorageError with platform-aware hints on failure
 */
export async function saveAccounts(storage: AccountStorageV3): Promise<void> {
  return withStorageLock(async () => {
    await saveAccountsUnlocked(storage);
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

function normalizeFlaggedStorage(data: unknown): FlaggedAccountStorageV1 {
	if (!isRecord(data) || data.version !== 1 || !Array.isArray(data.accounts)) {
		return { version: 1, accounts: [] };
	}

	const byRefreshToken = new Map<string, FlaggedAccountMetadataV1>();
	for (const rawAccount of data.accounts) {
		if (!isRecord(rawAccount)) continue;
		const refreshToken =
			typeof rawAccount.refreshToken === "string" ? rawAccount.refreshToken.trim() : "";
		if (!refreshToken) continue;

		const flaggedAt = typeof rawAccount.flaggedAt === "number" ? rawAccount.flaggedAt : Date.now();
		const isAccountIdSource = (
			value: unknown,
		): value is AccountMetadataV3["accountIdSource"] =>
			value === "token" || value === "id_token" || value === "org" || value === "manual";
		const isSwitchReason = (
			value: unknown,
		): value is AccountMetadataV3["lastSwitchReason"] =>
			value === "rate-limit" || value === "initial" || value === "rotation";
		const isCooldownReason = (
			value: unknown,
		): value is AccountMetadataV3["cooldownReason"] =>
			value === "auth-failure" || value === "network-error";
		const normalizeTags = (value: unknown): string[] | undefined => {
			if (!Array.isArray(value)) return undefined;
			const normalized = value
				.filter((entry): entry is string => typeof entry === "string")
				.map((entry) => entry.trim().toLowerCase())
				.filter((entry) => entry.length > 0);
			return normalized.length > 0 ? Array.from(new Set(normalized)) : undefined;
		};

		let rateLimitResetTimes: AccountMetadataV3["rateLimitResetTimes"] | undefined;
		if (isRecord(rawAccount.rateLimitResetTimes)) {
			const normalizedRateLimits: Record<string, number | undefined> = {};
			for (const [key, value] of Object.entries(rawAccount.rateLimitResetTimes)) {
				if (typeof value === "number") {
					normalizedRateLimits[key] = value;
				}
			}
			if (Object.keys(normalizedRateLimits).length > 0) {
				rateLimitResetTimes = normalizedRateLimits;
			}
		}

		const accountIdSource = isAccountIdSource(rawAccount.accountIdSource)
			? rawAccount.accountIdSource
			: undefined;
		const lastSwitchReason = isSwitchReason(rawAccount.lastSwitchReason)
			? rawAccount.lastSwitchReason
			: undefined;
		const cooldownReason = isCooldownReason(rawAccount.cooldownReason)
			? rawAccount.cooldownReason
			: undefined;
		const accountTags = normalizeTags(rawAccount.accountTags);
		const accountNote =
			typeof rawAccount.accountNote === "string" && rawAccount.accountNote.trim()
				? rawAccount.accountNote.trim()
				: undefined;

		const normalized: FlaggedAccountMetadataV1 = {
			refreshToken,
			addedAt: typeof rawAccount.addedAt === "number" ? rawAccount.addedAt : flaggedAt,
			lastUsed: typeof rawAccount.lastUsed === "number" ? rawAccount.lastUsed : flaggedAt,
			organizationId:
				typeof rawAccount.organizationId === "string" ? rawAccount.organizationId : undefined,
			accountId: typeof rawAccount.accountId === "string" ? rawAccount.accountId : undefined,
			accountIdSource,
			accountLabel: typeof rawAccount.accountLabel === "string" ? rawAccount.accountLabel : undefined,
			accountTags,
			accountNote,
			email: typeof rawAccount.email === "string" ? rawAccount.email : undefined,
			enabled: typeof rawAccount.enabled === "boolean" ? rawAccount.enabled : undefined,
			lastSwitchReason,
			rateLimitResetTimes,
			coolingDownUntil:
				typeof rawAccount.coolingDownUntil === "number" ? rawAccount.coolingDownUntil : undefined,
			cooldownReason,
			flaggedAt,
			flaggedReason: typeof rawAccount.flaggedReason === "string" ? rawAccount.flaggedReason : undefined,
			lastError: typeof rawAccount.lastError === "string" ? rawAccount.lastError : undefined,
		};
		byRefreshToken.set(refreshToken, normalized);
	}

	return {
		version: 1,
		accounts: Array.from(byRefreshToken.values()),
	};
}

export async function loadFlaggedAccounts(): Promise<FlaggedAccountStorageV1> {
	const path = getFlaggedAccountsPath();
	const empty: FlaggedAccountStorageV1 = { version: 1, accounts: [] };

	try {
		const content = await fs.readFile(path, "utf-8");
		const data = JSON.parse(content) as unknown;
		return normalizeFlaggedStorage(data);
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code !== "ENOENT") {
			log.error("Failed to load flagged account storage", { path, error: String(error) });
			return empty;
		}
	}

	const legacyPath = getLegacyFlaggedAccountsPath();
	if (!existsSync(legacyPath)) {
		return empty;
	}

	try {
		const legacyContent = await fs.readFile(legacyPath, "utf-8");
		const legacyData = JSON.parse(legacyContent) as unknown;
		const migrated = normalizeFlaggedStorage(legacyData);
		if (migrated.accounts.length > 0) {
			await saveFlaggedAccounts(migrated);
		}
		try {
			await fs.unlink(legacyPath);
		} catch {
			// Best effort cleanup.
		}
		log.info("Migrated legacy flagged account storage", {
			from: legacyPath,
			to: path,
			accounts: migrated.accounts.length,
		});
		return migrated;
	} catch (error) {
		log.error("Failed to migrate legacy flagged account storage", {
			from: legacyPath,
			to: path,
			error: String(error),
		});
		return empty;
	}
}

export async function saveFlaggedAccounts(storage: FlaggedAccountStorageV1): Promise<void> {
	return withStorageLock(async () => {
		const path = getFlaggedAccountsPath();
		const uniqueSuffix = `${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
		const tempPath = `${path}.${uniqueSuffix}.tmp`;

		try {
			await fs.mkdir(dirname(path), { recursive: true });
			const content = JSON.stringify(normalizeFlaggedStorage(storage), null, 2);
			await fs.writeFile(tempPath, content, { encoding: "utf-8", mode: 0o600 });
			await renameWithWindowsRetry(tempPath, path);
		} catch (error) {
			try {
				await fs.unlink(tempPath);
			} catch {
				// Ignore cleanup failures.
			}
			log.error("Failed to save flagged account storage", { path, error: String(error) });
			throw error;
		}
	});
}

export async function clearFlaggedAccounts(): Promise<void> {
	return withStorageLock(async () => {
		try {
			await fs.unlink(getFlaggedAccountsPath());
		} catch (error) {
			const code = (error as NodeJS.ErrnoException).code;
			if (code !== "ENOENT") {
				log.error("Failed to clear flagged account storage", { error: String(error) });
			}
		}
	});
}

function formatBackupTimestamp(date: Date = new Date()): string {
	const yyyy = String(date.getFullYear());
	const mm = String(date.getMonth() + 1).padStart(2, "0");
	const dd = String(date.getDate()).padStart(2, "0");
	const hh = String(date.getHours()).padStart(2, "0");
	const min = String(date.getMinutes()).padStart(2, "0");
	const ss = String(date.getSeconds()).padStart(2, "0");
	const mmm = String(date.getMilliseconds()).padStart(3, "0");
	return `${yyyy}${mm}${dd}-${hh}${min}${ss}${mmm}`;
}

function sanitizeBackupPrefix(prefix: string): string {
	const trimmed = prefix.trim();
	const safe = trimmed
		.replace(/[^a-zA-Z0-9_-]+/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-+|-+$/g, "");
	return safe.length > 0 ? safe : "codex-backup";
}

export function createTimestampedBackupPath(prefix = "codex-backup"): string {
	const storagePath = getStoragePath();
	const backupDir = join(dirname(storagePath), "backups");
	const safePrefix = sanitizeBackupPrefix(prefix);
	const nonce = randomBytes(3).toString("hex");
	return join(backupDir, `${safePrefix}-${formatBackupTimestamp()}-${nonce}.json`);
}

async function readAndNormalizeImportFile(filePath: string): Promise<{
	resolvedPath: string;
	normalized: AccountStorageV3;
}> {
	const resolvedPath = resolvePath(filePath);

	if (!existsSync(resolvedPath)) {
		throw new Error(`Import file not found: ${resolvedPath}`);
	}

	const content = await fs.readFile(resolvedPath, "utf-8");

	let imported: unknown;
	try {
		imported = JSON.parse(content);
	} catch {
		throw new Error(`Invalid JSON in import file: ${resolvedPath}`);
	}

	const normalized = normalizeAccountStorage(imported);
	if (!normalized) {
		throw new Error("Invalid account storage format");
	}

	return { resolvedPath, normalized };
}

export async function previewImportAccounts(
	filePath: string,
): Promise<{ imported: number; total: number; skipped: number }> {
	const { normalized } = await readAndNormalizeImportFile(filePath);

	return withAccountStorageTransaction((existing) => {
		const existingAccounts = existing?.accounts ?? [];
		const merged = [...existingAccounts, ...normalized.accounts];

		if (merged.length > ACCOUNT_LIMITS.MAX_ACCOUNTS) {
			const deduped = deduplicateAccountsForStorage(merged);
			if (deduped.length > ACCOUNT_LIMITS.MAX_ACCOUNTS) {
				throw new Error(
					`Import would exceed maximum of ${ACCOUNT_LIMITS.MAX_ACCOUNTS} accounts (would have ${deduped.length})`,
				);
			}
		}

		const deduplicatedAccounts = deduplicateAccountsForStorage(merged);
		const imported = deduplicatedAccounts.length - existingAccounts.length;
		const skipped = normalized.accounts.length - imported;
		return Promise.resolve({
			imported,
			total: deduplicatedAccounts.length,
			skipped,
		});
	});
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
  
  const storage = await withAccountStorageTransaction((current) => Promise.resolve(current));
  if (!storage || storage.accounts.length === 0) {
    throw new Error("No accounts to export");
  }
  
  await fs.mkdir(dirname(resolvedPath), { recursive: true });
  
  const content = JSON.stringify(storage, null, 2);
  await fs.writeFile(resolvedPath, content, { encoding: "utf-8", mode: 0o600 });
  log.info("Exported accounts", { path: resolvedPath, count: storage.accounts.length });
}

/**
 * Imports accounts from a JSON file, merging with existing accounts.
 * Deduplicates by identity key first (organizationId -> accountId -> refreshToken),
 * then applies legacy email dedupe only to entries without organizationId/accountId.
 * @param filePath - Source file path
 * @throws Error if file is invalid or would exceed MAX_ACCOUNTS
 */
export async function importAccounts(
	filePath: string,
	options: ImportAccountsOptions = {},
): Promise<ImportAccountsResult> {
  const { resolvedPath, normalized } = await readAndNormalizeImportFile(filePath);
  const backupMode = options.backupMode ?? "none";
  const backupPrefix = options.preImportBackupPrefix ?? "codex-pre-import-backup";
  
  const {
    imported: importedCount,
    total,
    skipped: skippedCount,
    backupStatus,
    backupPath,
    backupError,
  } =
    await withAccountStorageTransaction(async (existing, persist) => {
      const existingStorage: AccountStorageV3 =
        existing ??
        ({
          version: 3,
          accounts: [],
          activeIndex: 0,
          activeIndexByFamily: {},
        } satisfies AccountStorageV3);
      const existingAccounts = existingStorage.accounts;
      const existingActiveIndex = existingStorage.activeIndex;
      const clampedExistingActiveIndex = clampIndex(existingActiveIndex, existingAccounts.length);
      const existingActiveKeys = extractActiveKeys(existingAccounts, clampedExistingActiveIndex);
      const existingActiveIndexByFamily = existingStorage.activeIndexByFamily ?? {};

      let backupStatus: ImportBackupStatus = "skipped";
      let backupPath: string | undefined;
      let backupError: string | undefined;
      if (backupMode !== "none" && existingAccounts.length > 0) {
        backupPath = createTimestampedBackupPath(backupPrefix);
        try {
          await writePreImportBackupFile(backupPath, existingStorage);
          backupStatus = "created";
        } catch (error) {
          backupStatus = "failed";
          backupError = error instanceof Error ? error.message : String(error);
          if (backupMode === "required") {
            throw new Error(`Pre-import backup failed: ${backupError}`);
          }
          log.warn("Pre-import backup failed; continuing import apply", {
            path: backupPath,
            error: backupError,
          });
        }
      }

      const merged = [...existingAccounts, ...normalized.accounts];

      if (merged.length > ACCOUNT_LIMITS.MAX_ACCOUNTS) {
        const deduped = deduplicateAccountsForStorage(merged);
        if (deduped.length > ACCOUNT_LIMITS.MAX_ACCOUNTS) {
          throw new Error(
            `Import would exceed maximum of ${ACCOUNT_LIMITS.MAX_ACCOUNTS} accounts (would have ${deduped.length})`
          );
        }
      }

      const deduplicatedAccounts = deduplicateAccountsForStorage(merged);

      const mappedActiveIndex = (() => {
        if (deduplicatedAccounts.length === 0) return 0;
        if (existingActiveKeys.length > 0) {
          const idx = findAccountIndexByIdentityKeys(deduplicatedAccounts, existingActiveKeys);
          if (idx >= 0) return idx;
        }
        return clampIndex(clampedExistingActiveIndex, deduplicatedAccounts.length);
      })();

      const activeIndexByFamily: Partial<Record<ModelFamily, number>> = {};
      for (const family of MODEL_FAMILIES) {
        const rawFamilyIndex = existingActiveIndexByFamily[family];
        const familyIndex =
          typeof rawFamilyIndex === "number" && Number.isFinite(rawFamilyIndex)
            ? rawFamilyIndex
            : clampedExistingActiveIndex;
        const familyKeys = extractActiveKeys(existingAccounts, clampIndex(familyIndex, existingAccounts.length));
        if (familyKeys.length > 0) {
          const idx = findAccountIndexByIdentityKeys(deduplicatedAccounts, familyKeys);
          activeIndexByFamily[family] = idx >= 0 ? idx : mappedActiveIndex;
          continue;
        }
        activeIndexByFamily[family] = mappedActiveIndex;
      }

      const newStorage: AccountStorageV3 = {
        version: 3,
        accounts: deduplicatedAccounts,
        activeIndex: mappedActiveIndex,
        activeIndexByFamily,
      };

      await persist(newStorage);

      const imported = deduplicatedAccounts.length - existingAccounts.length;
      const skipped = normalized.accounts.length - imported;
      return {
        imported,
        total: deduplicatedAccounts.length,
        skipped,
        backupStatus,
        backupPath,
        backupError,
      };
    });

  log.info("Imported accounts", {
    path: resolvedPath,
    imported: importedCount,
    skipped: skippedCount,
    total,
    backupStatus,
    backupPath,
    backupError,
  });

  return {
    imported: importedCount,
    total,
    skipped: skippedCount,
    backupStatus,
    backupPath,
    backupError,
  };
}
