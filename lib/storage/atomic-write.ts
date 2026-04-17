/**
 * Low-level atomic-write primitives shared by account storage, flagged
 * storage, and pre-import backups.
 *
 * Split out of `lib/storage.ts` in RC-2. These helpers intentionally contain
 * no business logic — every caller handles dedup/normalization above this
 * layer. The retry + timeout knobs here exist to tolerate Windows file-lock
 * contention from antivirus scanners and to keep a misbehaving disk from
 * hanging the plugin indefinitely.
 */

import { promises as fs } from "node:fs";

export const WINDOWS_RENAME_RETRY_ATTEMPTS = 5;
export const WINDOWS_RENAME_RETRY_BASE_DELAY_MS = 10;
export const PRE_IMPORT_BACKUP_WRITE_TIMEOUT_MS = 3_000;

function isWindowsLockError(error: unknown): error is NodeJS.ErrnoException {
  const code = (error as NodeJS.ErrnoException)?.code;
  return code === "EPERM" || code === "EBUSY";
}

/**
 * `fs.rename` with capped exponential retry on Windows EPERM/EBUSY.
 *
 * Windows reports transient lock contention (antivirus scanning the temp
 * file, indexer holding a handle open, etc.) as EPERM/EBUSY and surfaces it
 * to `rename`. A few short retries turn that into a successful atomic swap
 * without the caller needing to know anything about the platform.
 */
export async function renameWithWindowsRetry(sourcePath: string, destinationPath: string): Promise<void> {
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

/**
 * `fs.writeFile` with a hard wall-clock timeout.
 *
 * Used by the pre-import backup writer so a stuck disk or hanging FS driver
 * cannot block the import transaction forever; every other write path uses
 * the normal, untimed `fs.writeFile`.
 */
export async function writeFileWithTimeout(filePath: string, content: string, timeoutMs: number): Promise<void> {
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
