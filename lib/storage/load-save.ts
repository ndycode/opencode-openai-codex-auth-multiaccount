/**
 * Account storage load/save pipeline.
 *
 * Split out of `lib/storage.ts` in RC-2. This module owns:
 *   - the `.gitignore` side-effect when writing into a project repo,
 *   - the legacy project + global storage migrations triggered on ENOENT,
 *   - the project-global fallback seed flow,
 *   - the atomic write (temp file + rename + EEMPTY guard),
 *   - and the `withAccountStorageTransaction` read-modify-write primitive
 *     that every mutating caller above the storage layer uses.
 *
 * The error-handling contract is subtle and load-bearing: forward-compat
 * (`UNSUPPORTED_SCHEMA_VERSION`) and unknown-V2 failures MUST reach the
 * caller. Swallowing either would overwrite future-schema credentials or
 * silently discard a user's V2 file, which is exactly the class of bug the
 * audit flagged.
 */

import { promises as fs, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { ACCOUNTS_FILE_NAME, LEGACY_ACCOUNTS_FILE_NAME } from "../constants.js";
import { createLogger } from "../logger.js";
import { AnyAccountStorageSchema, getValidationErrors } from "../schemas.js";
import { renameWithWindowsRetry } from "./atomic-write.js";
import { formatStorageErrorHint, StorageError } from "./errors.js";
import { normalizeAccountStorage } from "./normalize.js";
import { getConfigDir } from "./paths.js";
import {
  getCurrentLegacyProjectStoragePath,
  getCurrentProjectRoot,
  getCurrentStoragePath,
  getStoragePath,
  withStorageLock,
} from "./state.js";
import {
  buildV2RecoveryHint,
  UNKNOWN_V2_FORMAT_CODE,
  type AccountStorageV3,
} from "./migrations.js";
import { acquireOrDetectLock } from "./worktree-lock.js";
import os from "node:os";

const log = createLogger("storage");

/**
 * Probes the worktree lock for the currently active storage path and surfaces
 * any foreign live lock as a non-fatal warning. The lock check is advisory:
 * Phase 4 F2 deliberately chose warn-over-block so a user with two legitimate
 * OpenCode sessions on the same project (separate worktrees, IDE + CLI) is
 * never stranded. The warning still carries enough detail (pid, host, cwd)
 * for the user to reconcile state manually if a rotation was lost to a race.
 *
 * Failure modes:
 *   - Storage path is not resolvable (no project, no global dir set): skip
 *     silently, the actual storage call will surface the real error.
 *   - Lock file unreadable (disk full, EACCES): log at debug so it cannot
 *     drown the normal "collision detected" warning, then continue. A broken
 *     sidecar must never gate auth-critical reads/writes.
 */
async function checkWorktreeLockForCurrentStorage(
  operation: "load" | "save",
): Promise<void> {
  let path: string;
  try {
    path = getStoragePath();
  } catch (error) {
    log.debug("Skipping worktree lock check: storage path unavailable", {
      error: String(error),
    });
    return;
  }
  try {
    const result = await acquireOrDetectLock(path);
    if (!result.acquired && result.foreign) {
      log.warn("Multi-worktree collision detected on account storage", {
        operation,
        storagePath: path,
        foreignPid: result.foreign.pid,
        foreignHost: result.foreign.hostname,
        foreignCwd: result.foreign.cwd,
        foreignLastActive: result.foreign.lastActive,
        ourPid: process.pid,
        ourHost: os.hostname(),
        ourCwd: process.cwd(),
      });
    }
  } catch (error) {
    log.debug("Worktree lock probe failed", {
      operation,
      storagePath: path,
      error: String(error),
    });
  }
}

async function ensureGitignore(storagePath: string): Promise<void> {
  if (!getCurrentStoragePath()) return;

  const configDir = dirname(storagePath);
  const inferredProjectRoot = dirname(configDir);
  const candidateRoots = [getCurrentProjectRoot(), inferredProjectRoot].filter(
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

async function migrateStorageFileIfNeeded(
  legacyPath: string | null,
  nextPath: string,
  persist: (storage: AccountStorageV3) => Promise<void>,
  label: string,
): Promise<AccountStorageV3 | null> {
  if (!legacyPath || legacyPath === nextPath || !existsSync(legacyPath)) {
    return null;
  }

  try {
    const legacyContent = await fs.readFile(legacyPath, "utf-8");
    const legacyData = JSON.parse(legacyContent) as unknown;
    const normalized = normalizeAccountStorage(legacyData, legacyPath);
    if (!normalized) return null;

    await persist(normalized);
    try {
      await fs.unlink(legacyPath);
      log.info(`Removed legacy ${label} after migration`, { path: legacyPath });
    } catch (unlinkError) {
      const code = (unlinkError as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        log.warn(`Failed to remove legacy ${label} after migration`, {
          path: legacyPath,
          error: String(unlinkError),
        });
      }
    }
    log.info(`Migrated legacy ${label}`, {
      from: legacyPath,
      to: nextPath,
      accounts: normalized.accounts.length,
    });
    return normalized;
  } catch (error) {
    // Forward-compat failures should not be masked as migration warnings.
    if (error instanceof StorageError && error.code === "UNSUPPORTED_SCHEMA_VERSION") {
      throw error;
    }
    log.warn(`Failed to migrate legacy ${label}`, {
      from: legacyPath,
      to: nextPath,
      error: String(error),
    });
    return null;
  }
}

async function migrateLegacyProjectStorageIfNeeded(
  persist: (storage: AccountStorageV3) => Promise<void> = saveAccounts,
): Promise<AccountStorageV3 | null> {
  return migrateStorageFileIfNeeded(
    getCurrentLegacyProjectStoragePath(),
    getStoragePath(),
    persist,
    "project account storage",
  );
}

/**
 * Resolves the global (non-project) account storage path.
 */
function getGlobalAccountsStoragePath(): string {
  return join(getConfigDir(), ACCOUNTS_FILE_NAME);
}

function getLegacyGlobalAccountsStoragePath(): string {
  return join(getConfigDir(), LEGACY_ACCOUNTS_FILE_NAME);
}

async function migrateLegacyGlobalStorageIfNeeded(): Promise<AccountStorageV3 | null> {
  const nextPath = getGlobalAccountsStoragePath();
  const persistGlobalStorage = async (storage: AccountStorageV3): Promise<void> => {
    await writeAccountsToPathUnlocked(nextPath, storage);
  };

  return migrateStorageFileIfNeeded(
    getLegacyGlobalAccountsStoragePath(),
    nextPath,
    persistGlobalStorage,
    "global account storage",
  );
}

/**
 * Returns true when project-scoped storage is active and a global fallback is meaningful.
 */
function shouldUseProjectGlobalFallback(): boolean {
  return Boolean(getCurrentStoragePath() && getCurrentProjectRoot());
}

/**
 * Loads account data from global storage as a fallback when project storage is missing.
 * Returns null for missing/unusable global storage and never throws to callers.
 */
async function loadGlobalAccountsFallback(): Promise<AccountStorageV3 | null> {
  const currentStoragePath = getCurrentStoragePath();
  if (!shouldUseProjectGlobalFallback() || !currentStoragePath) {
    return null;
  }

  const migrated = await migrateLegacyGlobalStorageIfNeeded();
  if (migrated) {
    return migrated;
  }

  const globalStoragePath = getGlobalAccountsStoragePath();
  if (globalStoragePath === currentStoragePath) {
    return null;
  }

  try {
    const content = await fs.readFile(globalStoragePath, "utf-8");
    const data = JSON.parse(content) as unknown;

    const schemaErrors = getValidationErrors(AnyAccountStorageSchema, data);
    if (schemaErrors.length > 0) {
      log.warn("Global account storage schema validation warnings", {
        path: globalStoragePath,
        errors: schemaErrors.slice(0, 5),
      });
    }

    const normalized = normalizeAccountStorage(data, globalStoragePath);
    if (!normalized) return null;

    log.info("Loaded global account storage as project fallback", {
      from: globalStoragePath,
      to: currentStoragePath,
      accounts: normalized.accounts.length,
    });
    return normalized;
  } catch (error) {
    // Propagate forward-compat failures so the caller can surface them to the
    // user instead of silently falling back to an empty global pool.
    if (error instanceof StorageError && error.code === "UNSUPPORTED_SCHEMA_VERSION") {
      throw error;
    }
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      log.warn("Failed to load global fallback account storage", {
        from: globalStoragePath,
        to: currentStoragePath,
        error: String(error),
      });
    }
    return null;
  }
}

/**
 * Core account-loading routine shared by normal reads and transactional storage handlers.
 * Handles schema normalization, legacy migration, and optional fallback seeding.
 */
async function loadAccountsInternal(
  persistMigration: ((storage: AccountStorageV3) => Promise<void>) | null,
): Promise<AccountStorageV3 | null> {
  // Advisory: surface multi-worktree collisions before the read but never
  // block. Must come before the try/catch so a genuine storage error still
  // takes precedence over any lock-related log output below.
  await checkWorktreeLockForCurrentStorage("load");
  try {
    const path = getStoragePath();
    const content = await fs.readFile(path, "utf-8");
    const data = JSON.parse(content) as unknown;

    const schemaErrors = getValidationErrors(AnyAccountStorageSchema, data);
    if (schemaErrors.length > 0) {
      log.warn("Account storage schema validation warnings", { errors: schemaErrors.slice(0, 5) });
    }

    const normalized = normalizeAccountStorage(data, path);

    const storedVersion =
      data && typeof data === "object" && !Array.isArray(data)
        ? (data as { version?: unknown }).version
        : undefined;
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
    // Forward-compat failures must reach the caller instead of being silently
    // downgraded to an empty load, which would clobber the user's future-format
    // credentials on the next save.
    if (error instanceof StorageError && error.code === "UNSUPPORTED_SCHEMA_VERSION") {
      throw error;
    }
    // Unknown-V2 detection must NOT be silently dropped: the catch below
    // swallows generic errors by design (keeps an unreadable file from
    // crashing the whole plugin), but V2 is a specific, recoverable case
    // where the user needs to know their credentials were quarantined.
    // Re-throw so the UI/CLI layer can render the recovery hint.
    if (error instanceof StorageError && error.code === UNKNOWN_V2_FORMAT_CODE) {
      // Annotate with the concrete storage path that triggered the reject
      // so the recovery hint points at the real file.
      const concretePath = (() => {
        try {
          return getStoragePath();
        } catch {
          return "";
        }
      })();
      if (concretePath) {
        throw new StorageError(
          error.message,
          UNKNOWN_V2_FORMAT_CODE,
          concretePath,
          buildV2RecoveryHint(concretePath),
          error,
        );
      }
      throw error;
    }
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      const migrated = persistMigration
        ? await migrateLegacyProjectStorageIfNeeded(persistMigration)
        : null;
      if (migrated) return migrated;
      if (!shouldUseProjectGlobalFallback()) {
        const migratedGlobal = persistMigration
          ? await migrateLegacyGlobalStorageIfNeeded()
          : null;
        if (migratedGlobal) return migratedGlobal;
        return null;
      }
      const globalFallback = await loadGlobalAccountsFallback();
      if (!globalFallback) return null;

      if (persistMigration) {
        const seedPath = getStoragePath();
        try {
          await fs.access(seedPath);
          return globalFallback;
        } catch (accessError) {
          const accessCode = (accessError as NodeJS.ErrnoException).code;
          if (accessCode !== "ENOENT") {
            log.warn("Failed to inspect project seed path before fallback seeding", {
              path: seedPath,
              error: String(accessError),
            });
            return globalFallback;
          }
          // File is missing; proceed with seed write.
        }

        try {
          await persistMigration(globalFallback);
          log.info("Seeded project account storage from global fallback", {
            path: seedPath,
            accounts: globalFallback.accounts.length,
          });
        } catch (persistError) {
          log.warn("Failed to seed project storage from global fallback", {
            path: seedPath,
            error: String(persistError),
          });
        }
      }

      return globalFallback;
    }
    log.error("Failed to load account storage", { error: String(error) });
    return null;
  }
}

/**
 * Writes account storage without acquiring the outer storage mutex.
 * Callers must already be inside withStorageLock when using this helper directly.
 */
async function writeAccountsToPathUnlocked(path: string, storage: AccountStorageV3): Promise<void> {
  const uniqueSuffix = `${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
  const tempPath = `${path}.${uniqueSuffix}.tmp`;

  try {
    await fs.mkdir(dirname(path), { recursive: true });
    await ensureGitignore(path);

    // Normalize before persisting so every write path enforces dedup semantics
    // (exact identity dedupe plus legacy email dedupe for identity-less records).
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

async function saveAccountsUnlocked(storage: AccountStorageV3): Promise<void> {
  // Refresh our lock (or surface a collision) on every write. This also
  // bumps `lastActive`, which is the stale-detection timestamp read by
  // other worktrees on their next acquire.
  await checkWorktreeLockForCurrentStorage("save");
  await writeAccountsToPathUnlocked(getStoragePath(), storage);
}

/**
 * Loads OAuth accounts from disk storage.
 * Automatically migrates v1 storage to v3 format if needed.
 * @returns AccountStorageV3 if file exists and is valid, null otherwise
 * @throws StorageError (code `UNSUPPORTED_SCHEMA_VERSION`) when the on-disk
 *   `version` field is greater than the newest format this plugin understands.
 *   Surfacing the error stops a downgraded plugin from overwriting the user's
 *   future-schema credentials with a stale or empty payload.
 */
export async function loadAccounts(): Promise<AccountStorageV3 | null> {
  return withStorageLock(async () => loadAccountsInternal(saveAccountsUnlocked));
}

/**
 * Executes a read-modify-write transaction under the storage lock and exposes
 * an unlocked persist callback so nested save operations do not deadlock.
 */
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
