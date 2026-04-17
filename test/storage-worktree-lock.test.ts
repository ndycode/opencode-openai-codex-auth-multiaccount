import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs, existsSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
	acquireOrDetectLock,
	releaseLock,
	STALE_THRESHOLD_MS,
	__getOwnedLockPathsForTests,
	__resetWorktreeLockForTests,
	type WorktreeLockInfo,
} from "../lib/storage/worktree-lock.js";

/**
 * Allocates a unique storage-file path under tmpdir(). The file itself is
 * never created; the lock sidecar is what matters. Using tmpdir guarantees
 * we stay inside the paths allow-list enforced elsewhere.
 */
async function allocateStoragePath(): Promise<string> {
	const dir = join(
		tmpdir(),
		`worktree-lock-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	await fs.mkdir(dir, { recursive: true });
	return join(dir, "accounts.json");
}

function lockPathFor(storagePath: string): string {
	return `${storagePath}.lock`;
}

/**
 * Picks a PID that is guaranteed not to be running on this host. Node
 * PIDs are 32-bit on Windows and positive 32-bit on POSIX, so a value near
 * the top of the range has effectively zero chance of being live.
 */
const DEAD_PID = 2_000_000_000;

async function writeForeignLock(
	storagePath: string,
	overrides: Partial<WorktreeLockInfo> = {},
): Promise<WorktreeLockInfo> {
	const now = new Date().toISOString();
	const info: WorktreeLockInfo = {
		pid: DEAD_PID,
		hostname: os.hostname(),
		cwd: "/tmp/other-worktree",
		startedAt: now,
		lastActive: now,
		...overrides,
	};
	await fs.writeFile(lockPathFor(storagePath), JSON.stringify(info, null, 2), {
		encoding: "utf-8",
		mode: 0o600,
	});
	return info;
}

describe("worktree-lock: acquireOrDetectLock", () => {
	let storagePath: string;

	beforeEach(async () => {
		__resetWorktreeLockForTests();
		storagePath = await allocateStoragePath();
	});

	afterEach(async () => {
		__resetWorktreeLockForTests();
		try {
			await fs.rm(
				join(storagePath, ".."),
				{ recursive: true, force: true },
			);
		} catch {
			// Ignore cleanup failure.
		}
	});

	it("acquires cleanly when no lock file exists", async () => {
		const result = await acquireOrDetectLock(storagePath);

		expect(result.acquired).toBe(true);
		expect(result.foreign).toBeUndefined();
		expect(existsSync(lockPathFor(storagePath))).toBe(true);

		const onDisk = JSON.parse(
			await fs.readFile(lockPathFor(storagePath), "utf-8"),
		) as WorktreeLockInfo;
		expect(onDisk.pid).toBe(process.pid);
		expect(onDisk.hostname).toBe(os.hostname());
		expect(onDisk.cwd).toBe(process.cwd());
	});

	it("reports a foreign live lock without acquiring", async () => {
		// Use our own PID as the foreign owner but a different "hostname" so
		// the cross-host branch treats it as live. This avoids racing on an
		// actual second process while still exercising the "acquired=false,
		// foreign populated" contract.
		const foreign = await writeForeignLock(storagePath, {
			pid: process.pid + 1,
			hostname: `remote-${os.hostname()}`,
			cwd: "/tmp/other",
		});

		const result = await acquireOrDetectLock(storagePath);

		expect(result.acquired).toBe(false);
		expect(result.foreign).toBeDefined();
		expect(result.foreign?.pid).toBe(foreign.pid);
		expect(result.foreign?.hostname).toBe(foreign.hostname);
		expect(result.foreign?.cwd).toBe(foreign.cwd);

		// Foreign lock must remain untouched on disk.
		const stillOnDisk = JSON.parse(
			await fs.readFile(lockPathFor(storagePath), "utf-8"),
		) as WorktreeLockInfo;
		expect(stillOnDisk.pid).toBe(foreign.pid);
		expect(stillOnDisk.hostname).toBe(foreign.hostname);
	});

	it("takes over a stale lock older than the threshold", async () => {
		const staleIso = new Date(
			Date.now() - (STALE_THRESHOLD_MS + 60_000),
		).toISOString();
		// Live PID on a remote host: normally we'd treat this as live, so
		// the only reason we reclaim is the aged `lastActive`.
		await writeForeignLock(storagePath, {
			pid: process.pid,
			hostname: `remote-${os.hostname()}`,
			lastActive: staleIso,
			startedAt: staleIso,
		});

		const result = await acquireOrDetectLock(storagePath);

		expect(result.acquired).toBe(true);
		expect(result.foreign).toBeUndefined();

		const takenOver = JSON.parse(
			await fs.readFile(lockPathFor(storagePath), "utf-8"),
		) as WorktreeLockInfo;
		expect(takenOver.pid).toBe(process.pid);
		expect(takenOver.hostname).toBe(os.hostname());
		// lastActive refreshed to "now", not the stale value.
		expect(Date.parse(takenOver.lastActive)).toBeGreaterThan(
			Date.parse(staleIso),
		);
	});

	it("takes over a lock whose owning PID is dead on this host", async () => {
		await writeForeignLock(storagePath, {
			pid: DEAD_PID,
			hostname: os.hostname(),
		});

		const result = await acquireOrDetectLock(storagePath);

		expect(result.acquired).toBe(true);
		expect(result.foreign).toBeUndefined();

		const info = JSON.parse(
			await fs.readFile(lockPathFor(storagePath), "utf-8"),
		) as WorktreeLockInfo;
		expect(info.pid).toBe(process.pid);
	});

	it("refreshes our own lock without flagging a collision", async () => {
		const first = await acquireOrDetectLock(storagePath);
		expect(first.acquired).toBe(true);

		const firstInfo = JSON.parse(
			await fs.readFile(lockPathFor(storagePath), "utf-8"),
		) as WorktreeLockInfo;

		// Small delay so the refreshed lastActive is strictly later.
		await new Promise((resolve) => setTimeout(resolve, 10));

		const second = await acquireOrDetectLock(storagePath);
		expect(second.acquired).toBe(true);
		expect(second.foreign).toBeUndefined();

		const secondInfo = JSON.parse(
			await fs.readFile(lockPathFor(storagePath), "utf-8"),
		) as WorktreeLockInfo;
		expect(secondInfo.pid).toBe(process.pid);
		expect(secondInfo.startedAt).toBe(firstInfo.startedAt);
		expect(Date.parse(secondInfo.lastActive)).toBeGreaterThanOrEqual(
			Date.parse(firstInfo.lastActive),
		);
	});

	it("overwrites a corrupt lock file instead of crashing", async () => {
		await fs.writeFile(lockPathFor(storagePath), "{ not valid json", {
			encoding: "utf-8",
			mode: 0o600,
		});

		const result = await acquireOrDetectLock(storagePath);

		expect(result.acquired).toBe(true);
		const info = JSON.parse(
			await fs.readFile(lockPathFor(storagePath), "utf-8"),
		) as WorktreeLockInfo;
		expect(info.pid).toBe(process.pid);
	});

	it("registers the acquired lock for shutdown release", async () => {
		await acquireOrDetectLock(storagePath);
		expect(__getOwnedLockPathsForTests()).toContain(lockPathFor(storagePath));
	});
});

describe("worktree-lock: releaseLock", () => {
	let storagePath: string;

	beforeEach(async () => {
		__resetWorktreeLockForTests();
		storagePath = await allocateStoragePath();
	});

	afterEach(async () => {
		__resetWorktreeLockForTests();
		try {
			await fs.rm(
				join(storagePath, ".."),
				{ recursive: true, force: true },
			);
		} catch {
			// Ignore cleanup failure.
		}
	});

	it("removes the lock file when we own it", async () => {
		await acquireOrDetectLock(storagePath);
		expect(existsSync(lockPathFor(storagePath))).toBe(true);

		await releaseLock(storagePath);

		expect(existsSync(lockPathFor(storagePath))).toBe(false);
		expect(__getOwnedLockPathsForTests()).not.toContain(
			lockPathFor(storagePath),
		);
	});

	it("leaves a foreign lock in place", async () => {
		const foreign = await writeForeignLock(storagePath, {
			pid: process.pid + 1,
			hostname: `remote-${os.hostname()}`,
		});

		await releaseLock(storagePath);

		expect(existsSync(lockPathFor(storagePath))).toBe(true);
		const onDisk = JSON.parse(
			await fs.readFile(lockPathFor(storagePath), "utf-8"),
		) as WorktreeLockInfo;
		expect(onDisk.pid).toBe(foreign.pid);
		expect(onDisk.hostname).toBe(foreign.hostname);
	});

	it("is a no-op when no lock file exists", async () => {
		await expect(releaseLock(storagePath)).resolves.toBeUndefined();
	});
});
