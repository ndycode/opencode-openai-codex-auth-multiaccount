import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("codex-multi-auth sync race paths", () => {
	let testDir: string;
	let sourceRoot: string;
	let storagePath: string;
	const originalEnv = {
		CODEX_MULTI_AUTH_DIR: process.env.CODEX_MULTI_AUTH_DIR,
	};

	beforeEach(async () => {
		testDir = await fs.mkdtemp(join(tmpdir(), "codex-sync-race-"));
		sourceRoot = join(testDir, "source");
		storagePath = join(testDir, "accounts.json");
		process.env.CODEX_MULTI_AUTH_DIR = sourceRoot;
		await fs.mkdir(sourceRoot, { recursive: true });
		await fs.writeFile(
			join(sourceRoot, "openai-codex-accounts.json"),
			JSON.stringify({
				version: 3,
				activeIndex: 0,
				activeIndexByFamily: {},
				accounts: [
					{
						accountId: "org-source-1",
						organizationId: "org-source-1",
						accountIdSource: "org",
						email: "source@example.com",
						refreshToken: "rt-source-1",
						addedAt: 1,
						lastUsed: 1,
					},
				],
			}),
			"utf8",
		);

		const storageModule = await import("../lib/storage.js");
		storageModule.setStoragePathDirect(storagePath);
		await storageModule.clearAccounts();
	});

	afterEach(async () => {
		const storageModule = await import("../lib/storage.js");
		storageModule.setStoragePathDirect(null);
		if (originalEnv.CODEX_MULTI_AUTH_DIR === undefined) {
			delete process.env.CODEX_MULTI_AUTH_DIR;
		} else {
			process.env.CODEX_MULTI_AUTH_DIR = originalEnv.CODEX_MULTI_AUTH_DIR;
		}
		await fs.rm(testDir, { recursive: true, force: true });
	});

	it("keeps the final account store deduplicated under concurrent syncs", async () => {
		const { syncFromCodexMultiAuth } = await import("../lib/codex-multi-auth-sync.js");
		const storageModule = await import("../lib/storage.js");

		const results = await Promise.allSettled([
			syncFromCodexMultiAuth(testDir),
			syncFromCodexMultiAuth(testDir),
		]);

		expect(results.every((result) => result.status === "fulfilled")).toBe(true);

		const loaded = await storageModule.loadAccounts();
		expect(loaded?.accounts).toHaveLength(1);
		expect(loaded?.accounts[0]?.accountId).toBe("org-source-1");
		expect(new Set(loaded?.accounts.map((account) => account.refreshToken))).toEqual(
			new Set(["rt-source-1"]),
		);
	});

	it("keeps synced-overlap cleanup stable under concurrent cleanup runs", async () => {
		const { cleanupCodexMultiAuthSyncedOverlaps } = await import("../lib/codex-multi-auth-sync.js");
		const storageModule = await import("../lib/storage.js");

		await storageModule.saveAccounts({
			version: 3,
			activeIndex: 0,
			activeIndexByFamily: {},
			accounts: [
				{
					accountId: "org-local",
					organizationId: "org-local",
					accountIdSource: "org",
					email: "shared@example.com",
					refreshToken: "rt-local",
					addedAt: 2,
					lastUsed: 2,
				},
				{
					accountId: "org-sync",
					organizationId: "org-sync",
					accountIdSource: "org",
					accountTags: ["codex-multi-auth-sync"],
					email: "shared@example.com",
					refreshToken: "rt-sync",
					addedAt: 1,
					lastUsed: 1,
				},
			],
		});

		const results = await Promise.allSettled([
			cleanupCodexMultiAuthSyncedOverlaps(),
			cleanupCodexMultiAuthSyncedOverlaps(),
		]);
		const loaded = await storageModule.loadAccounts();

		expect(results.every((result) => result.status === "fulfilled")).toBe(true);
		expect(loaded?.accounts).toHaveLength(1);
		expect(loaded?.accounts[0]?.accountId).toBe("org-local");
	});
});
