import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	applyAccountSelectionFallbacks,
	persistAccountPool,
	resolveAccountSelection,
	resolveAndPersistAccountSelection,
	type TokenSuccessWithAccount,
} from "../lib/auth/login-runner.js";
import { loadAccounts, setStoragePathDirect } from "../lib/storage.js";

function createTokenResult(
	accountId: string,
	refreshToken: string,
): TokenSuccessWithAccount {
	return {
		type: "success",
		access: `access-${accountId}`,
		refresh: refreshToken,
		expires: Date.now() + 60_000,
		accountIdOverride: accountId,
		accountIdSource: "manual",
		accountLabel: accountId,
	};
}

describe("login-runner persistAccountPool", () => {
	let testDir: string;
	let storagePath: string;

	beforeEach(async () => {
		testDir = join(
			tmpdir(),
			`login-runner-${Date.now()}-${Math.random().toString(36).slice(2)}`,
		);
		storagePath = join(testDir, "openai-codex-accounts.json");
		await fs.mkdir(testDir, { recursive: true });
		setStoragePathDirect(storagePath);
	});

	afterEach(async () => {
		setStoragePathDirect(null);
		vi.restoreAllMocks();
		await fs.rm(testDir, { recursive: true, force: true });
	});

	it("serializes overlapping login persists without losing accounts", async () => {
		const originalRename = fs.rename.bind(fs);
		let firstRenameReleased = false;
		let resolveFirstRename: (() => void) | undefined;
		const firstRenameBlocked = new Promise<void>((resolve) => {
			resolveFirstRename = resolve;
		});
		let resolveFirstRenameStarted: (() => void) | undefined;
		const firstRenameStarted = new Promise<void>((resolve) => {
			resolveFirstRenameStarted = resolve;
		});
		let renameCount = 0;

		const renameSpy = vi
			.spyOn(fs, "rename")
			.mockImplementation(async (sourcePath, destinationPath) => {
				renameCount += 1;
				if (renameCount === 1 && !firstRenameReleased) {
					resolveFirstRenameStarted?.();
					await firstRenameBlocked;
					firstRenameReleased = true;
				}
				return originalRename(sourcePath, destinationPath);
			});

		try {
			const firstPersist = persistAccountPool(
				[createTokenResult("acct-a", "refresh-a")],
				false,
			);
			await firstRenameStarted;

			const secondPersist = persistAccountPool(
				[createTokenResult("acct-b", "refresh-b")],
				false,
			);

			resolveFirstRename?.();
			await Promise.all([firstPersist, secondPersist]);

			expect(renameSpy).toHaveBeenCalledTimes(2);
			const loaded = await loadAccounts();
			expect(loaded?.accounts).toHaveLength(2);
			expect(
				new Set(loaded?.accounts.map((account) => account.accountId)),
			).toEqual(new Set(["acct-a", "acct-b"]));
		} finally {
			resolveFirstRename?.();
		}
	});
});

describe("login-runner selection finalization", () => {
	it("applies flagged-account fallbacks without overwriting resolved ids", () => {
		const selection = resolveAccountSelection({
			type: "success",
			access: "access-token",
			refresh: "refresh-token",
			expires: Date.now() + 60_000,
			idToken: "id-token",
			accountIdOverride: "resolved-account",
			organizationIdOverride: "resolved-org",
			accountLabel: "Resolved label",
		});

		const updated = applyAccountSelectionFallbacks(selection, {
			accountIdOverride: "flagged-account",
			accountIdSource: "manual",
			organizationIdOverride: "flagged-org",
			accountLabel: "Flagged label",
		});

		expect(updated.primary.accountIdOverride).toBe("resolved-account");
		expect(updated.primary.organizationIdOverride).toBe("resolved-org");
		expect(updated.primary.accountLabel).toBe("Resolved label");
		expect(updated.variantsForPersistence).toHaveLength(selection.variantsForPersistence.length);
	});

	it("resolves and persists the selected variants through the shared callback", async () => {
		const persistSelections = vi.fn(async () => {});
		const result = await resolveAndPersistAccountSelection(
			{
				type: "success",
				access: "persist-access",
				refresh: "persist-refresh",
				expires: Date.now() + 60_000,
				idToken: "persist-id",
			},
			{
				persistSelections,
				replaceAll: true,
				fallbacks: {
					accountIdOverride: "flagged-account",
					accountIdSource: "manual",
					accountLabel: "Flagged label",
				},
			},
		);

		expect(result.primary.accountIdOverride).toBe("flagged-account");
		expect(result.primary.accountLabel).toBe("Flagged label");
		expect(persistSelections).toHaveBeenCalledTimes(1);
		expect(persistSelections).toHaveBeenCalledWith(result.variantsForPersistence, true);
	});
});
