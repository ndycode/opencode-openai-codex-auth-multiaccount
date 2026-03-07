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
});
