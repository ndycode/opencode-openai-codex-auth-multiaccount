/**
 * Storage error types and platform-aware error hint formatting.
 *
 * Split out of `lib/storage.ts` in RC-2 so every storage submodule can import
 * the typed error without pulling in load/save/normalize transitively.
 */

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
