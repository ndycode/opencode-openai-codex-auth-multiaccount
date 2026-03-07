import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import { join } from "node:path";
import { findProjectRoot, getProjectStorageKey } from "../lib/storage/paths.js";

vi.mock("node:fs", async () => {
	const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
	return {
		...actual,
		existsSync: vi.fn(),
		readFileSync: vi.fn(),
	};
});

vi.mock("../lib/storage.js", () => ({
	deduplicateAccounts: vi.fn((accounts) => accounts),
	deduplicateAccountsByEmail: vi.fn((accounts) => accounts),
	previewImportAccounts: vi.fn(async () => ({ imported: 2, skipped: 0, total: 4 })),
	importAccounts: vi.fn(async () => ({
		imported: 2,
		skipped: 0,
		total: 4,
		backupStatus: "created",
		backupPath: "/tmp/codex-multi-auth-sync-backup.json",
	})),
	normalizeAccountStorage: vi.fn((value: unknown) => value),
	withAccountStorageTransaction: vi.fn(async (handler) =>
		handler(
			{
				version: 3,
				activeIndex: 0,
				activeIndexByFamily: {},
				accounts: [
					{
						accountId: "org-example123",
						accountIdSource: "org",
						refreshToken: "sync-refresh",
						addedAt: 1,
						lastUsed: 1,
					},
					{
						accountId: "org-example123",
						organizationId: "org-example123",
						accountIdSource: "org",
						refreshToken: "sync-refresh",
						addedAt: 2,
						lastUsed: 2,
					},
				],
			},
			vi.fn(async () => {}),
		),
	),
}));

describe("codex-multi-auth sync", () => {
	const mockExistsSync = vi.mocked(fs.existsSync);
	const mockReadFileSync = vi.mocked(fs.readFileSync);
	const originalEnv = {
		CODEX_MULTI_AUTH_DIR: process.env.CODEX_MULTI_AUTH_DIR,
		CODEX_HOME: process.env.CODEX_HOME,
		USERPROFILE: process.env.USERPROFILE,
		HOME: process.env.HOME,
	};

	beforeEach(() => {
		vi.resetModules();
		vi.clearAllMocks();
		delete process.env.CODEX_MULTI_AUTH_DIR;
		delete process.env.CODEX_HOME;
	});

	afterEach(() => {
		process.env.CODEX_MULTI_AUTH_DIR = originalEnv.CODEX_MULTI_AUTH_DIR;
		process.env.CODEX_HOME = originalEnv.CODEX_HOME;
		process.env.USERPROFILE = originalEnv.USERPROFILE;
		process.env.HOME = originalEnv.HOME;
	});

	it("prefers a project-scoped codex-multi-auth accounts file when present", async () => {
		const rootDir = join(process.cwd(), ".tmp-codex-multi-auth");
		process.env.CODEX_MULTI_AUTH_DIR = rootDir;
		const projectRoot = findProjectRoot(process.cwd()) ?? process.cwd();
		const projectKey = getProjectStorageKey(projectRoot);
		const projectPath = join(rootDir, "projects", projectKey, "openai-codex-accounts.json");
		const globalPath = join(rootDir, "openai-codex-accounts.json");
		const repoPackageJson = join(process.cwd(), "package.json");

		mockExistsSync.mockImplementation((candidate) => {
			return (
				String(candidate) === projectPath ||
				String(candidate) === globalPath ||
				String(candidate) === repoPackageJson
			);
		});

		const { resolveCodexMultiAuthAccountsSource } = await import("../lib/codex-multi-auth-sync.js");
		const resolved = resolveCodexMultiAuthAccountsSource(process.cwd());

		expect(resolved).toEqual({
			rootDir,
			accountsPath: projectPath,
			scope: "project",
		});
	});

	it("falls back to the global accounts file when no project-scoped file exists", async () => {
		const rootDir = join(process.cwd(), ".tmp-codex-multi-auth");
		process.env.CODEX_MULTI_AUTH_DIR = rootDir;
		const globalPath = join(rootDir, "openai-codex-accounts.json");
		mockExistsSync.mockImplementation((candidate) => String(candidate) === globalPath);

		const { resolveCodexMultiAuthAccountsSource } = await import("../lib/codex-multi-auth-sync.js");
		const resolved = resolveCodexMultiAuthAccountsSource(process.cwd());

		expect(resolved).toEqual({
			rootDir,
			accountsPath: globalPath,
			scope: "global",
		});
	});

	it("probes the DevTools fallback root when no env override is set", async () => {
		process.env.USERPROFILE = "C:\\Users\\tester";
		process.env.HOME = "C:\\Users\\tester";
		const devToolsGlobalPath = join(
			"C:\\Users\\tester",
			"DevTools",
			"config",
			"codex",
			"multi-auth",
			"openai-codex-accounts.json",
		);
		mockExistsSync.mockImplementation((candidate) => String(candidate) === devToolsGlobalPath);

		const { getCodexMultiAuthSourceRootDir } = await import("../lib/codex-multi-auth-sync.js");
		expect(getCodexMultiAuthSourceRootDir()).toBe(
			join("C:\\Users\\tester", "DevTools", "config", "codex", "multi-auth"),
		);
	});

	it("skips WAL-only roots when a later candidate has a real accounts file", async () => {
		process.env.USERPROFILE = "C:\\Users\\tester";
		process.env.HOME = "C:\\Users\\tester";
		process.env.CODEX_HOME = "C:\\Users\\tester\\.codex";
		const walOnlyPath = join(
			"C:\\Users\\tester",
			".codex",
			"multi-auth",
			"openai-codex-accounts.json.wal",
		);
		const laterRealJson = join(
			"C:\\Users\\tester",
			"DevTools",
			"config",
			"codex",
			"multi-auth",
			"openai-codex-accounts.json",
		);
		mockExistsSync.mockImplementation((candidate) => {
			const path = String(candidate);
			return path === walOnlyPath || path === laterRealJson;
		});

		const { getCodexMultiAuthSourceRootDir } = await import("../lib/codex-multi-auth-sync.js");
		expect(getCodexMultiAuthSourceRootDir()).toBe(
			join("C:\\Users\\tester", "DevTools", "config", "codex", "multi-auth"),
		);
	});

	it("delegates preview and apply to the existing importer", async () => {
		const rootDir = join(process.cwd(), ".tmp-codex-multi-auth");
		process.env.CODEX_MULTI_AUTH_DIR = rootDir;
		const globalPath = join(rootDir, "openai-codex-accounts.json");
		mockExistsSync.mockImplementation((candidate) => String(candidate) === globalPath);
		mockReadFileSync.mockReturnValue(
			JSON.stringify({
				version: 3,
				activeIndex: 0,
				accounts: [{ refreshToken: "sync-refresh", addedAt: 1, lastUsed: 1 }],
			}),
		);

		const storageModule = await import("../lib/storage.js");
		const { previewSyncFromCodexMultiAuth, syncFromCodexMultiAuth } = await import("../lib/codex-multi-auth-sync.js");

		await expect(previewSyncFromCodexMultiAuth(process.cwd())).resolves.toMatchObject({
			accountsPath: globalPath,
			imported: 2,
			skipped: 0,
			total: 4,
		});
		await expect(syncFromCodexMultiAuth(process.cwd())).resolves.toMatchObject({
			accountsPath: globalPath,
			imported: 2,
			backupStatus: "created",
		});

		expect(vi.mocked(storageModule.previewImportAccounts)).toHaveBeenCalledWith(
			expect.stringContaining("oc-chatgpt-multi-auth-sync-"),
		);
		expect(vi.mocked(storageModule.importAccounts)).toHaveBeenCalledWith(
			expect.stringContaining("oc-chatgpt-multi-auth-sync-"),
			{
				preImportBackupPrefix: "codex-multi-auth-sync-backup",
				backupMode: "required",
			},
		);
	});

	it("normalizes org-scoped source accounts to include organizationId before import", async () => {
		const rootDir = join(process.cwd(), ".tmp-codex-multi-auth");
		process.env.CODEX_MULTI_AUTH_DIR = rootDir;
		const globalPath = join(rootDir, "openai-codex-accounts.json");
		mockExistsSync.mockImplementation((candidate) => String(candidate) === globalPath);
		mockReadFileSync.mockReturnValue(
			JSON.stringify({
				version: 3,
				activeIndex: 0,
				accounts: [
					{
						accountId: "org-example123",
						accountIdSource: "org",
						refreshToken: "sync-refresh",
						addedAt: 1,
						lastUsed: 1,
					},
				],
			}),
		);

		const { loadCodexMultiAuthSourceStorage } = await import("../lib/codex-multi-auth-sync.js");
		const resolved = loadCodexMultiAuthSourceStorage(process.cwd());

		expect(resolved.storage.accounts[0]?.organizationId).toBe("org-example123");
	});

	it("throws for invalid JSON in the external accounts file", async () => {
		const rootDir = join(process.cwd(), ".tmp-codex-multi-auth");
		process.env.CODEX_MULTI_AUTH_DIR = rootDir;
		const globalPath = join(rootDir, "openai-codex-accounts.json");
		mockExistsSync.mockImplementation((candidate) => String(candidate) === globalPath);
		mockReadFileSync.mockReturnValue("not valid json");

		const { loadCodexMultiAuthSourceStorage } = await import("../lib/codex-multi-auth-sync.js");
		expect(() => loadCodexMultiAuthSourceStorage(process.cwd())).toThrow(/Invalid JSON/);
	});

	it("cleans up existing overlaps by normalizing org-scoped identities first", async () => {
		const storageModule = await import("../lib/storage.js");
		vi.mocked(storageModule.normalizeAccountStorage).mockImplementationOnce((value: unknown) => {
			const record = value as {
				version: 3;
				activeIndex: number;
				activeIndexByFamily: Record<string, number>;
				accounts: Array<Record<string, unknown>>;
			};
			return {
				...record,
				accounts: [record.accounts[1]],
			};
		});
		const { cleanupCodexMultiAuthSyncedOverlaps } = await import("../lib/codex-multi-auth-sync.js");
		await expect(cleanupCodexMultiAuthSyncedOverlaps()).resolves.toEqual({
			before: 2,
			after: 1,
			removed: 1,
			updated: 1,
		});
	});

	it("surfaces actionable capacity details when sync would exceed the account limit", async () => {
		const rootDir = join(process.cwd(), ".tmp-codex-multi-auth");
		process.env.CODEX_MULTI_AUTH_DIR = rootDir;
		const globalPath = join(rootDir, "openai-codex-accounts.json");
		mockExistsSync.mockImplementation((candidate) => String(candidate) === globalPath);
		mockReadFileSync.mockReturnValue(
			JSON.stringify({
				version: 3,
				activeIndex: 0,
				activeIndexByFamily: {},
				accounts: [
					{
						accountId: "org-new-1",
						organizationId: "org-new-1",
						accountIdSource: "org",
						email: "new1@example.com",
						refreshToken: "rt-new-1",
						addedAt: 1,
						lastUsed: 1,
					},
					{
						accountId: "org-new-2",
						organizationId: "org-new-2",
						accountIdSource: "org",
						email: "new2@example.com",
						refreshToken: "rt-new-2",
						addedAt: 2,
						lastUsed: 2,
					},
				],
			}),
		);

		const storageModule = await import("../lib/storage.js");
		vi.mocked(storageModule.withAccountStorageTransaction).mockImplementationOnce(async (handler) =>
			handler(
				{
					version: 3,
					activeIndex: 0,
					activeIndexByFamily: {},
					accounts: Array.from({ length: 19 }, (_, index) => ({
						accountId: `org-existing-${index + 1}`,
						organizationId: `org-existing-${index + 1}`,
						accountIdSource: "org",
						email: `existing${index + 1}@example.com`,
						refreshToken: `rt-existing-${index + 1}`,
						addedAt: index + 1,
						lastUsed: index + 1,
					})),
				},
				vi.fn(async () => {}),
			),
		);

		const { CodexMultiAuthSyncCapacityError, previewSyncFromCodexMultiAuth } = await import(
			"../lib/codex-multi-auth-sync.js"
		);

		try {
			await previewSyncFromCodexMultiAuth(process.cwd());
			throw new Error("Expected previewSyncFromCodexMultiAuth to reject");
		} catch (error) {
			expect(error).toBeInstanceOf(CodexMultiAuthSyncCapacityError);
			expect(error).toMatchObject({
				name: "CodexMultiAuthSyncCapacityError",
			});
			const details = (error as InstanceType<typeof CodexMultiAuthSyncCapacityError>).details;
			expect(details).toMatchObject({
				accountsPath: globalPath,
				currentCount: 19,
				sourceCount: 2,
				dedupedTotal: 21,
				maxAccounts: 20,
				needToRemove: 1,
				importableNewAccounts: 2,
				skippedOverlaps: 0,
			});
			expect(details.suggestedRemovals[0]).toMatchObject({
				index: 1,
				score: expect.any(Number),
				reason: expect.stringContaining("not present in codex-multi-auth source"),
			});
		}
	});

	it("prioritizes removals that actually reduce merged capacity over same-email matches", async () => {
		const rootDir = join(process.cwd(), ".tmp-codex-multi-auth");
		process.env.CODEX_MULTI_AUTH_DIR = rootDir;
		const globalPath = join(rootDir, "openai-codex-accounts.json");
		mockExistsSync.mockImplementation((candidate) => String(candidate) === globalPath);
		const makeOverlap = (suffix: string, lastUsed: number) => ({
			accountId: `org-${suffix}`,
			organizationId: `org-${suffix}`,
			accountIdSource: "org" as const,
			email: `${suffix}@example.com`,
			refreshToken: `rt-${suffix}`,
			addedAt: lastUsed,
			lastUsed,
		});
		const sharedPrimary = {
			accountId: "org-shared-primary",
			organizationId: "org-shared-primary",
			accountIdSource: "org" as const,
			email: "shared@example.com",
			refreshToken: "rt-shared-primary",
			addedAt: 1,
			lastUsed: 1,
		};
		const sharedSecondary = {
			accountId: "org-shared-secondary",
			organizationId: "org-shared-secondary",
			accountIdSource: "org" as const,
			email: "shared@example.com",
			refreshToken: "rt-shared-secondary",
			addedAt: 2,
			lastUsed: 2,
		};
		const overlapAccounts = Array.from({ length: 18 }, (_, index) =>
			makeOverlap(`overlap-${index + 1}`, 10 + index),
		);
		const sourceStorage = {
			version: 3,
			activeIndex: 0,
			activeIndexByFamily: {},
			accounts: [
				sharedPrimary,
				...overlapAccounts,
				{
					accountId: "org-source-only",
					organizationId: "org-source-only",
					accountIdSource: "org" as const,
					email: "source-only@example.com",
					refreshToken: "rt-source-only",
					addedAt: 100,
					lastUsed: 100,
				},
			],
		};
		mockReadFileSync.mockReturnValue(JSON.stringify(sourceStorage));

		const storageModule = await import("../lib/storage.js");
		vi.mocked(storageModule.withAccountStorageTransaction).mockImplementationOnce(async (handler) =>
			handler(
				{
					version: 3,
					activeIndex: 0,
					activeIndexByFamily: {},
					accounts: [
						sharedPrimary,
						sharedSecondary,
						...overlapAccounts,
					],
				},
				vi.fn(async () => {}),
			),
		);

		const { CodexMultiAuthSyncCapacityError, previewSyncFromCodexMultiAuth } = await import(
			"../lib/codex-multi-auth-sync.js"
		);

		try {
			await previewSyncFromCodexMultiAuth(process.cwd());
			throw new Error("Expected previewSyncFromCodexMultiAuth to reject");
		} catch (error) {
			expect(error).toBeInstanceOf(CodexMultiAuthSyncCapacityError);
			const details = (error as InstanceType<typeof CodexMultiAuthSyncCapacityError>).details;
			expect(details.suggestedRemovals[0]).toMatchObject({
				index: 1,
				reason: expect.stringContaining("frees 1 sync slot"),
			});
		}
	});
});
