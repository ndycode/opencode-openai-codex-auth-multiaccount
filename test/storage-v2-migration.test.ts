import { promises as fs } from "node:fs";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	StorageError,
	loadAccounts,
	normalizeAccountStorage,
	setStoragePathDirect,
} from "../lib/storage.js";
import {
	UNKNOWN_V2_FORMAT_CODE,
	buildV2RecoveryHint,
	buildV2RejectionMessage,
} from "../lib/storage/migrations.js";

/**
 * Audit top-20 #8: files with `version: 2` were silently ignored by
 * `normalizeAccountStorage`, which returned null and caused the loader to
 * behave as if the user had no accounts at all. The fix is an explicit
 * rejection with a `UNKNOWN_V2_FORMAT` StorageError so the UI can surface
 * a recovery path instead of quietly discarding the user's credentials.
 */

const FIXTURE_PATH = fileURLToPath(
	new URL("./fixtures/v2-storage.json", import.meta.url),
);

let tempDir: string;
let tempFile: string;

beforeEach(async () => {
	tempDir = await fs.mkdtemp(join(tmpdir(), "v2-migration-"));
	tempFile = join(tempDir, "accounts.json");
});

afterEach(async () => {
	if (existsSync(tempDir)) {
		await fs.rm(tempDir, { recursive: true, force: true });
	}
});

describe("V2 storage detection (normalizeAccountStorage)", () => {
	it("throws a typed StorageError with UNKNOWN_V2_FORMAT code on a version:2 payload", () => {
		const v2Data = {
			version: 2,
			accounts: [{ email: "user@example.com" }],
		};

		expect(() => normalizeAccountStorage(v2Data)).toThrow(StorageError);

		try {
			normalizeAccountStorage(v2Data);
		} catch (error) {
			expect(error).toBeInstanceOf(StorageError);
			const storageError = error as StorageError;
			expect(storageError.code).toBe(UNKNOWN_V2_FORMAT_CODE);
			expect(storageError.message).toBe(buildV2RejectionMessage());
		}
	});

	it("throws for the canonical v2 fixture file", async () => {
		const raw = await fs.readFile(FIXTURE_PATH, "utf-8");
		const parsed = JSON.parse(raw) as unknown;
		expect(() => normalizeAccountStorage(parsed)).toThrow(StorageError);
	});

	it("detects V2 and throws (not silently null) when accounts is null", () => {
		// Regression: previously `.optional()` on the V2-detection schema
		// rejected `accounts: null`, so a V2 file with a null accounts field
		// fell through to the warn+return-null path and silently discarded
		// credentials. `.nullish()` restores the V2 detection so the loader
		// surfaces a typed UNKNOWN_V2_FORMAT error instead.
		const malformedV2 = { version: 2, accounts: null };

		expect(() => normalizeAccountStorage(malformedV2)).toThrow(StorageError);

		try {
			normalizeAccountStorage(malformedV2);
		} catch (error) {
			expect(error).toBeInstanceOf(StorageError);
			const storageError = error as StorageError;
			expect(storageError.code).toBe(UNKNOWN_V2_FORMAT_CODE);
			expect(storageError.message).toBe(buildV2RejectionMessage());
		}
	});

	it("detects V2 and throws when accounts is missing entirely", () => {
		// Parallel coverage: `.nullish()` must also allow `undefined` (i.e.
		// accounts field absent), which was the only case that worked before.
		const malformedV2: Record<string, unknown> = { version: 2 };

		expect(() => normalizeAccountStorage(malformedV2)).toThrow(StorageError);

		try {
			normalizeAccountStorage(malformedV2);
		} catch (error) {
			expect(error).toBeInstanceOf(StorageError);
			expect((error as StorageError).code).toBe(UNKNOWN_V2_FORMAT_CODE);
		}
	});

	it("continues to return null for unknown versions other than 2 (sub-bound numeric, string, missing)", () => {
		// version 42 would now trip the forward-compat guard (>3) and throw, so
		// we exercise the generic unknown-version bucket with version 0 — a
		// finite number that is neither >3, literal 2, nor 1/3.
		expect(
			normalizeAccountStorage({ version: 0, accounts: [] }),
		).toBeNull();
		expect(
			normalizeAccountStorage({ version: "two", accounts: [] }),
		).toBeNull();
		expect(normalizeAccountStorage({ accounts: [] })).toBeNull();
	});

	it("V1 still migrates cleanly (no V2 regression in adjacent version path)", () => {
		const v1 = {
			version: 1,
			accounts: [
				{
					refreshToken: "rt",
					accessToken: "at",
					expiresAt: 0,
				},
			],
			activeIndex: 0,
		};
		const result = normalizeAccountStorage(v1);
		expect(result).not.toBeNull();
		expect(result?.version).toBe(3);
	});

	it("V3 passes through unchanged", () => {
		const v3 = {
			version: 3,
			accounts: [
				{
					refreshToken: "rt",
					accessToken: "at",
					expiresAt: 0,
					rateLimitResetTimes: {},
				},
			],
			activeIndex: 0,
			activeIndexByFamily: {},
		};
		const result = normalizeAccountStorage(v3);
		expect(result).not.toBeNull();
		expect(result?.version).toBe(3);
	});
});

describe("V2 storage detection (loadAccounts end-to-end)", () => {
	it("loadAccounts throws a StorageError with the recovery hint populated when reading a v2 file", async () => {
		setStoragePathDirect(tempFile);
		await fs.writeFile(
			tempFile,
			JSON.stringify({
				version: 2,
				accounts: [{ email: "user@example.com" }],
			}),
			{ encoding: "utf-8", mode: 0o600 },
		);

		await expect(loadAccounts()).rejects.toBeInstanceOf(StorageError);

		try {
			await loadAccounts();
		} catch (error) {
			const storageError = error as StorageError;
			expect(storageError.code).toBe(UNKNOWN_V2_FORMAT_CODE);
			// Recovery hint should point at the concrete storage path, not "<unknown>".
			expect(storageError.hint).toBe(buildV2RecoveryHint(tempFile));
			expect(storageError.hint).toContain(tempFile);
		}

		setStoragePathDirect(null);
	});
});

describe("V2 rejection message + recovery hint copy", () => {
	it("rejection message names version 2 explicitly", () => {
		expect(buildV2RejectionMessage()).toMatch(/version 2/);
	});

	it("recovery hint instructs the user how to recover", () => {
		const hint = buildV2RecoveryHint("/tmp/accounts.json");
		expect(hint).toContain("/tmp/accounts.json");
		expect(hint).toMatch(/back up|backup/i);
		expect(hint).toMatch(/opencode auth login/i);
	});

	it("recovery hint handles an empty path without producing empty-quotes", () => {
		const hint = buildV2RecoveryHint("");
		expect(hint).toContain("<unknown>");
		expect(hint).not.toMatch(/\bat\s+,/);
	});
});
