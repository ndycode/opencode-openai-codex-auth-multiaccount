/**
 * Tests for `codex-keychain` tool rollback UX (F1 post-merge review).
 *
 * Covers two MEDIUM findings:
 *   - Rollback must not silently clobber a live JSON file when one exists
 *     alongside a `.migrated-to-keychain.<ts>` backup (`confirm`-flag gate).
 *   - `findMigrationBackups` must sort by `mtimeMs`, not filename
 *     lexicographically, so timestamp-format drift cannot pick the wrong
 *     backup.
 *
 * The low-level keychain backend and load/save integration are covered in
 * `test/storage-keychain.test.ts`; this file intentionally focuses on the
 * tool surface and the backup-selection helper.
 */

import { promises as fs, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
	_findMigrationBackupsForTests,
	createCodexKeychainTool,
} from "../lib/tools/codex-keychain.js";
import type { ToolContext } from "../lib/tools/index.js";
import type { UiRuntimeOptions } from "../lib/ui/runtime.js";
import {
	_resetBackendForTests,
	_setBackendForTests,
	KEYCHAIN_SERVICE_NAME,
	GLOBAL_KEYCHAIN_ACCOUNT_KEY,
	type KeychainBackend,
} from "../lib/storage/keychain.js";
import { setStoragePathDirect } from "../lib/storage/state.js";
import type { AccountStorageV3 } from "../lib/storage.js";

// -----------------------------------------------------------------------------
// Shared fixtures
// -----------------------------------------------------------------------------

interface MockBackend extends KeychainBackend {
	store: Map<string, string>;
	calls: Array<{ op: string; service: string; account: string }>;
}

function createMockBackend(): MockBackend {
	const store = new Map<string, string>();
	const calls: MockBackend["calls"] = [];
	const backend: MockBackend = {
		store,
		calls,
		async get(service, account) {
			calls.push({ op: "get", service, account });
			return store.get(`${service}::${account}`) ?? null;
		},
		async set(service, account, secret) {
			calls.push({ op: "set", service, account });
			store.set(`${service}::${account}`, secret);
		},
		async delete(service, account) {
			calls.push({ op: "delete", service, account });
			return store.delete(`${service}::${account}`);
		},
		async isAvailable() {
			calls.push({
				op: "isAvailable",
				service: KEYCHAIN_SERVICE_NAME,
				account: "__availability_probe__",
			});
			return true;
		},
	};
	return backend;
}

/**
 * Minimal UiRuntimeOptions with `v2Enabled: false` so the format helpers
 * degrade to plain strings without needing the full theme/color plumbing.
 * The rollback tool's output is assertion-friendly in this mode.
 */
function plainUiRuntime(): UiRuntimeOptions {
	return {
		v2Enabled: false,
		colorEnabled: false,
		theme: {
			colors: {
				heading: "",
				accent: "",
				muted: "",
				success: "",
				warning: "",
				danger: "",
				reset: "",
			},
			glyphs: { bullet: "-" },
		},
	} as unknown as UiRuntimeOptions;
}

function buildCtx(): ToolContext {
	const ctx = {
		resolveUiRuntime: () => plainUiRuntime(),
	};
	return ctx as unknown as ToolContext;
}

function makeStorage(): AccountStorageV3 {
	return {
		version: 3,
		activeIndex: 0,
		accounts: [
			{
				refreshToken: "refresh-token-redacted",
				accountId: "acct-1",
				addedAt: 1,
				lastUsed: 2,
			},
		],
	};
}

const ORIGINAL_CODEX_KEYCHAIN = process.env.CODEX_KEYCHAIN;

async function allocateStorageDir(): Promise<string> {
	const dir = join(
		tmpdir(),
		`keychain-tool-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	await fs.mkdir(dir, { recursive: true });
	return dir;
}

// -----------------------------------------------------------------------------
// Fix 4: findMigrationBackups mtime-aware sort
// -----------------------------------------------------------------------------

describe("findMigrationBackups (F1 MEDIUM: mtime-aware sort)", () => {
	let storageDir: string;
	let storagePath: string;

	beforeEach(async () => {
		storageDir = await allocateStorageDir();
		storagePath = join(storageDir, "accounts.json");
	});

	afterEach(async () => {
		try {
			await fs.rm(storageDir, { recursive: true, force: true });
		} catch {
			/* ignore */
		}
	});

	it("returns most-recent backup first based on mtimeMs, not lexicographic filename", async () => {
		// Create two backup files whose NAMES sort in the opposite order
		// from their MTIMES. Before the fix, the lexicographic sort picks
		// the newer name; after the fix, the older mtime wins regardless
		// of filename format.
		const olderNameNewerMtime = `${storagePath}.migrated-to-keychain.zzz-legacy-format`;
		const newerNameOlderMtime = `${storagePath}.migrated-to-keychain.2024-01-01T00-00-00-000Z`;

		await fs.writeFile(olderNameNewerMtime, "{}", "utf-8");
		await fs.writeFile(newerNameOlderMtime, "{}", "utf-8");

		// Force mtimes: newer-mtime file is `olderNameNewerMtime`, older
		// mtime is `newerNameOlderMtime`. fs.utimes takes seconds.
		const newer = Math.floor(Date.now() / 1000);
		const older = newer - 60 * 60; // 1 hour earlier
		await fs.utimes(olderNameNewerMtime, newer, newer);
		await fs.utimes(newerNameOlderMtime, older, older);

		const result = await _findMigrationBackupsForTests(storagePath);
		expect(result).toHaveLength(2);
		// Most recent by mtime comes first.
		expect(result[0]).toBe(olderNameNewerMtime);
		expect(result[1]).toBe(newerNameOlderMtime);
	});

	it("falls back to descending filename sort on mtime tie (deterministic)", async () => {
		// Identical mtimes -> tiebreak by reverse filename order for
		// determinism. Matches the documented pre-fix behaviour for the
		// normal ISO-8601 case.
		const backupA = `${storagePath}.migrated-to-keychain.2024-06-15T10-00-00-000Z`;
		const backupB = `${storagePath}.migrated-to-keychain.2024-06-15T11-00-00-000Z`;
		await fs.writeFile(backupA, "{}", "utf-8");
		await fs.writeFile(backupB, "{}", "utf-8");
		const t = Math.floor(Date.now() / 1000);
		await fs.utimes(backupA, t, t);
		await fs.utimes(backupB, t, t);

		const result = await _findMigrationBackupsForTests(storagePath);
		expect(result[0]).toBe(backupB);
		expect(result[1]).toBe(backupA);
	});

	it("returns empty array when the directory does not exist", async () => {
		const phantom = join(storageDir, "nope", "nothing.json");
		const result = await _findMigrationBackupsForTests(phantom);
		expect(result).toEqual([]);
	});
});

// -----------------------------------------------------------------------------
// Fix 3: rollback silent-clobber guard (confirm=true required)
// -----------------------------------------------------------------------------

describe("codex-keychain rollback (F1 MEDIUM: confirm-flag clobber gate)", () => {
	let storageDir: string;
	let storagePath: string;
	let mock: MockBackend;

	beforeEach(async () => {
		_resetBackendForTests();
		mock = createMockBackend();
		_setBackendForTests(mock);
		storageDir = await allocateStorageDir();
		storagePath = join(storageDir, "accounts.json");
		setStoragePathDirect(storagePath);
		// Opt-in on so clearAccounts targets both sides.
		process.env.CODEX_KEYCHAIN = "1";
	});

	afterEach(async () => {
		setStoragePathDirect(null);
		_resetBackendForTests();
		if (ORIGINAL_CODEX_KEYCHAIN === undefined) {
			delete process.env.CODEX_KEYCHAIN;
		} else {
			process.env.CODEX_KEYCHAIN = ORIGINAL_CODEX_KEYCHAIN;
		}
		try {
			await fs.rm(storageDir, { recursive: true, force: true });
		} catch {
			/* ignore */
		}
	});

	async function seedBackup(accountId: string): Promise<string> {
		const backupPath = `${storagePath}.migrated-to-keychain.2024-06-15T10-00-00-000Z`;
		const body: AccountStorageV3 = makeStorage();
		body.accounts[0]!.accountId = accountId;
		await fs.writeFile(
			backupPath,
			JSON.stringify(body, null, 2),
			"utf-8",
		);
		return backupPath;
	}

	async function seedCurrentJson(accountId: string): Promise<void> {
		const body: AccountStorageV3 = makeStorage();
		body.accounts[0]!.accountId = accountId;
		await fs.writeFile(
			storagePath,
			JSON.stringify(body, null, 2),
			"utf-8",
		);
	}

	it("refuses to clobber a current JSON file without confirm=true", async () => {
		await seedBackup("from-backup");
		await seedCurrentJson("current-live");

		// Simulate a race where clearAccounts cannot unlink the live file
		// by making fs.unlink throw once. After the fix, the post-clear
		// access check sees the file is still present and refuses rather
		// than silently clobbering it via fs.rename on POSIX.
		const { promises: fsp } = await import("node:fs");
		const { vi } = await import("vitest");
		const unlinkSpy = vi
			.spyOn(fsp, "unlink")
			.mockImplementationOnce(async () => {
				throw Object.assign(new Error("simulated EACCES"), {
					code: "EACCES",
				});
			});

		try {
			const t = createCodexKeychainTool(buildCtx());
			const out = (await t.execute(
				{ command: "rollback" },
				{} as never,
			)) as string;
			expect(out).toMatch(/refusing to overwrite/i);
			expect(out).toContain(storagePath);
			expect(out).toMatch(/confirm=true/);
		} finally {
			unlinkSpy.mockRestore();
		}

		// Current JSON is untouched.
		expect(existsSync(storagePath)).toBe(true);
		const stillCurrent = JSON.parse(
			await fs.readFile(storagePath, "utf-8"),
		) as AccountStorageV3;
		expect(stillCurrent.accounts[0]!.accountId).toBe("current-live");
	});

	it("archives the live JSON with .pre-rollback.<ts> suffix when confirm=true", async () => {
		await seedBackup("from-backup");
		await seedCurrentJson("current-live");

		// Prevent unlink inside clearAccounts from clearing the live
		// file so the archive path is exercised. Otherwise clearAccounts
		// would succeed and there would be nothing to archive.
		const { promises: fsp } = await import("node:fs");
		const { vi } = await import("vitest");
		const unlinkSpy = vi
			.spyOn(fsp, "unlink")
			.mockImplementationOnce(async () => {
				throw Object.assign(new Error("simulated EACCES"), {
					code: "EACCES",
				});
			});

		let out: string;
		try {
			const t = createCodexKeychainTool(buildCtx());
			out = (await t.execute(
				{ command: "rollback", confirm: true },
				{} as never,
			)) as string;
		} finally {
			unlinkSpy.mockRestore();
		}

		expect(out).toMatch(/Restored/);
		expect(out).toMatch(/pre-rollback\./);

		// The canonical storage path now holds the restored backup
		// contents; the previous live file was archived side-by-side.
		const active = JSON.parse(
			await fs.readFile(storagePath, "utf-8"),
		) as AccountStorageV3;
		expect(active.accounts[0]!.accountId).toBe("from-backup");

		const entries = await fs.readdir(storageDir);
		const archived = entries.find((name) =>
			name.includes(".pre-rollback."),
		);
		expect(archived).toBeDefined();
		const archivedBody = JSON.parse(
			await fs.readFile(join(storageDir, archived!), "utf-8"),
		) as AccountStorageV3;
		expect(archivedBody.accounts[0]!.accountId).toBe("current-live");
	});

	it("[LOW] status does not probe the keychain when CODEX_KEYCHAIN is unset", async () => {
		// F1 post-merge LOW finding: `codex-keychain status` used to call
		// `keychainIsAvailable()` unconditionally, which writes a throwaway
		// probe entry to the OS keychain and can pop a first-run macOS
		// "allow/always allow" prompt for users who never opted in. The
		// fix gates the probe on `isKeychainOptInEnabled`. Here we flip
		// opt-in off for the duration of the test and assert the backend
		// never records an isAvailable call, while the status output
		// explicitly surfaces the disabled-by-opt-in state.
		delete process.env.CODEX_KEYCHAIN;

		// Reset recorded calls on the shared mock so this assertion is
		// independent of any earlier rollback fixtures in the describe.
		mock.calls.length = 0;

		const t = createCodexKeychainTool(buildCtx());
		const out = (await t.execute(
			{ command: "status" },
			{} as never,
		)) as string;

		// No probe was issued against the mock backend.
		const probeCalls = mock.calls.filter((c) => c.op === "isAvailable");
		expect(probeCalls).toHaveLength(0);

		// Status output reflects opt-in state, not a false "unavailable".
		expect(out).toMatch(/CODEX_KEYCHAIN/);
		expect(out).toMatch(/(unset|disabled)/i);
		expect(out).toMatch(/not checked|disabled/i);
	});

	it("normal rollback (no current file present) still succeeds without confirm=true", async () => {
		// Sanity regression: the confirm gate must NOT break the common
		// case where clearAccounts correctly unlinks the live file before
		// the rename runs.
		await seedBackup("from-backup");
		// No seedCurrentJson call — canonical path starts empty.

		const t = createCodexKeychainTool(buildCtx());
		const out = (await t.execute(
			{ command: "rollback" },
			{} as never,
		)) as string;
		expect(out).toMatch(/Restored/);
		expect(out).not.toMatch(/refusing/i);

		const active = JSON.parse(
			await fs.readFile(storagePath, "utf-8"),
		) as AccountStorageV3;
		expect(active.accounts[0]!.accountId).toBe("from-backup");
	});
});
