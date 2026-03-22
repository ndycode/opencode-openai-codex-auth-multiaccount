import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	applyAccountSelectionFallbacks,
	persistAccountPool,
	persistResolvedAccountSelection,
	resolveAccountSelection,
	resolveAndPersistAccountSelection,
	type AccountSelectionResult,
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

	it("updates cloned primary variants without relying on object identity", () => {
		const primary: TokenSuccessWithAccount = {
			type: "success",
			access: "access-token",
			refresh: "refresh-token",
			expires: Date.now() + 60_000,
			idToken: "id-token",
			accountIdOverride: "resolved-account",
			accountIdSource: "token",
		};
		const selection: AccountSelectionResult = {
			primary,
			variantsForPersistence: [{ ...primary }],
		};

		const updated = applyAccountSelectionFallbacks(selection, {
			organizationIdOverride: "resolved-org",
			accountLabel: "Resolved label",
		});

		expect(updated.primary.organizationIdOverride).toBe("resolved-org");
		expect(updated.primary.accountLabel).toBe("Resolved label");
		expect(updated.variantsForPersistence).toHaveLength(1);
		expect(updated.variantsForPersistence[0]).toBe(updated.primary);
		expect(updated.variantsForPersistence[0]?.organizationIdOverride).toBe("resolved-org");
		expect(updated.variantsForPersistence[0]?.accountLabel).toBe("Resolved label");
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

	it("returns the selection unchanged when no persist callback is provided", async () => {
		const selection = resolveAccountSelection({
			type: "success",
			access: "access-token",
			refresh: "refresh-token",
			expires: Date.now() + 60_000,
			idToken: "id-token",
		});

		await expect(persistResolvedAccountSelection(selection)).resolves.toBe(selection);
	});

	it("propagates persist callback failures", async () => {
		const selection = resolveAccountSelection({
			type: "success",
			access: "access-token",
			refresh: "refresh-token",
			expires: Date.now() + 60_000,
			idToken: "id-token",
		});
		const persistError = new Error("persist failed");
		const persistSelections = vi.fn(async () => {
			throw persistError;
		});

		const result = persistResolvedAccountSelection(selection, { persistSelections });
		await expect(
			result,
		).rejects.toThrow("Failed to persist authenticated account selections.");
		await expect(
			result,
		).rejects.not.toThrow("persist failed");
		const wrapped = await result.catch((error) => error as Error & { cause?: unknown });

		expect(wrapped.cause).toBe(persistError);
		expect(wrapped.message).not.toContain("persist failed");
		expect(
			wrapped.message,
		).toBe("Failed to persist authenticated account selections.");
		expect(persistSelections).toHaveBeenCalledTimes(1);
	});

	it("redacts sensitive persistence callback failure details", async () => {
		const selection = resolveAccountSelection({
			type: "success",
			access: "access-token",
			refresh: "refresh-token",
			expires: Date.now() + 60_000,
			idToken: "id-token",
		});
		const persistSelections = vi.fn(async () => {
			throw new Error(
				"EPERM: rename C:\\Users\\neil\\.opencode\\secrets\\token-file.json for acct-123",
			);
		});

		const wrapped = await persistResolvedAccountSelection(selection, {
			persistSelections,
		}).catch((error) => error as Error & { cause?: unknown });

		expect(wrapped.message).toBe("Failed to persist authenticated account selections.");
		expect(wrapped.message).not.toContain("token-file");
		expect(wrapped.message).not.toContain("acct-123");
		expect(persistSelections).toHaveBeenCalledTimes(1);
	});
});
