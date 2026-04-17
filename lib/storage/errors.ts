/**
 * Storage-domain error re-export + platform-aware error hint formatting.
 *
 * RC-3 consolidation: `StorageError` now lives in `lib/errors.ts` alongside the
 * rest of the typed error hierarchy. This module re-exports it so every
 * existing import path (`./errors.js` from storage submodules,
 * `lib/storage.ts` public re-export) continues to work without changes.
 *
 * `formatStorageErrorHint` stays here because it is storage-specific presentation
 * and has no place in the generic error-class module.
 */

export { StorageError } from "../errors.js";

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
