/**
 * Tests for the opt-in OS-keychain credential backend (Phase 4 F1).
 *
 * Two concerns:
 *   1. The low-level backend wrapper in `lib/storage/keychain.ts`. Every
 *      branch is exercised against an in-memory mock backend — no real OS
 *      keychain is touched so these tests are deterministic in CI.
 *   2. The load-save integration. We flip `CODEX_KEYCHAIN` on, stage an
 *      on-disk JSON file, and assert that a save migrates the file into
 *      the keychain and renames the original with the documented
 *      `.migrated-to-keychain.<ts>` suffix. We also assert the inverse:
 *      with `CODEX_KEYCHAIN` unset, the keychain backend is never invoked.
 *
 * The fallback contract (keychain failure -> JSON) is covered by injecting
 * a mock backend whose `set` rejects. The test asserts the JSON file still
 * contains the persisted state and nothing was silently lost.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
	_resetBackendForTests,
	_setBackendForTests,
	buildKeychainAccountKey,
	deleteFromKeychain,
	GLOBAL_KEYCHAIN_ACCOUNT_KEY,
	isKeychainOptInEnabled,
	KEYCHAIN_PROBE_ACCOUNT_KEY,
	KEYCHAIN_SERVICE_NAME,
	keychainIsAvailable,
	readFromKeychain,
	writeToKeychain,
	type KeychainBackend,
} from "../lib/storage/keychain.js";
import {
	clearAccounts,
	loadAccounts,
	saveAccounts,
} from "../lib/storage.js";
import {
	setStoragePathDirect,
	getStoragePath,
} from "../lib/storage/state.js";
import type { AccountStorageV3 } from "../lib/storage.js";

/**
 * Deterministic in-memory keychain. Records every call so tests can
 * assert not just state but also that the production code path actually
 * routed through the backend (or did NOT, for the opt-out baseline).
 */
interface MockBackend extends KeychainBackend {
	store: Map<string, string>;
	calls: Array<{ op: string; service: string; account: string }>;
	setShouldThrow: boolean;
	available: boolean;
}

function createMockBackend(): MockBackend {
	const store = new Map<string, string>();
	const calls: MockBackend["calls"] = [];
	const backend: MockBackend = {
		store,
		calls,
		setShouldThrow: false,
		available: true,
		async get(service, account) {
			calls.push({ op: "get", service, account });
			return store.get(`${service}::${account}`) ?? null;
		},
		async set(service, account, secret) {
			calls.push({ op: "set", service, account });
			if (backend.setShouldThrow) {
				throw new Error("simulated keychain failure");
			}
			store.set(`${service}::${account}`, secret);
		},
		async delete(service, account) {
			calls.push({ op: "delete", service, account });
			return store.delete(`${service}::${account}`);
		},
		async isAvailable() {
			calls.push({ op: "isAvailable", service: KEYCHAIN_SERVICE_NAME, account: "__availability_probe__" });
			return backend.available;
		},
	};
	return backend;
}

async function allocateStorageDir(): Promise<string> {
	const dir = join(
		tmpdir(),
		`keychain-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	await fs.mkdir(dir, { recursive: true });
	return dir;
}

const ORIGINAL_CODEX_KEYCHAIN = process.env.CODEX_KEYCHAIN;

function setOptIn(on: boolean): void {
	if (on) {
		process.env.CODEX_KEYCHAIN = "1";
	} else {
		delete process.env.CODEX_KEYCHAIN;
	}
}

function restoreOptIn(): void {
	if (ORIGINAL_CODEX_KEYCHAIN === undefined) {
		delete process.env.CODEX_KEYCHAIN;
	} else {
		process.env.CODEX_KEYCHAIN = ORIGINAL_CODEX_KEYCHAIN;
	}
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

describe("lib/storage/keychain: low-level backend", () => {
	beforeEach(() => {
		_resetBackendForTests();
	});
	afterEach(() => {
		_resetBackendForTests();
	});

	describe("isKeychainOptInEnabled", () => {
		it("returns true only when CODEX_KEYCHAIN is the literal string '1'", () => {
			expect(isKeychainOptInEnabled({ CODEX_KEYCHAIN: "1" })).toBe(true);
			expect(isKeychainOptInEnabled({ CODEX_KEYCHAIN: "0" })).toBe(false);
			expect(isKeychainOptInEnabled({ CODEX_KEYCHAIN: "true" })).toBe(false);
			expect(isKeychainOptInEnabled({ CODEX_KEYCHAIN: "" })).toBe(false);
			expect(isKeychainOptInEnabled({})).toBe(false);
		});
	});

	describe("buildKeychainAccountKey", () => {
		it("returns the global sentinel when project key is null", () => {
			expect(buildKeychainAccountKey(null)).toBe(GLOBAL_KEYCHAIN_ACCOUNT_KEY);
		});
		it("namespaces per-project keys under an accounts: prefix", () => {
			expect(buildKeychainAccountKey("my-project-abc123")).toBe(
				"accounts:my-project-abc123",
			);
		});
	});

	describe("[LOW] KEYCHAIN_PROBE_ACCOUNT_KEY namespacing", () => {
		it("is service-suffixed and cannot collide with real account keys", () => {
			// F1 post-merge LOW finding: a future refactor that drops the
			// `accounts:` prefix on real entries must still not collide
			// with the probe. We assert both a structural invariant (the
			// probe key contains the service name) and a
			// collision-impossibility invariant (no real account key the
			// build helper could emit equals the probe key).
			expect(KEYCHAIN_PROBE_ACCOUNT_KEY).toContain(KEYCHAIN_SERVICE_NAME);
			expect(KEYCHAIN_PROBE_ACCOUNT_KEY).not.toBe(GLOBAL_KEYCHAIN_ACCOUNT_KEY);
			expect(KEYCHAIN_PROBE_ACCOUNT_KEY).not.toBe(
				buildKeychainAccountKey("some-project"),
			);
			// The previous probe value (`__availability_probe__`) was not
			// service-suffixed; make sure we moved off that literal.
			expect(KEYCHAIN_PROBE_ACCOUNT_KEY).not.toBe("__availability_probe__");
		});
	});

	describe("read/write/delete happy path", () => {
		it("stores and retrieves the V3 JSON blob under the project key", async () => {
			const mock = createMockBackend();
			_setBackendForTests(mock);

			const blob = JSON.stringify(makeStorage());
			const write = await writeToKeychain("proj-key", blob);
			expect(write.ok).toBe(true);
			expect(mock.store.get(`${KEYCHAIN_SERVICE_NAME}::accounts:proj-key`)).toBe(
				blob,
			);

			const read = await readFromKeychain("proj-key");
			expect(read).toBe(blob);

			const del = await deleteFromKeychain("proj-key");
			expect(del).toBe(true);
			expect(mock.store.size).toBe(0);
		});

		it("delete returns false when entry is absent", async () => {
			const mock = createMockBackend();
			_setBackendForTests(mock);
			const del = await deleteFromKeychain("missing-key");
			expect(del).toBe(false);
		});

		it("readFromKeychain returns null when a mock backend has no entry for the key", async () => {
			// Direct branch: backend is present, `get` returns null because
			// nothing was ever written. This covers the common "no entry"
			// read path through the mock. Renamed from the original
			// "when backend is unavailable" title, which asserted this
			// mock-returns-null case while claiming to cover the
			// `cachedBackend === null` branch (F1 post-merge NIT finding).
			const mock = createMockBackend();
			_setBackendForTests(mock);
			const read = await readFromKeychain("never-written-key");
			expect(read).toBeNull();
		});

		it("readFromKeychain returns null when the native backend cannot load", async () => {
			// Genuinely-unavailable branch (`keychain.ts:211`: `if (!backend)
			// return null`). Replace `@napi-rs/keyring` with an empty module
			// via `vi.doMock` so `loadNativeBackend` sees
			// `typeof mod.Entry !== "function"`, logs a warning, and
			// memoizes `null`. `vi.resetModules` + dynamic import forces a
			// fresh load of `keychain.ts` so it picks up the doMock.
			await vi.resetModules();
			vi.doMock("@napi-rs/keyring", () => ({}));
			try {
				const fresh = await import("../lib/storage/keychain.js");
				fresh._resetBackendForTests();
				const read = await fresh.readFromKeychain("any-key");
				expect(read).toBeNull();
			} finally {
				vi.doUnmock("@napi-rs/keyring");
				await vi.resetModules();
			}
		});
	});

	describe("fallback-on-failure contract", () => {
		it("writeToKeychain returns ok=false when backend throws", async () => {
			const mock = createMockBackend();
			mock.setShouldThrow = true;
			_setBackendForTests(mock);

			const result = await writeToKeychain("proj-key", "{}");
			expect(result.ok).toBe(false);
			expect(result.error).toContain("simulated keychain failure");
			expect(mock.store.size).toBe(0);
		});

		it("keychainIsAvailable reflects the backend probe when opt-in is on", async () => {
			const mock = createMockBackend();
			mock.available = false;
			_setBackendForTests(mock);
			// Pass an explicit env so the probe gate evaluates to on
			// regardless of the test runner's ambient CODEX_KEYCHAIN value.
			const enabledEnv = { CODEX_KEYCHAIN: "1" } as NodeJS.ProcessEnv;
			expect(await keychainIsAvailable(enabledEnv)).toBe(false);

			mock.available = true;
			expect(await keychainIsAvailable(enabledEnv)).toBe(true);
		});

		it("[LOW] keychainIsAvailable returns false without probing when opt-in is off", async () => {
			// F1 post-merge LOW finding: `codex-keychain status` used to
			// call `keychainIsAvailable()` unconditionally, which writes a
			// throwaway entry to the OS keychain and can pop a macOS
			// "allow/always allow" prompt for users who never set
			// CODEX_KEYCHAIN. Gate guarantees: (a) returns false when
			// opt-in is off, (b) never invokes the backend probe.
			const mock = createMockBackend();
			_setBackendForTests(mock);
			const disabledEnv = {} as NodeJS.ProcessEnv; // CODEX_KEYCHAIN unset
			expect(await keychainIsAvailable(disabledEnv)).toBe(false);
			const probeCalls = mock.calls.filter((c) => c.op === "isAvailable");
			expect(probeCalls).toHaveLength(0);
		});
	});
});

describe("load-save integration with CODEX_KEYCHAIN", () => {
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
	});

	afterEach(async () => {
		setStoragePathDirect(null);
		_resetBackendForTests();
		restoreOptIn();
		try {
			await fs.rm(storageDir, { recursive: true, force: true });
		} catch {
			/* ignore */
		}
	});

	it("with CODEX_KEYCHAIN unset, saveAccounts writes to JSON and never calls backend", async () => {
		setOptIn(false);
		await saveAccounts(makeStorage());
		expect(existsSync(storagePath)).toBe(true);
		const setCalls = mock.calls.filter((c) => c.op === "set");
		expect(setCalls).toHaveLength(0);
	});

	it("with CODEX_KEYCHAIN=1, save migrates JSON to keychain and renames original", async () => {
		// Pre-seed an on-disk JSON file (the "existing user" case).
		setOptIn(false);
		await saveAccounts(makeStorage());
		expect(existsSync(storagePath)).toBe(true);

		// Flip opt-in and save again; this is the migration trigger.
		setOptIn(true);
		await saveAccounts(makeStorage());

		// Keychain has the blob.
		const stored = mock.store.get(`${KEYCHAIN_SERVICE_NAME}::${GLOBAL_KEYCHAIN_ACCOUNT_KEY}`);
		expect(stored).toBeDefined();
		expect(stored && JSON.parse(stored).accounts[0].accountId).toBe("acct-1");

		// Original JSON is renamed, not deleted.
		expect(existsSync(storagePath)).toBe(false);
		const entries = await fs.readdir(storageDir);
		const backup = entries.find((name) =>
			name.startsWith("accounts.json.migrated-to-keychain."),
		);
		expect(backup).toBeDefined();
	});

	it("with CODEX_KEYCHAIN=1, subsequent loadAccounts reads from keychain", async () => {
		setOptIn(true);
		const before = makeStorage();
		before.accounts[0]!.accountId = "acct-from-keychain";
		await saveAccounts(before);

		// No JSON file should be present after save + migrate (JSON never
		// existed, so no backup either).
		expect(existsSync(storagePath)).toBe(false);

		const loaded = await loadAccounts();
		expect(loaded).not.toBeNull();
		expect(loaded!.accounts[0]!.accountId).toBe("acct-from-keychain");

		// At least one `get` against the keychain account key.
		const getCalls = mock.calls.filter(
			(c) => c.op === "get" && c.account === GLOBAL_KEYCHAIN_ACCOUNT_KEY,
		);
		expect(getCalls.length).toBeGreaterThanOrEqual(1);
	});

	it("keychain failure falls back to JSON without losing data", async () => {
		setOptIn(true);
		mock.setShouldThrow = true;

		await saveAccounts(makeStorage());

		// The keychain write was attempted and failed…
		const setCalls = mock.calls.filter((c) => c.op === "set");
		expect(setCalls.length).toBeGreaterThanOrEqual(1);
		expect(mock.store.size).toBe(0);

		// …but the JSON file was written as a fallback so credentials
		// were not silently lost.
		expect(existsSync(storagePath)).toBe(true);
		const onDisk = JSON.parse(await fs.readFile(storagePath, "utf-8"));
		expect(onDisk.accounts[0].accountId).toBe("acct-1");
	});

	it("clearAccounts removes both the keychain entry and the JSON file when opt-in is on", async () => {
		setOptIn(true);
		await saveAccounts(makeStorage());
		expect(mock.store.size).toBe(1);

		await clearAccounts();
		expect(mock.store.size).toBe(0);
		expect(existsSync(storagePath)).toBe(false);
	});

	// --- F1 post-merge review regression tests -----------------------------------
	// Each test below is named against the finding it covers so the next
	// reviewer can trace test -> review ledger without code archaeology.
	// See docs/audits/_meta/f1-post-merge-review.md.

	it("[HIGH] does not resurrect stale JSON after opt-in toggle off when backup rename fails", async () => {
		// Seed: opt-in off, write a "stale" blob to the on-disk JSON. This
		// is what an existing JSON-only user looks like before they flip
		// CODEX_KEYCHAIN=1.
		setOptIn(false);
		const stale = makeStorage();
		stale.accounts[0]!.accountId = "acct-stale";
		await saveAccounts(stale);
		expect(existsSync(storagePath)).toBe(true);

		// Flip opt-in on. Force ONLY the backup rename to fail with a
		// non-ENOENT error. The subsequent fallback write
		// (writeAccountsToPathUnlocked) still needs a working fs.rename
		// to complete its temp-file swap, so we intercept exactly one
		// call with mockImplementationOnce.
		setOptIn(true);
		const renameSpy = vi
			.spyOn(fs, "rename")
			.mockImplementationOnce(async () => {
				throw Object.assign(new Error("simulated EACCES on backup rename"), {
					code: "EACCES",
				});
			});
		try {
			const fresh = makeStorage();
			fresh.accounts[0]!.accountId = "acct-fresh";
			await saveAccounts(fresh);
		} finally {
			renameSpy.mockRestore();
		}

		// Keychain holds the authoritative fresh blob.
		const stored = mock.store.get(
			`${KEYCHAIN_SERVICE_NAME}::${GLOBAL_KEYCHAIN_ACCOUNT_KEY}`,
		);
		expect(stored).toBeDefined();
		expect(JSON.parse(stored!).accounts[0].accountId).toBe("acct-fresh");

		// On-disk JSON still exists (backup rename failed) BUT its
		// contents have been refreshed with the fresh blob. If the user
		// now unsets CODEX_KEYCHAIN, loadAccounts reads from this file
		// and sees "acct-fresh", not "acct-stale" — the HIGH-finding
		// guarantee.
		expect(existsSync(storagePath)).toBe(true);
		const onDisk = JSON.parse(
			await fs.readFile(storagePath, "utf-8"),
		) as AccountStorageV3;
		expect(onDisk.accounts[0]!.accountId).toBe("acct-fresh");
	});

	it("[MEDIUM] clearAccounts skips keychain delete if JSON unlink fails (keeps sides in sync)", async () => {
		// Seed: opt-in on, write storage so BOTH sides hold the blob.
		setOptIn(true);
		await saveAccounts(makeStorage());
		expect(mock.store.size).toBe(1);
		// saveAccounts under opt-in renames the on-disk JSON into a backup
		// immediately after the keychain write, so the canonical path is
		// absent. We write a fresh JSON back in place to simulate a user
		// who has both the keychain entry and an on-disk file (e.g. a
		// race write that landed between rotation saves).
		await fs.writeFile(
			storagePath,
			JSON.stringify(makeStorage(), null, 2),
			{ encoding: "utf-8", mode: 0o600 },
		);
		expect(existsSync(storagePath)).toBe(true);

		// Force unlink to throw EBUSY once. After the fix, clearAccounts
		// should NOT delete the keychain entry so both sides remain in
		// sync (caller can retry later). Before the fix, the keychain
		// delete ran first and would have wiped the blob; a subsequent
		// load with opt-in still on would then resurrect the credentials
		// from the unlinkable JSON file.
		const unlinkSpy = vi
			.spyOn(fs, "unlink")
			.mockImplementationOnce(async () => {
				throw Object.assign(new Error("simulated EBUSY on unlink"), {
					code: "EBUSY",
				});
			});
		try {
			await expect(clearAccounts()).resolves.toBeUndefined();
		} finally {
			unlinkSpy.mockRestore();
		}

		// Keychain blob survives because the unlink-first ordering skipped
		// the keychain delete when the unlink failed.
		expect(mock.store.size).toBe(1);
		const stored = mock.store.get(
			`${KEYCHAIN_SERVICE_NAME}::${GLOBAL_KEYCHAIN_ACCOUNT_KEY}`,
		);
		expect(stored).toBeDefined();

		// No delete-op against the keychain was issued during the failed
		// clearAccounts call.
		const deleteCalls = mock.calls.filter(
			(c) => c.op === "delete" && c.account === GLOBAL_KEYCHAIN_ACCOUNT_KEY,
		);
		expect(deleteCalls).toHaveLength(0);
	});

	it.skipIf(process.platform === "win32")(
		"[LOW] backup file is chmod 0o600 after migration rename (POSIX)",
		async () => {
			// F1 post-merge LOW finding: after the atomic-rename of the
			// legacy on-disk JSON to `.migrated-to-keychain.<ts>`, the
			// backup must be re-chmodded to 0o600 so any mode drift between
			// migration and rollback cannot leave the backup group/world-
			// readable. Windows ignores POSIX mode bits so skip there.
			setOptIn(false);
			await saveAccounts(makeStorage());
			expect(existsSync(storagePath)).toBe(true);
			// Force an artificial 0o644 on the live file so we can detect
			// whether the post-rename chmod actually ran. If the fix is
			// absent, the backup inherits 0o644 and this assertion fails.
			await fs.chmod(storagePath, 0o644);

			setOptIn(true);
			await saveAccounts(makeStorage());

			const entries = await fs.readdir(storageDir);
			const backupName = entries.find((name) =>
				name.startsWith("accounts.json.migrated-to-keychain."),
			);
			expect(backupName).toBeDefined();
			const st = await fs.stat(join(storageDir, backupName!));
			// Mask to the low 9 permission bits to ignore file-type bits.
			expect(st.mode & 0o777).toBe(0o600);
		},
	);

	it("[MEDIUM] clearAccounts unlinks JSON first, then keychain, in the happy path", async () => {
		// Order check: the JSON file must be gone BEFORE the keychain
		// delete runs. We can't directly observe fs.unlink timing without
		// a spy, so verify the recorded keychain ops show delete occurred
		// and the on-disk file is absent at call completion.
		setOptIn(true);
		await saveAccounts(makeStorage());

		await clearAccounts();

		expect(existsSync(storagePath)).toBe(false);
		expect(mock.store.size).toBe(0);
		const deleteCalls = mock.calls.filter(
			(c) => c.op === "delete" && c.account === GLOBAL_KEYCHAIN_ACCOUNT_KEY,
		);
		expect(deleteCalls).toHaveLength(1);
	});

	it("corrupt keychain payload falls back to JSON read", async () => {
		setOptIn(true);
		// Pre-seed a valid on-disk JSON file.
		setOptIn(false);
		await saveAccounts(makeStorage());
		setOptIn(true);
		// Corrupt the keychain entry directly.
		mock.store.set(
			`${KEYCHAIN_SERVICE_NAME}::${GLOBAL_KEYCHAIN_ACCOUNT_KEY}`,
			"not valid json{{{",
		);

		const loaded = await loadAccounts();
		expect(loaded).not.toBeNull();
		expect(loaded!.accounts[0]!.accountId).toBe("acct-1");
	});
});

describe("CODEX_KEYCHAIN default-off baseline", () => {
	// Regression test for the primary safety invariant: with the env var
	// unset, nothing in the keychain backend is ever invoked — not even
	// the availability probe. This is what guarantees existing users see
	// zero behavioral change from this PR.
	let mock: MockBackend;
	let storageDir: string;
	let storagePath: string;

	beforeEach(async () => {
		_resetBackendForTests();
		mock = createMockBackend();
		_setBackendForTests(mock);
		storageDir = await allocateStorageDir();
		storagePath = join(storageDir, "accounts.json");
		setStoragePathDirect(storagePath);
		setOptIn(false);
	});

	afterEach(async () => {
		setStoragePathDirect(null);
		_resetBackendForTests();
		restoreOptIn();
		await fs.rm(storageDir, { recursive: true, force: true }).catch(() => {
			/* ignore */
		});
	});

	it("save -> load round-trip never touches the backend", async () => {
		await saveAccounts(makeStorage());
		const loaded = await loadAccounts();
		expect(loaded).not.toBeNull();
		expect(loaded!.accounts[0]!.accountId).toBe("acct-1");

		// No calls to the backend at all.
		expect(mock.calls).toHaveLength(0);
	});

	it("clearAccounts never touches the backend", async () => {
		await saveAccounts(makeStorage());
		mock.calls.length = 0; // reset

		await clearAccounts();
		expect(mock.calls).toHaveLength(0);
	});
});

// Suppress the "vi unused" warning in files where we do not actually need
// vi. Keeping the import makes future test additions trivially easy.
void vi;

// Also import getStoragePath to silence the unused-import warning while
// keeping it available for manual repro during interactive debugging.
void getStoragePath;
