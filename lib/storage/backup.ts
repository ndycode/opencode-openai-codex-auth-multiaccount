/**
 * Backup path formatting and pre-import backup file writer.
 *
 * Split out of `lib/storage.ts` in RC-2. `createTimestampedBackupPath` is a
 * pure path builder that every backup caller can use without taking a
 * dependency on the import pipeline. `writePreImportBackupFile` is the
 * bounded-time writer used inside `importAccounts` to snapshot the existing
 * accounts file before apply (audit `docs/audits/04-high-priority.md`).
 */

import { promises as fs } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import {
  PRE_IMPORT_BACKUP_WRITE_TIMEOUT_MS,
  renameWithWindowsRetry,
  writeFileWithTimeout,
} from "./atomic-write.js";
import type { AccountStorageV3 } from "./migrations.js";
import { getStoragePath } from "./state.js";

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

export async function writePreImportBackupFile(backupPath: string, snapshot: AccountStorageV3): Promise<void> {
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
