import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("storage race paths", () => {
	let testDir: string;
	let exportPath: string;

	beforeEach(async () => {
		testDir = await fs.mkdtemp(join(tmpdir(), "storage-race-"));
		exportPath = join(testDir, "import.json");
	});

	afterEach(async () => {
		const storageModule = await import("../lib/storage.js");
		storageModule.setStoragePathDirect(null);
		await fs.rm(testDir, { recursive: true, force: true });
		vi.restoreAllMocks();
	});

	it("retries a transient EBUSY during import commit rename", async () => {
		const storageModule = await import("../lib/storage.js");
		const originalRename = fs.rename.bind(fs);
		let renameAttempts = 0;

		storageModule.setStoragePathDirect(join(testDir, "accounts.json"));
		await fs.writeFile(
			exportPath,
			JSON.stringify({
				version: 3,
				activeIndex: 0,
				accounts: [{ accountId: "race-import", refreshToken: "race-refresh", addedAt: 1, lastUsed: 1 }],
			}),
			"utf8",
		);

		vi.spyOn(fs, "rename").mockImplementation(async (source, destination) => {
			if (String(destination).endsWith("accounts.json")) {
				renameAttempts += 1;
				if (renameAttempts === 1) {
					const error = new Error("busy") as NodeJS.ErrnoException;
					error.code = "EBUSY";
					throw error;
				}
			}
			return originalRename(source, destination);
		});

		const result = await storageModule.importAccounts(exportPath);
		const loaded = await storageModule.loadAccounts();

		expect(result.imported).toBe(1);
		expect(renameAttempts).toBeGreaterThanOrEqual(2);
		expect(loaded?.accounts).toHaveLength(1);
		expect(loaded?.accounts[0]?.accountId).toBe("race-import");
	});

	it("keeps duplicate-email cleanup stable under concurrent cleanup runs", async () => {
		const storageModule = await import("../lib/storage.js");

		storageModule.setStoragePathDirect(join(testDir, "accounts.json"));
		await fs.writeFile(
			join(testDir, "accounts.json"),
			JSON.stringify({
				version: 3,
				activeIndex: 0,
				activeIndexByFamily: {},
				accounts: [
					{ email: "shared@example.com", refreshToken: "older", addedAt: 1, lastUsed: 1 },
					{ email: "shared@example.com", refreshToken: "newer", addedAt: 2, lastUsed: 2 },
					{ email: "unique@example.com", refreshToken: "unique", addedAt: 3, lastUsed: 3 },
				],
			}),
			"utf8",
		);

		const results = await Promise.allSettled([
			storageModule.cleanupDuplicateEmailAccounts(),
			storageModule.cleanupDuplicateEmailAccounts(),
		]);
		const loaded = await storageModule.loadAccounts();

		expect(results.every((result) => result.status === "fulfilled")).toBe(true);
		expect(loaded?.accounts).toHaveLength(2);
		expect(loaded?.accounts[0]?.refreshToken).toBe("newer");
		expect(loaded?.accounts[1]?.refreshToken).toBe("unique");
	});

	it("serializes raw backups behind the storage lock during concurrent saves", async () => {
		const storageModule = await import("../lib/storage.js");
		const originalRename = fs.rename.bind(fs);
		const storagePath = join(testDir, "accounts.json");
		const backupPath = join(testDir, "backup.json");
		let releaseRename: (() => void) | null = null;
		let backupFinished = false;

		storageModule.setStoragePathDirect(storagePath);
		await storageModule.saveAccounts({
			version: 3,
			activeIndex: 0,
			activeIndexByFamily: {},
			accounts: [{ accountId: "before", refreshToken: "before", addedAt: 1, lastUsed: 1 }],
		});

		vi.spyOn(fs, "rename").mockImplementation(async (source, destination) => {
			if (String(destination) === storagePath && releaseRename === null) {
				await new Promise<void>((resolve) => {
					releaseRename = resolve;
				});
			}
			return originalRename(source, destination);
		});

		const savePromise = storageModule.saveAccounts({
			version: 3,
			activeIndex: 0,
			activeIndexByFamily: {},
			accounts: [{ accountId: "after", refreshToken: "after", addedAt: 2, lastUsed: 2 }],
		});
		const backupPromise = storageModule.backupRawAccountsFile(backupPath).then(() => {
			backupFinished = true;
		});

		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(backupFinished).toBe(false);
		releaseRename?.();

		await Promise.all([savePromise, backupPromise]);

		const backup = JSON.parse(await fs.readFile(backupPath, "utf8")) as {
			accounts: Array<{ accountId?: string }>;
		};
		expect(backup.accounts[0]?.accountId).toBe("after");
	});
});
