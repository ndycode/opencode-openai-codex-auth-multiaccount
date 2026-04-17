/**
 * Multi-worktree collision detection for per-project account storage.
 *
 * Problem: when multiple OpenCode sessions (tabs, IDE windows, detached
 * worktrees, or CI runs) point at the same per-project accounts file, their
 * writes can interleave and lose rotation updates, health-score changes, or
 * rate-limit state. The in-process `withStorageLock` mutex solves intra-process
 * races but cannot see another Node process mutating the same file.
 *
 * Strategy: sidecar lock file at `<storage>.lock`. Every `loadAccounts` /
 * `saveAccounts` call verifies ownership:
 *
 *   - No lock on disk -> write our own, proceed.
 *   - Lock owned by us (same pid + hostname) -> refresh `lastActive`, proceed.
 *   - Foreign lock with dead owner (same host, pid gone) -> take over.
 *   - Foreign lock stale (`lastActive` older than STALE_THRESHOLD_MS) -> take
 *     over. Required because a prior process that SIGKILL'd never released
 *     its lock, so "dead pid" detection alone leaks locks on long-lived hosts.
 *   - Foreign lock live -> surface a WARNING to the logger identifying both
 *     worktrees and proceed anyway. The locking contract here is advisory
 *     (Phase 4 F2 audit recommendation): blocking would strand the user when
 *     two legitimate sessions share a project, so we prefer visibility over
 *     enforcement.
 *
 * Cross-host note: we cannot probe a PID on a different machine, so a lock
 * written from another hostname is always treated as live until its
 * `lastActive` timestamp ages past STALE_THRESHOLD_MS. This is conservative
 * but matches the audit requirement to "not block" — the worst case is a
 * warning the user can dismiss.
 *
 * See `docs/audits/08-feature-recommendations.md` and
 * `docs/audits/13-phased-roadmap.md#phase-4-f2` for background.
 */

import { promises as fs } from "node:fs";
import os from "node:os";
import { createLogger } from "../logger.js";
import { registerCleanup } from "../shutdown.js";

const log = createLogger("storage.worktree-lock");

/**
 * Time after which a lock whose owner never refreshed it is considered
 * abandoned, regardless of PID liveness. One hour matches the roadmap spec
 * and is long enough to avoid stealing a lock from a session that is merely
 * idle between saves.
 */
export const STALE_THRESHOLD_MS = 60 * 60 * 1000;

/**
 * Persisted lock-file payload. Written as pretty-printed JSON so a human
 * inspecting the file can immediately tell which worktree holds the lock.
 */
export interface WorktreeLockInfo {
	pid: number;
	hostname: string;
	cwd: string;
	startedAt: string; // ISO-8601
	lastActive: string; // ISO-8601, refreshed on every acquire
}

export interface AcquireLockResult {
	/** True when we now own the lock on disk. */
	acquired: boolean;
	/** Populated only when a foreign live lock was detected. */
	foreign?: WorktreeLockInfo;
}

/**
 * Tracks lock-file paths this process has written so a single shutdown
 * cleanup can release all of them. Keyed by lock path, not storage path,
 * to avoid double-registering cleanup if the same path is acquired twice.
 */
const ownedLockPaths = new Set<string>();
let shutdownCleanupRegistered = false;

function lockPath(storagePath: string): string {
	return `${storagePath}.lock`;
}

/**
 * Probes whether a PID is still running. Returns `true` conservatively for
 * cross-host locks: we cannot signal a remote PID, so the safe default is
 * "assume alive" and let the stale-timestamp branch reclaim it instead.
 *
 * Intentionally synchronous: `process.kill` is non-blocking and making this
 * async buys nothing while incurring a useless microtask per lock check.
 */
function processAlive(pid: number, hostname: string): boolean {
	if (hostname !== os.hostname()) {
		return true;
	}
	// Guard against invalid PIDs that would make `process.kill` throw
	// EINVAL (treated as "alive" by the catch below) and leak the lock.
	if (!Number.isInteger(pid) || pid <= 0) {
		return false;
	}
	try {
		// Signal 0 performs the permission + existence check without
		// actually delivering a signal. ESRCH means "no such process".
		process.kill(pid, 0);
		return true;
	} catch (err) {
		const code = (err as NodeJS.ErrnoException).code;
		// EPERM means the process exists but we cannot signal it (different
		// user). Treat as alive to avoid stealing a lock we can't verify.
		if (code === "EPERM") return true;
		return false;
	}
}

function buildOwnLockInfo(existingStartedAt?: string): WorktreeLockInfo {
	const now = new Date().toISOString();
	return {
		pid: process.pid,
		hostname: os.hostname(),
		cwd: process.cwd(),
		startedAt: existingStartedAt ?? now,
		lastActive: now,
	};
}

async function writeOurLock(
	lockFile: string,
	existingStartedAt?: string,
): Promise<void> {
	const info = buildOwnLockInfo(existingStartedAt);
	// mode 0o600: lock discloses pid/cwd, so restrict to owner like the
	// storage file itself.
	await fs.writeFile(lockFile, JSON.stringify(info, null, 2), {
		encoding: "utf-8",
		mode: 0o600,
	});
	ownedLockPaths.add(lockFile);
	ensureShutdownReleaseRegistered();
}

/**
 * Best-effort shutdown hook that removes every lock we still own. Failures
 * are swallowed so one bad unlink cannot stall process exit.
 */
function ensureShutdownReleaseRegistered(): void {
	if (shutdownCleanupRegistered) return;
	shutdownCleanupRegistered = true;
	registerCleanup(async () => {
		const paths = Array.from(ownedLockPaths);
		ownedLockPaths.clear();
		await Promise.all(
			paths.map(async (lp) => {
				try {
					await releaseLockFile(lp);
				} catch {
					// Swallow: shutdown path must not throw.
				}
			}),
		);
	});
}

function isOwnLock(info: WorktreeLockInfo): boolean {
	return info.pid === process.pid && info.hostname === os.hostname();
}

/**
 * Parse a lock file. Returns `null` if the file is missing, unreadable, or
 * structurally invalid. Callers treat `null` the same as "no lock" so a
 * corrupt sidecar never wedges storage access.
 */
async function readLock(lockFile: string): Promise<WorktreeLockInfo | null> {
	let raw: string;
	try {
		raw = await fs.readFile(lockFile, "utf-8");
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === "ENOENT") {
			return null;
		}
		throw err;
	}
	try {
		const parsed = JSON.parse(raw) as unknown;
		if (!parsed || typeof parsed !== "object") return null;
		const obj = parsed as Partial<WorktreeLockInfo>;
		if (
			typeof obj.pid !== "number" ||
			typeof obj.hostname !== "string" ||
			typeof obj.cwd !== "string" ||
			typeof obj.startedAt !== "string" ||
			typeof obj.lastActive !== "string"
		) {
			return null;
		}
		return obj as WorktreeLockInfo;
	} catch {
		// Corrupt JSON: treat as absent rather than crashing the storage
		// pipeline. `writeOurLock` will overwrite it on the next acquire.
		return null;
	}
}

/**
 * Checks ownership of the worktree lock and acquires it when possible.
 *
 * Contract:
 *   - Never throws on lock I/O errors *other than* propagating read/write
 *     failures the caller needs to know about (disk full, EACCES).
 *   - Always returns a discriminated result: either `acquired: true` (we
 *     now own or refreshed the lock) or `acquired: false` with `foreign`
 *     populated (another live worktree owns it; caller should warn).
 *   - Never blocks. This is advisory locking by design.
 */
export async function acquireOrDetectLock(
	storagePath: string,
): Promise<AcquireLockResult> {
	const lockFile = lockPath(storagePath);
	const existing = await readLock(lockFile);

	if (!existing) {
		await writeOurLock(lockFile);
		return { acquired: true };
	}

	// Own lock: refresh timestamp so stale-detection on a long-running
	// process never accidentally reclaims its own lock from itself.
	if (isOwnLock(existing)) {
		await writeOurLock(lockFile, existing.startedAt);
		return { acquired: true };
	}

	// Stale timestamp takes priority over liveness probe: on the same host
	// a fresh-looking PID that was reused by the OS would otherwise mask a
	// dead session that never released its lock. Timestamp age is the
	// authoritative abandonment signal.
	const lastActiveMs = Date.parse(existing.lastActive);
	if (
		Number.isFinite(lastActiveMs) &&
		Date.now() - lastActiveMs > STALE_THRESHOLD_MS
	) {
		log.info("Replacing stale worktree lock", {
			staleCwd: existing.cwd,
			stalePid: existing.pid,
			staleHost: existing.hostname,
			ageMs: Date.now() - lastActiveMs,
		});
		await writeOurLock(lockFile);
		return { acquired: true };
	}

	// Non-stale foreign lock. If the owner pid is gone (same host), the
	// previous process crashed without cleanup and we can take over.
	const alive = processAlive(existing.pid, existing.hostname);
	if (!alive) {
		log.info("Replacing lock from dead worktree", {
			deadCwd: existing.cwd,
			deadPid: existing.pid,
			deadHost: existing.hostname,
		});
		await writeOurLock(lockFile);
		return { acquired: true };
	}

	// Foreign live lock. Advisory protocol: surface but do not block.
	return { acquired: false, foreign: existing };
}

/**
 * Release a lock file, but only if we currently own it. This guards against
 * a late shutdown hook racing a newer process that re-acquired the lock.
 */
async function releaseLockFile(lockFile: string): Promise<void> {
	ownedLockPaths.delete(lockFile);
	const existing = await readLock(lockFile);
	if (!existing) return;
	if (!isOwnLock(existing)) return;
	try {
		await fs.unlink(lockFile);
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
			// Degrade to warn; a leftover lock file is recoverable via the
			// stale-timestamp branch on the next acquire.
			log.warn("Failed to release worktree lock", {
				lockFile,
				error: String(err),
			});
		}
	}
}

export async function releaseLock(storagePath: string): Promise<void> {
	await releaseLockFile(lockPath(storagePath));
}

/**
 * Test-only reset hook. Vitest reuses a single Node process across files,
 * so `ownedLockPaths` state would leak between suites and confuse the
 * "no lock on disk" acquire branch. Not re-exported from the barrel.
 */
export function __resetWorktreeLockForTests(): void {
	ownedLockPaths.clear();
	shutdownCleanupRegistered = false;
}

/** Test-only: inspect owned paths without exposing the internal Set. */
export function __getOwnedLockPathsForTests(): readonly string[] {
	return Array.from(ownedLockPaths);
}
