/**
 * Account export / import / preview pipeline.
 *
 * Split out of `lib/storage.ts` in RC-2. All three public functions here are
 * thin wrappers around `withAccountStorageTransaction` so they inherit the
 * same mutex + atomic-write guarantees as ordinary saves. The pre-import
 * backup path is delegated to `./backup.ts`.
 */

import { promises as fs, existsSync } from "node:fs";
import { basename, dirname } from "node:path";
import { ACCOUNT_LIMITS } from "../constants.js";
import { createLogger } from "../logger.js";
import { MODEL_FAMILIES, type ModelFamily } from "../prompts/codex.js";
import { createTimestampedBackupPath, writePreImportBackupFile } from "./backup.js";
import { StorageError } from "./errors.js";
import {
  clampIndex,
  deduplicateAccountsForStorage,
  extractActiveKeys,
  findAccountIndexByIdentityKeys,
} from "./identity.js";
import { withAccountStorageTransaction } from "./load-save.js";
import type { AccountMetadataV3, AccountStorageV3 } from "./migrations.js";
import { normalizeAccountStorage } from "./normalize.js";
import { resolvePath } from "./paths.js";

const log = createLogger("storage");

/**
 * Backup policy for `importAccounts`.
 *
 * - `none`: do not create a pre-import backup (destructive; opt-in only).
 * - `timestamped`: create a timestamped pre-import backup, continue on failure.
 *   This is the default — see audit finding `docs/audits/04-high-priority.md`.
 * - `best-effort`: legacy alias for `timestamped`, retained for callers that
 *   were written against the prior enum.
 * - `required`: backup must succeed or the import aborts.
 */
export type ImportBackupMode = "none" | "timestamped" | "best-effort" | "required";

export interface ImportAccountsOptions {
  /**
   * Optional prefix used for pre-import backup file names.
   * Only applied when backupMode is not "none".
   */
  preImportBackupPrefix?: string;
  /**
   * Backup policy before import apply. Defaults to `"timestamped"` so that the
   * prior on-disk state is preserved unless the caller explicitly opts out via
   * `{ backupMode: "none" }`.
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

export interface ImportPreviewResult {
  imported: number;
  total: number;
  skipped: number;
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

  // Pass the resolved path so an UNSUPPORTED_SCHEMA_VERSION error includes
  // the actual import file in its diagnostics.
  const normalized = normalizeAccountStorage(imported, resolvedPath);
  if (!normalized) {
    throw new Error("Invalid account storage format");
  }

  return { resolvedPath, normalized };
}

function analyzeImportedAccounts(
  existingAccounts: AccountMetadataV3[],
  importedAccounts: AccountStorageV3["accounts"],
): ImportPreviewResult & { accounts: AccountMetadataV3[] } {
  const merged = [...existingAccounts, ...importedAccounts];
  const accounts = deduplicateAccountsForStorage(merged);
  if (accounts.length > ACCOUNT_LIMITS.MAX_ACCOUNTS) {
    throw new Error(
      `Import would exceed maximum of ${ACCOUNT_LIMITS.MAX_ACCOUNTS} accounts (would have ${accounts.length})`,
    );
  }
  const imported = Math.max(0, accounts.length - existingAccounts.length);
  const skipped = Math.max(0, importedAccounts.length - imported);
  return {
    accounts,
    imported,
    total: accounts.length,
    skipped,
  };
}

/**
 * Import preview/apply analysis is pure in-memory work: it does not touch disk
 * and it does not log token or workspace values. The surrounding
 * `withAccountStorageTransaction` caller keeps Windows lock-retry and
 * serialized read-modify-write behavior; see `test/storage.test.ts` for the
 * overlapping transaction regression and pre-import backup lock coverage.
 */

export async function previewImportAccounts(
  filePath: string,
): Promise<ImportPreviewResult> {
  const { normalized } = await readAndNormalizeImportFile(filePath);

  return withAccountStorageTransaction((existing) => {
    const existingAccounts = existing?.accounts ?? [];
    const analysis = analyzeImportedAccounts(existingAccounts, normalized.accounts);
    return Promise.resolve({
      imported: analysis.imported,
      total: analysis.total,
      skipped: analysis.skipped,
    });
  });
}

/**
 * Exports current accounts to a JSON file for backup/migration.
 *
 * Safety default (audit `docs/audits/04-high-priority.md`):
 * `force` defaults to `false` so an existing export file is never silently
 * overwritten. Callers that need the prior destructive behaviour must opt in
 * via `exportAccounts(path, true)`.
 *
 * @param filePath - Destination file path.
 * @param force - If true, overwrite any existing file at `filePath`. Defaults to
 *   `false`; when false and the file exists, a `StorageError` is thrown.
 * @throws StorageError if the file already exists and `force` is `false`.
 * @throws Error if there are no accounts to export.
 */
export async function exportAccounts(filePath: string, force = false): Promise<void> {
  const resolvedPath = resolvePath(filePath);

  if (!force && existsSync(resolvedPath)) {
    throw new StorageError(
      `Refusing to overwrite existing export file: ${resolvedPath}. Pass force=true to overwrite.`,
      "EEXIST",
      resolvedPath,
      "Re-run the export with force=true if you intend to replace the existing file, or choose a new path.",
    );
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
 *
 * Safety default (audit `docs/audits/04-high-priority.md`):
 * `options.backupMode` defaults to `"timestamped"` so a pre-import snapshot of
 * the existing accounts file is always written before apply. Callers that need
 * the prior destructive default must pass `{ backupMode: "none" }` explicitly.
 *
 * @param filePath - Source file path
 * @throws Error if file is invalid or would exceed MAX_ACCOUNTS
 */
export async function importAccounts(
  filePath: string,
  options: ImportAccountsOptions = {},
): Promise<ImportAccountsResult> {
  const { resolvedPath, normalized } = await readAndNormalizeImportFile(filePath);
  const backupMode = options.backupMode ?? "timestamped";
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
      let backupLogError: string | undefined;
      if (backupMode !== "none" && existingAccounts.length > 0) {
        backupPath = createTimestampedBackupPath(backupPrefix);
        try {
          await writePreImportBackupFile(backupPath, existingStorage);
          backupStatus = "created";
        } catch (error) {
          backupStatus = "failed";
          backupError = error instanceof Error ? error.message : String(error);
          const backupCode = (error as NodeJS.ErrnoException)?.code;
          backupLogError = backupCode
            ? `pre-import backup failed (${backupCode})`
            : "pre-import backup failed";
          if (backupMode === "required") {
            throw new Error(
              backupCode
                ? `Pre-import backup failed (${backupCode})`
                : "Pre-import backup failed",
            );
          }
          log.warn("Pre-import backup failed; continuing import apply", {
            backupFile: backupPath ? basename(backupPath) : undefined,
            error: backupLogError,
          });
        }
      }

      const analysis = analyzeImportedAccounts(existingAccounts, normalized.accounts);
      const deduplicatedAccounts = analysis.accounts;

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

      return {
        imported: analysis.imported,
        total: analysis.total,
        skipped: analysis.skipped,
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
    backupFile: backupPath ? basename(backupPath) : undefined,
    backupError: backupError ? "available on command result" : undefined,
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
