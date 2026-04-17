/**
 * Schema normalization, forward-compat guard, and V2 detection for account
 * storage files.
 *
 * Split out of `lib/storage.ts` in RC-2. This module does not touch disk: it
 * takes already-parsed JSON and returns a canonical `AccountStorageV3` (or
 * throws a typed `StorageError` for schemas we can't safely read).
 */

import { createLogger } from "../logger.js";
import { MODEL_FAMILIES, type ModelFamily } from "../prompts/codex.js";
import { AccountStorageV2DetectionSchema } from "../schemas.js";
import { StorageError } from "./errors.js";
import {
  clampIndex,
  deduplicateAccountsForStorage,
  extractActiveKeys,
  findAccountIndexByIdentityKeys,
  isRecord,
} from "./identity.js";
import {
  buildV2RecoveryHint,
  buildV2RejectionMessage,
  migrateV1ToV3,
  UNKNOWN_V2_FORMAT_CODE,
  type AccountMetadataV3,
  type AccountStorageV1,
  type AccountStorageV3,
} from "./migrations.js";

const log = createLogger("storage");

type AnyAccountStorage = AccountStorageV1 | AccountStorageV3;

/**
 * Normalizes and validates account storage data, migrating from v1 to v3 if needed.
 * Handles deduplication, index clamping, and per-family active index mapping.
 * @param data - Raw storage data (unknown format)
 * @param sourcePath - Optional origin path used for error diagnostics
 * @returns Normalized AccountStorageV3 or null if invalid
 * @throws StorageError (code `UNSUPPORTED_SCHEMA_VERSION`) when `data.version`
 *   is a finite number greater than the newest format this plugin understands.
 *   Throwing prevents a downgraded plugin from silently discarding future
 *   schemas that still contain valid credentials.
 */
export function normalizeAccountStorage(
  data: unknown,
  sourcePath?: string,
): AccountStorageV3 | null {
  if (!isRecord(data)) {
    log.warn("Invalid storage format, ignoring");
    return null;
  }

  const rawVersion = (data as { version?: unknown }).version;

  // Forward-compat guard: a finite version above the newest supported schema
  // signals a file written by a newer plugin build. Returning null here would
  // make the caller treat the data as corrupt and overwrite it with an empty
  // or downgraded payload, permanently destroying the user's accounts.
  if (typeof rawVersion === "number" && Number.isFinite(rawVersion) && rawVersion > 3) {
    const resolvedPath = sourcePath ?? "<unknown>";
    const hint =
      `The storage file at ${resolvedPath} was written by a newer version ` +
      `of this plugin (schema v${rawVersion}). Upgrade the plugin to a build ` +
      `that understands schema v${rawVersion}, or back up and remove the ` +
      `file to start fresh.`;
    throw new StorageError(
      `Unsupported account storage schema version ${rawVersion}; this plugin supports up to version 3.`,
      "UNSUPPORTED_SCHEMA_VERSION",
      resolvedPath,
      hint,
    );
  }

  // V2 files were produced by an intermediate 4.x build whose shape was never
  // documented and for which no forward-migrator shipped. Silently treating
  // them as "unknown version" (the previous behaviour) meant users with a V2
  // file had their credentials discarded without any signal. Detect V2
  // explicitly and throw a typed StorageError so the caller can surface the
  // recovery hint to the user. Audit top-20 #8; see
  // `lib/storage/migrations.ts:buildV2RejectionMessage` for copy.
  if (AccountStorageV2DetectionSchema.safeParse(data).success) {
    throw new StorageError(
      buildV2RejectionMessage(),
      UNKNOWN_V2_FORMAT_CODE,
      "",
      buildV2RecoveryHint(""),
    );
  }

  if (data.version !== 1 && data.version !== 3) {
    log.warn("Unknown storage version, ignoring", {
      version: rawVersion,
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
