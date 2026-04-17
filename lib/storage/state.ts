/**
 * Module-scoped storage state and the single shared mutex that serializes
 * every read-modify-write against the accounts files.
 *
 * Split out of `lib/storage.ts` in RC-2 so the identity helpers, normalize,
 * load/save, flagged, and export-import modules can all share the same
 * resolved path and the same lock without creating circular imports.
 *
 * Invariants this module preserves:
 *   - `currentStoragePath` is either `null` (use global fallback) or an
 *     absolute path to a project-scoped accounts file.
 *   - `currentProjectRoot` is only non-null when `currentStoragePath` is
 *     project-scoped; `setStoragePathDirect` deliberately clears it so
 *     ad-hoc overrides (tests, one-off CLI paths) never look like a real
 *     project.
 *   - `withStorageLock` chains every critical section through a single
 *     promise so nothing can interleave between a load and its paired save.
 */

import { join } from "node:path";
import { ACCOUNTS_FILE_NAME, LEGACY_ACCOUNTS_FILE_NAME } from "../constants.js";
import {
  findProjectRoot,
  getConfigDir,
  getProjectConfigDir,
  getProjectGlobalConfigDir,
} from "./paths.js";

let storageMutex: Promise<void> = Promise.resolve();

/**
 * Serializes storage I/O to keep account file reads/writes lock-step and avoid
 * cross-request races during migration/seeding flows.
 */
export function withStorageLock<T>(fn: () => Promise<T>): Promise<T> {
  const previousMutex = storageMutex;
  let releaseLock: () => void;
  storageMutex = new Promise<void>((resolve) => {
    releaseLock = resolve;
  });
  return previousMutex.then(fn).finally(() => releaseLock());
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
    currentLegacyProjectStoragePath = join(getProjectConfigDir(projectRoot), LEGACY_ACCOUNTS_FILE_NAME);
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

// Internal accessors used by sibling storage modules. Not re-exported from the
// top-level barrel: callers outside `lib/storage/` should use the public
// `setStoragePath` / `getStoragePath` APIs.

export function getCurrentStoragePath(): string | null {
  return currentStoragePath;
}

export function getCurrentLegacyProjectStoragePath(): string | null {
  return currentLegacyProjectStoragePath;
}

export function getCurrentProjectRoot(): string | null {
  return currentProjectRoot;
}
