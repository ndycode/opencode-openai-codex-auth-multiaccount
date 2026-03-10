import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import { join } from "node:path";
import { findProjectRoot, getProjectStorageKey, getProjectStorageKeyCandidates } from "../lib/storage/paths.js";
import type { AccountStorageV3 } from "../lib/storage.js";

vi.mock("../lib/logger.js", () => ({
	logWarn: vi.fn(),
}));

vi.mock("node:fs", async () => {
	const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
	return {
		...actual,
		existsSync: vi.fn(),
		readdirSync: vi.fn(() => []),
		readFileSync: vi.fn(),
		statSync: vi.fn(),
	};
});

vi.mock("../lib/storage.js", () => ({
	deduplicateAccounts: vi.fn((accounts) => accounts),
	deduplicateAccountsByEmail: vi.fn((accounts) => accounts),
	getStoragePath: vi.fn(() => "/tmp/opencode-accounts.json"),
	loadAccounts: vi.fn(async () => ({
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
	})),
	saveAccounts: vi.fn(async () => {}),
	clearAccounts: vi.fn(async () => {}),
	previewImportAccounts: vi.fn(async () => ({ imported: 2, skipped: 0, total: 4 })),
	previewImportAccountsWithExistingStorage: vi.fn(async () => ({ imported: 2, skipped: 0, total: 4 })),
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
	const mockReaddirSync = vi.mocked(fs.readdirSync);
	const mockReadFileSync = vi.mocked(fs.readFileSync);
	const mockStatSync = vi.mocked(fs.statSync);
	const originalReadFile = fs.promises.readFile.bind(fs.promises);
	const mockReadFile = vi.spyOn(fs.promises, "readFile");
	const originalEnv = {
		CODEX_MULTI_AUTH_DIR: process.env.CODEX_MULTI_AUTH_DIR,
		CODEX_HOME: process.env.CODEX_HOME,
		USERPROFILE: process.env.USERPROFILE,
		HOME: process.env.HOME,
	};
	const mockSourceStorageFile = (expectedPath: string, content: string) => {
		mockReadFile.mockImplementation(async (filePath, options) => {
			if (String(filePath) === expectedPath) {
				return content;
			}
			return originalReadFile(
				filePath as Parameters<typeof fs.promises.readFile>[0],
				options as never,
			);
		});
	};
	const defaultTransactionalStorage = (): AccountStorageV3 => ({
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
	});

	beforeEach(async () => {
		vi.resetModules();
		vi.clearAllMocks();
		mockExistsSync.mockReset();
		mockExistsSync.mockReturnValue(false);
		mockReaddirSync.mockReset();
		mockReaddirSync.mockReturnValue([] as ReturnType<typeof fs.readdirSync>);
		mockReadFileSync.mockReset();
		mockReadFileSync.mockImplementation((candidate) => {
			throw new Error(`unexpected read: ${String(candidate)}`);
		});
		mockStatSync.mockReset();
		mockStatSync.mockImplementation(() => ({
			isDirectory: () => false,
		}) as ReturnType<typeof fs.statSync>);
		mockReadFile.mockReset();
		mockReadFile.mockImplementation((path, options) =>
			originalReadFile(path as Parameters<typeof fs.promises.readFile>[0], options as never),
		);
		const storageModule = await import("../lib/storage.js");
		vi.mocked(storageModule.previewImportAccounts).mockReset();
		vi.mocked(storageModule.previewImportAccounts).mockResolvedValue({ imported: 2, skipped: 0, total: 4 });
		vi.mocked(storageModule.previewImportAccountsWithExistingStorage).mockReset();
		vi.mocked(storageModule.previewImportAccountsWithExistingStorage).mockResolvedValue({
			imported: 2,
			skipped: 0,
			total: 4,
		});
		vi.mocked(storageModule.importAccounts).mockReset();
		vi.mocked(storageModule.importAccounts).mockResolvedValue({
			imported: 2,
			skipped: 0,
			total: 4,
			backupStatus: "created",
			backupPath: "/tmp/codex-multi-auth-sync-backup.json",
		});
		vi.mocked(storageModule.loadAccounts).mockReset();
		vi.mocked(storageModule.loadAccounts).mockResolvedValue(defaultTransactionalStorage());
		vi.mocked(storageModule.normalizeAccountStorage).mockReset();
		vi.mocked(storageModule.normalizeAccountStorage).mockImplementation((value: unknown) => value as never);
		vi.mocked(storageModule.withAccountStorageTransaction).mockReset();
		vi.mocked(storageModule.withAccountStorageTransaction).mockImplementation(async (handler) =>
			handler(defaultTransactionalStorage(), vi.fn(async () => {})),
		);
		delete process.env.CODEX_MULTI_AUTH_DIR;
		delete process.env.CODEX_HOME;
	});

	afterEach(() => {
		if (originalEnv.CODEX_MULTI_AUTH_DIR === undefined) delete process.env.CODEX_MULTI_AUTH_DIR;
		else process.env.CODEX_MULTI_AUTH_DIR = originalEnv.CODEX_MULTI_AUTH_DIR;
		if (originalEnv.CODEX_HOME === undefined) delete process.env.CODEX_HOME;
		else process.env.CODEX_HOME = originalEnv.CODEX_HOME;
		if (originalEnv.USERPROFILE === undefined) delete process.env.USERPROFILE;
		else process.env.USERPROFILE = originalEnv.USERPROFILE;
		if (originalEnv.HOME === undefined) delete process.env.HOME;
		else process.env.HOME = originalEnv.HOME;
		delete process.env.CODEX_AUTH_SYNC_MAX_ACCOUNTS;
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

	it("prefers the DevTools root over ~/.codex when CODEX_HOME is not set", async () => {
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
		const dotCodexGlobalPath = join(
			"C:\\Users\\tester",
			".codex",
			"multi-auth",
			"openai-codex-accounts.json",
		);
		mockExistsSync.mockImplementation((candidate) => {
			const path = String(candidate);
			return path === devToolsGlobalPath || path === dotCodexGlobalPath;
		});

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
		mockSourceStorageFile(globalPath, 
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

		expect(vi.mocked(storageModule.previewImportAccountsWithExistingStorage)).toHaveBeenCalledWith(
			expect.stringContaining("oc-chatgpt-multi-auth-sync-"),
			expect.any(Object),
		);
		expect(vi.mocked(storageModule.importAccounts)).toHaveBeenCalledWith(
			expect.stringContaining("oc-chatgpt-multi-auth-sync-"),
			{
				preImportBackupPrefix: "codex-multi-auth-sync-backup",
				backupMode: "required",
			},
			expect.any(Function),
		);
	});

	it("rejects CODEX_MULTI_AUTH_DIR values that are not local absolute paths on Windows", async () => {
		process.env.CODEX_MULTI_AUTH_DIR = "\\\\server\\share\\multi-auth";
		process.env.USERPROFILE = "C:\\Users\\tester";
		process.env.HOME = "C:\\Users\\tester";

		const { getCodexMultiAuthSourceRootDir } = await import("../lib/codex-multi-auth-sync.js");
		expect(() => getCodexMultiAuthSourceRootDir()).toThrow(/local absolute path/i);
	});

	it("accepts extended-length local Windows paths for CODEX_MULTI_AUTH_DIR", async () => {
		process.env.USERPROFILE = "C:\\Users\\tester";
		process.env.HOME = "C:\\Users\\tester";

		const { getCodexMultiAuthSourceRootDir } = await import("../lib/codex-multi-auth-sync.js");

		process.env.CODEX_MULTI_AUTH_DIR = "\\\\?\\C:\\Users\\tester\\multi-auth";
		expect(getCodexMultiAuthSourceRootDir()).toBe("\\\\?\\C:\\Users\\tester\\multi-auth");

		process.env.CODEX_MULTI_AUTH_DIR = "\\\\.\\C:\\Users\\tester\\multi-auth";
		expect(getCodexMultiAuthSourceRootDir()).toBe("\\\\.\\C:\\Users\\tester\\multi-auth");
	});

	it("rejects extended UNC Windows paths for CODEX_MULTI_AUTH_DIR", async () => {
		process.env.CODEX_MULTI_AUTH_DIR = "\\\\?\\UNC\\server\\share\\multi-auth";
		process.env.USERPROFILE = "C:\\Users\\tester";
		process.env.HOME = "C:\\Users\\tester";

		const { getCodexMultiAuthSourceRootDir } = await import("../lib/codex-multi-auth-sync.js");
		expect(() => getCodexMultiAuthSourceRootDir()).toThrow(/UNC network share/i);
	});

	it("keeps preview sync on the read-only path without the storage transaction lock", async () => {
		const rootDir = join(process.cwd(), ".tmp-codex-multi-auth");
		process.env.CODEX_MULTI_AUTH_DIR = rootDir;
		const globalPath = join(rootDir, "openai-codex-accounts.json");
		mockExistsSync.mockImplementation((candidate) => String(candidate) === globalPath);
		mockSourceStorageFile(
			globalPath,
			JSON.stringify({
				version: 3,
				activeIndex: 0,
				activeIndexByFamily: {},
				accounts: [{ refreshToken: "sync-refresh", addedAt: 1, lastUsed: 1 }],
			}),
		);

		const storageModule = await import("../lib/storage.js");
		vi.mocked(storageModule.withAccountStorageTransaction).mockImplementationOnce(async () => {
			throw new Error("preview should not take write transaction lock");
		});

		const { previewSyncFromCodexMultiAuth } = await import("../lib/codex-multi-auth-sync.js");
		await expect(previewSyncFromCodexMultiAuth(process.cwd())).resolves.toMatchObject({
			accountsPath: globalPath,
			imported: 2,
		});
	});

	it("takes the same transaction-backed path for overlap cleanup preview as cleanup", async () => {
		const storageModule = await import("../lib/storage.js");
		vi.mocked(storageModule.withAccountStorageTransaction).mockImplementationOnce(async (handler) =>
			handler(
				{
					version: 3,
					activeIndex: 0,
					activeIndexByFamily: {},
					accounts: [
						{
							accountId: "org-sync",
							organizationId: "org-sync",
							accountIdSource: "org",
							accountTags: ["codex-multi-auth-sync"],
							refreshToken: "sync-token",
							addedAt: 2,
							lastUsed: 2,
						},
					],
				},
				vi.fn(async () => {}),
			),
		);
		vi.mocked(storageModule.loadAccounts).mockResolvedValue({
			version: 3,
			activeIndex: 0,
			activeIndexByFamily: {},
			accounts: [
				{
					accountId: "org-sync",
					organizationId: "org-sync",
					accountIdSource: "org",
					accountTags: ["codex-multi-auth-sync"],
					refreshToken: "sync-token",
					addedAt: 2,
					lastUsed: 2,
				},
			],
		});

		const { previewCodexMultiAuthSyncedOverlapCleanup } = await import("../lib/codex-multi-auth-sync.js");
		await expect(previewCodexMultiAuthSyncedOverlapCleanup()).resolves.toEqual({
			before: 1,
			after: 1,
			removed: 0,
			updated: 0,
		});
		expect(storageModule.withAccountStorageTransaction).toHaveBeenCalledTimes(1);
		expect(storageModule.loadAccounts).not.toHaveBeenCalled();
	});

	it("uses a single account snapshot for preview capacity filtering and preview counts", async () => {
		const rootDir = join(process.cwd(), ".tmp-codex-multi-auth");
		process.env.CODEX_MULTI_AUTH_DIR = rootDir;
		const globalPath = join(rootDir, "openai-codex-accounts.json");
		mockExistsSync.mockImplementation((candidate) => String(candidate) === globalPath);
		mockSourceStorageFile(
			globalPath,
			JSON.stringify({
				version: 3,
				activeIndex: 0,
				activeIndexByFamily: {},
				accounts: [
					{ email: "existing@example.com", refreshToken: "rt-source-1", addedAt: 1, lastUsed: 1 },
					{ email: "new@example.com", refreshToken: "rt-source-2", addedAt: 2, lastUsed: 2 },
				],
			}),
		);

		const storageModule = await import("../lib/storage.js");
		const firstSnapshot = {
			version: 3 as const,
			activeIndex: 0,
			activeIndexByFamily: {},
			accounts: [
				{
					email: "existing@example.com",
					refreshToken: "rt-existing",
					addedAt: 10,
					lastUsed: 10,
				},
			],
		};
		const secondSnapshot = {
			version: 3 as const,
			activeIndex: 0,
			activeIndexByFamily: {},
			accounts: [],
		};
		vi.mocked(storageModule.loadAccounts)
			.mockResolvedValueOnce(firstSnapshot)
			.mockResolvedValueOnce(secondSnapshot);
		vi.mocked(storageModule.previewImportAccountsWithExistingStorage).mockImplementationOnce(async (_filePath, existing) => {
			expect(existing).toBe(firstSnapshot);
			return { imported: 1, skipped: 0, total: 2 };
		});

		const { previewSyncFromCodexMultiAuth } = await import("../lib/codex-multi-auth-sync.js");
		await expect(previewSyncFromCodexMultiAuth(process.cwd())).resolves.toMatchObject({
			accountsPath: globalPath,
			imported: 1,
			total: 2,
		});
		expect(vi.mocked(storageModule.loadAccounts)).toHaveBeenCalledTimes(1);
	});

	it("reuses a previewed source snapshot during sync even if the source file changes later", async () => {
		const rootDir = join(process.cwd(), ".tmp-codex-multi-auth");
		process.env.CODEX_MULTI_AUTH_DIR = rootDir;
		const globalPath = join(rootDir, "openai-codex-accounts.json");
		mockExistsSync.mockImplementation((candidate) => String(candidate) === globalPath);
		mockSourceStorageFile(
			globalPath,
			JSON.stringify({
				version: 3,
				activeIndex: 0,
				activeIndexByFamily: {},
				accounts: [
					{ accountId: "org-source-1", organizationId: "org-source-1", accountIdSource: "org", refreshToken: "rt-source-1", addedAt: 1, lastUsed: 1 },
				],
			}),
		);

		const storageModule = await import("../lib/storage.js");
		const syncModule = await import("../lib/codex-multi-auth-sync.js");
		const loadedSource = await syncModule.loadCodexMultiAuthSourceStorage(process.cwd());

		mockSourceStorageFile(
			globalPath,
			JSON.stringify({
				version: 3,
				activeIndex: 0,
				activeIndexByFamily: {},
				accounts: [
					{ accountId: "org-source-1", organizationId: "org-source-1", accountIdSource: "org", refreshToken: "rt-source-1", addedAt: 1, lastUsed: 1 },
					{ accountId: "org-source-2", organizationId: "org-source-2", accountIdSource: "org", refreshToken: "rt-source-2", addedAt: 2, lastUsed: 2 },
				],
			}),
		);

		vi.mocked(storageModule.previewImportAccountsWithExistingStorage).mockImplementationOnce(async (filePath) => {
			const raw = await fs.promises.readFile(filePath, "utf8");
			const parsed = JSON.parse(raw) as { accounts: Array<{ refreshToken?: string }> };
			expect(parsed.accounts).toHaveLength(1);
			expect(parsed.accounts[0]?.refreshToken).toBe("rt-source-1");
			return { imported: 1, skipped: 0, total: 1 };
		});
		vi.mocked(storageModule.importAccounts).mockImplementationOnce(async (filePath) => {
			const raw = await fs.promises.readFile(filePath, "utf8");
			const parsed = JSON.parse(raw) as { accounts: Array<{ refreshToken?: string }> };
			expect(parsed.accounts).toHaveLength(1);
			expect(parsed.accounts[0]?.refreshToken).toBe("rt-source-1");
			return {
				imported: 1,
				skipped: 0,
				total: 1,
				backupStatus: "created",
				backupPath: "/tmp/codex-multi-auth-sync-backup.json",
			};
		});

		await expect(syncModule.previewSyncFromCodexMultiAuth(process.cwd(), loadedSource)).resolves.toMatchObject({
			accountsPath: globalPath,
			imported: 1,
			total: 1,
		});
		await expect(syncModule.syncFromCodexMultiAuth(process.cwd(), loadedSource)).resolves.toMatchObject({
			accountsPath: globalPath,
			imported: 1,
			backupStatus: "created",
		});
	});

	it("uses the same locked raw storage snapshot for overlap preview as cleanup", async () => {
		const storageModule = await import("../lib/storage.js");
		vi.mocked(storageModule.loadAccounts).mockResolvedValueOnce({
			version: 3,
			activeIndex: 0,
			activeIndexByFamily: {},
			accounts: [],
		});
		vi.mocked(storageModule.withAccountStorageTransaction).mockImplementationOnce(async (handler) =>
			handler(
				{
					version: 3,
					activeIndex: 0,
					activeIndexByFamily: {},
					accounts: [],
				},
				vi.fn(async () => {}),
			),
		);
		mockSourceStorageFile(
			"/tmp/opencode-accounts.json",
			JSON.stringify({
				version: 3,
				activeIndex: 0,
				activeIndexByFamily: {},
				accounts: [
					{
						accountId: "org-sync",
						organizationId: "org-sync",
						accountIdSource: "org",
						accountTags: ["codex-multi-auth-sync"],
						email: "sync@example.com",
						refreshToken: "sync-token",
						addedAt: 2,
						lastUsed: 2,
					},
					{
						accountId: "org-sync",
						accountIdSource: "org",
						email: "sync@example.com",
						refreshToken: "sync-token",
						addedAt: 1,
						lastUsed: 1,
					},
				],
			}),
		);

		const { previewCodexMultiAuthSyncedOverlapCleanup } = await import("../lib/codex-multi-auth-sync.js");
		await expect(previewCodexMultiAuthSyncedOverlapCleanup()).resolves.toEqual({
			before: 2,
			after: 1,
			removed: 1,
			updated: 0,
		});
		expect(storageModule.withAccountStorageTransaction).toHaveBeenCalledTimes(1);
		expect(storageModule.loadAccounts).not.toHaveBeenCalled();
	});

	it("does not retry through a fallback temp directory when the handler throws", async () => {
		const rootDir = join(process.cwd(), ".tmp-codex-multi-auth");
		process.env.CODEX_MULTI_AUTH_DIR = rootDir;
		const globalPath = join(rootDir, "openai-codex-accounts.json");
		mockExistsSync.mockImplementation((candidate) => String(candidate) === globalPath);
		mockSourceStorageFile(globalPath, 
			JSON.stringify({
				version: 3,
				activeIndex: 0,
				accounts: [{ refreshToken: "sync-refresh", addedAt: 1, lastUsed: 1 }],
			}),
		);

		const storageModule = await import("../lib/storage.js");
		vi.mocked(storageModule.previewImportAccountsWithExistingStorage).mockRejectedValueOnce(
			new Error("preview failed"),
		);

		const { previewSyncFromCodexMultiAuth } = await import("../lib/codex-multi-auth-sync.js");
		await expect(previewSyncFromCodexMultiAuth(process.cwd())).rejects.toThrow("preview failed");
		expect(vi.mocked(storageModule.previewImportAccountsWithExistingStorage)).toHaveBeenCalledTimes(1);
	});

	it("surfaces secure temp directory creation failures instead of falling back to system tmpdir", async () => {
		const rootDir = join(process.cwd(), ".tmp-codex-multi-auth");
		process.env.CODEX_MULTI_AUTH_DIR = rootDir;
		const globalPath = join(rootDir, "openai-codex-accounts.json");
		mockExistsSync.mockImplementation((candidate) => String(candidate) === globalPath);
		mockSourceStorageFile(globalPath, 
			JSON.stringify({
				version: 3,
				activeIndex: 0,
				accounts: [{ refreshToken: "sync-refresh", addedAt: 1, lastUsed: 1 }],
			}),
		);

		const mkdtempSpy = vi.spyOn(fs.promises, "mkdtemp").mockRejectedValue(new Error("mkdtemp failed"));
		const storageModule = await import("../lib/storage.js");

		try {
			const { previewSyncFromCodexMultiAuth } = await import("../lib/codex-multi-auth-sync.js");
			await expect(previewSyncFromCodexMultiAuth(process.cwd())).rejects.toThrow("mkdtemp failed");
			expect(mkdtempSpy).toHaveBeenCalledTimes(1);
			expect(vi.mocked(storageModule.previewImportAccountsWithExistingStorage)).not.toHaveBeenCalled();
		} finally {
			mkdtempSpy.mockRestore();
		}
	});

	it("warns instead of failing when secure temp cleanup blocks preview cleanup", async () => {
		const rootDir = join(process.cwd(), ".tmp-codex-multi-auth");
		process.env.CODEX_MULTI_AUTH_DIR = rootDir;
		const globalPath = join(rootDir, "openai-codex-accounts.json");
		mockExistsSync.mockImplementation((candidate) => String(candidate) === globalPath);
		mockSourceStorageFile(globalPath, 
			JSON.stringify({
				version: 3,
				activeIndex: 0,
				accounts: [{ refreshToken: "sync-refresh", addedAt: 1, lastUsed: 1 }],
			}),
		);

		const rmSpy = vi.spyOn(fs.promises, "rm").mockRejectedValue(new Error("cleanup blocked"));
		const loggerModule = await import("../lib/logger.js");

		try {
			const { previewSyncFromCodexMultiAuth } = await import("../lib/codex-multi-auth-sync.js");
			await expect(previewSyncFromCodexMultiAuth(process.cwd())).resolves.toMatchObject({
				accountsPath: globalPath,
				imported: 2,
				skipped: 0,
				total: 4,
			});
			expect(vi.mocked(loggerModule.logWarn)).toHaveBeenCalledWith(
				expect.stringContaining("Failed to remove temporary codex sync directory"),
			);
		} finally {
			rmSpy.mockRestore();
		}
	});

	it.each(["EACCES", "EPERM"] as const)(
		"retries Windows-style %s temp cleanup locks until they clear",
		async (code) => {
			const rootDir = join(process.cwd(), ".tmp-codex-multi-auth");
			process.env.CODEX_MULTI_AUTH_DIR = rootDir;
			const globalPath = join(rootDir, "openai-codex-accounts.json");
			mockExistsSync.mockImplementation((candidate) => String(candidate) === globalPath);
			mockSourceStorageFile(
				globalPath,
				JSON.stringify({
					version: 3,
					activeIndex: 0,
					activeIndexByFamily: {},
					accounts: [{ refreshToken: "sync-refresh", addedAt: 1, lastUsed: 1 }],
				}),
			);

			const rmSpy = vi
				.spyOn(fs.promises, "rm")
				.mockRejectedValueOnce(Object.assign(new Error("permission denied"), { code }))
				.mockRejectedValueOnce(Object.assign(new Error("permission denied"), { code }))
				.mockResolvedValueOnce(undefined);
			const loggerModule = await import("../lib/logger.js");

			try {
				const { previewSyncFromCodexMultiAuth } = await import("../lib/codex-multi-auth-sync.js");
				await expect(previewSyncFromCodexMultiAuth(process.cwd())).resolves.toMatchObject({
					accountsPath: globalPath,
					imported: 2,
					skipped: 0,
					total: 4,
				});
				expect(rmSpy).toHaveBeenCalledTimes(3);
				expect(vi.mocked(loggerModule.logWarn)).not.toHaveBeenCalledWith(
					expect.stringContaining("Failed to remove temporary codex sync directory"),
				);
			} finally {
				rmSpy.mockRestore();
			}
		},
	);

	it("fails fast on non-retryable temp cleanup errors", async () => {
		const rootDir = join(process.cwd(), ".tmp-codex-multi-auth");
		process.env.CODEX_MULTI_AUTH_DIR = rootDir;
		const globalPath = join(rootDir, "openai-codex-accounts.json");
		mockExistsSync.mockImplementation((candidate) => String(candidate) === globalPath);
		mockSourceStorageFile(
			globalPath,
			JSON.stringify({
				version: 3,
				activeIndex: 0,
				activeIndexByFamily: {},
				accounts: [{ refreshToken: "sync-refresh", addedAt: 1, lastUsed: 1 }],
			}),
		);

		const rmSpy = vi
			.spyOn(fs.promises, "rm")
			.mockRejectedValue(Object.assign(new Error("invalid temp dir"), { code: "EINVAL" }));
		const loggerModule = await import("../lib/logger.js");

		try {
			const { previewSyncFromCodexMultiAuth } = await import("../lib/codex-multi-auth-sync.js");
			await expect(previewSyncFromCodexMultiAuth(process.cwd())).resolves.toMatchObject({
				accountsPath: globalPath,
				imported: 2,
				skipped: 0,
				total: 4,
			});
			expect(rmSpy.mock.calls.length).toBeGreaterThanOrEqual(1);
			expect(vi.mocked(loggerModule.logWarn)).toHaveBeenCalledWith(
				expect.stringContaining("Failed to remove temporary codex sync directory"),
			);
		} finally {
			rmSpy.mockRestore();
		}
	});

	it("retries Windows-style EBUSY temp cleanup until it succeeds", async () => {
		const rootDir = join(process.cwd(), ".tmp-codex-multi-auth");
		process.env.CODEX_MULTI_AUTH_DIR = rootDir;
		const globalPath = join(rootDir, "openai-codex-accounts.json");
		mockExistsSync.mockImplementation((candidate) => String(candidate) === globalPath);
		mockSourceStorageFile(
			globalPath,
			JSON.stringify({
				version: 3,
				activeIndex: 0,
				activeIndexByFamily: {},
				accounts: [{ refreshToken: "sync-refresh", addedAt: 1, lastUsed: 1 }],
			}),
		);

		const rmSpy = vi
			.spyOn(fs.promises, "rm")
			.mockRejectedValueOnce(Object.assign(new Error("busy"), { code: "EBUSY" }))
			.mockRejectedValueOnce(Object.assign(new Error("busy"), { code: "EBUSY" }))
			.mockResolvedValueOnce(undefined);
		const loggerModule = await import("../lib/logger.js");

		try {
			const { previewSyncFromCodexMultiAuth } = await import("../lib/codex-multi-auth-sync.js");
			await expect(previewSyncFromCodexMultiAuth(process.cwd())).resolves.toMatchObject({
				accountsPath: globalPath,
				imported: 2,
				skipped: 0,
				total: 4,
			});
			expect(rmSpy).toHaveBeenCalledTimes(3);
			expect(vi.mocked(loggerModule.logWarn)).not.toHaveBeenCalledWith(
				expect.stringContaining("Failed to remove temporary codex sync directory"),
			);
		} finally {
			rmSpy.mockRestore();
		}
	});

	it.each(["EACCES", "EPERM", "EBUSY"] as const)(
		"redacts temp tokens before warning when Windows-style %s cleanup exhausts retries",
		async (code) => {
			const rootDir = join(process.cwd(), ".tmp-codex-multi-auth");
			const fakeHome = await fs.promises.mkdtemp(join(os.tmpdir(), "codex-sync-home-"));
			process.env.CODEX_MULTI_AUTH_DIR = rootDir;
			process.env.HOME = fakeHome;
			process.env.USERPROFILE = fakeHome;
			const globalPath = join(rootDir, "openai-codex-accounts.json");
			const tempRoot = join(fakeHome, ".opencode", "tmp");
			mockExistsSync.mockImplementation((candidate) => String(candidate) === globalPath);
			mockSourceStorageFile(
				globalPath,
				JSON.stringify({
					version: 3,
					activeIndex: 0,
					activeIndexByFamily: {},
					accounts: [
						{
							refreshToken: "sync-refresh-secret",
							accessToken: "sync-access-secret",
							idToken: "sync-id-secret",
							addedAt: 1,
							lastUsed: 1,
						},
					],
				}),
			);

			const rmSpy = vi
				.spyOn(fs.promises, "rm")
				.mockRejectedValue(Object.assign(new Error("cleanup still locked"), { code }));
			const loggerModule = await import("../lib/logger.js");

			try {
				const { previewSyncFromCodexMultiAuth } = await import("../lib/codex-multi-auth-sync.js");
				await expect(previewSyncFromCodexMultiAuth(process.cwd())).resolves.toMatchObject({
					accountsPath: globalPath,
					imported: 2,
					skipped: 0,
					total: 4,
				});
				expect(rmSpy).toHaveBeenCalledTimes(4);
				expect(vi.mocked(loggerModule.logWarn)).toHaveBeenCalledWith(
					expect.stringContaining("Failed to remove temporary codex sync directory"),
				);

				const tempEntries = await fs.promises.readdir(tempRoot, { withFileTypes: true });
				const syncDir = tempEntries.find(
					(entry) => entry.isDirectory() && entry.name.startsWith("oc-chatgpt-multi-auth-sync-"),
				);
				expect(syncDir).toBeDefined();
				const leakedTempPath = join(tempRoot, syncDir!.name, "accounts.json");
				const leakedContent = await fs.promises.readFile(leakedTempPath, "utf8");
				expect(leakedContent).not.toContain("sync-refresh-secret");
				expect(leakedContent).not.toContain("sync-access-secret");
				expect(leakedContent).not.toContain("sync-id-secret");
				expect(leakedContent).toContain("__redacted__");
			} finally {
				rmSpy.mockRestore();
				await fs.promises.rm(fakeHome, { recursive: true, force: true });
			}
		},
	);

	it("finds the project-scoped codex-multi-auth source across same-repo worktrees", async () => {
		const rootDir = join(process.cwd(), ".tmp-codex-multi-auth");
		process.env.CODEX_MULTI_AUTH_DIR = rootDir;
		const mainWorktree = "C:\\Users\\neil\\DevTools\\oc-chatgpt-multi-auth";
		const branchWorktree = "C:\\Users\\neil\\DevTools\\oc-chatgpt-multi-auth-sync-worktree";
		const sharedGitFile = "gitdir: C:/Users/neil/DevTools/oc-chatgpt-multi-auth/.git/worktrees/feature-sync\n";
		const mainGitPath = join(mainWorktree, ".git");
		const branchGitPath = join(branchWorktree, ".git");
		let projectPath = "";

		mockExistsSync.mockImplementation((candidate) => {
			return (
				String(candidate) === projectPath ||
				String(candidate) === mainGitPath ||
				String(candidate) === branchGitPath
			);
		});
		vi.mocked(fs.statSync).mockImplementation((candidate) => {
			return {
				isDirectory: () => String(candidate) === mainGitPath,
			} as ReturnType<typeof fs.statSync>;
		});
		vi.mocked(fs.readFileSync).mockImplementation((candidate) => {
			if (String(candidate) === branchGitPath) {
				return sharedGitFile;
			}
			throw new Error(`unexpected read: ${String(candidate)}`);
		});
		const sharedProjectKey = getProjectStorageKeyCandidates(mainWorktree)[0];
		projectPath = join(rootDir, "projects", sharedProjectKey ?? "missing", "openai-codex-accounts.json");

		const { resolveCodexMultiAuthAccountsSource } = await import("../lib/codex-multi-auth-sync.js");
		const resolved = resolveCodexMultiAuthAccountsSource(branchWorktree);
		expect(resolved).toEqual({
			rootDir,
			accountsPath: projectPath,
			scope: "project",
		});
	});

	it("prefers a later root with project-scoped accounts over an earlier settings-only root", async () => {
		process.env.USERPROFILE = "C:\\Users\\tester";
		process.env.HOME = "C:\\Users\\tester";
		const projectRoot = findProjectRoot(process.cwd()) ?? process.cwd();
		const candidateKey = getProjectStorageKeyCandidates(projectRoot)[0] ?? "missing";
		const firstRootSettings = join("C:\\Users\\tester", "DevTools", "config", "codex", "multi-auth", "settings.json");
		const secondProjectsDir = join("C:\\Users\\tester", ".codex", "multi-auth", "projects");
		const repoPackageJson = join(process.cwd(), "package.json");
		const secondProjectPath = join(
			"C:\\Users\\tester",
			".codex",
			"multi-auth",
			"projects",
			candidateKey,
			"openai-codex-accounts.json",
		);
		mockExistsSync.mockImplementation((candidate) => {
			const pathValue = String(candidate);
			return pathValue === firstRootSettings || pathValue === secondProjectPath || pathValue === repoPackageJson;
		});
		mockReaddirSync.mockImplementation((candidate) => {
			if (String(candidate) === secondProjectsDir) {
				return [
					{
						name: candidateKey,
						isDirectory: () => true,
					},
				] as unknown as ReturnType<typeof fs.readdirSync>;
			}
			return [];
		});

		const { getCodexMultiAuthSourceRootDir, resolveCodexMultiAuthAccountsSource } =
			await import("../lib/codex-multi-auth-sync.js");
		expect(getCodexMultiAuthSourceRootDir()).toBe(join("C:\\Users\\tester", ".codex", "multi-auth"));
		const resolved = resolveCodexMultiAuthAccountsSource(process.cwd());
		expect(resolved).toEqual({
			rootDir: join("C:\\Users\\tester", ".codex", "multi-auth"),
			accountsPath: secondProjectPath,
			scope: "project",
		});
	});

	it("warns and returns preview results when secure temp cleanup leaves sync data on disk", async () => {
		const rootDir = join(process.cwd(), ".tmp-codex-multi-auth");
		process.env.CODEX_MULTI_AUTH_DIR = rootDir;
		const globalPath = join(rootDir, "openai-codex-accounts.json");
		mockExistsSync.mockImplementation((candidate) => String(candidate) === globalPath);
		mockSourceStorageFile(
			globalPath,
			JSON.stringify({
				version: 3,
				activeIndex: 0,
				accounts: [{ refreshToken: "sync-refresh", addedAt: 1, lastUsed: 1 }],
			}),
		);

		const rmSpy = vi.spyOn(fs.promises, "rm").mockRejectedValue(new Error("cleanup blocked"));

		try {
			const { previewSyncFromCodexMultiAuth } = await import("../lib/codex-multi-auth-sync.js");
			await expect(previewSyncFromCodexMultiAuth(process.cwd())).resolves.toMatchObject({
				accountsPath: globalPath,
				imported: 2,
				skipped: 0,
				total: 4,
			});
		} finally {
			rmSpy.mockRestore();
		}
	});

	it("sweeps stale sync temp directories before creating a new import temp dir", async () => {
		const rootDir = join(process.cwd(), ".tmp-codex-multi-auth");
		const fakeHome = await fs.promises.mkdtemp(join(os.tmpdir(), "codex-sync-home-"));
		process.env.CODEX_MULTI_AUTH_DIR = rootDir;
		process.env.HOME = fakeHome;
		process.env.USERPROFILE = fakeHome;
		const globalPath = join(rootDir, "openai-codex-accounts.json");
		const tempRoot = join(fakeHome, ".opencode", "tmp");
		const staleDir = join(tempRoot, "oc-chatgpt-multi-auth-sync-stale-test");
		const staleFile = join(staleDir, "accounts.json");
		const recentDir = join(tempRoot, "oc-chatgpt-multi-auth-sync-recent-test");
		const recentFile = join(recentDir, "accounts.json");
		mockExistsSync.mockImplementation((candidate) => String(candidate) === globalPath);
		mockSourceStorageFile(
			globalPath,
			JSON.stringify({
				version: 3,
				activeIndex: 0,
				activeIndexByFamily: {},
				accounts: [{ accountId: "org-source", organizationId: "org-source", refreshToken: "rt-source", addedAt: 1, lastUsed: 1 }],
			}),
		);

		try {
			await fs.promises.mkdir(staleDir, { recursive: true });
			await fs.promises.writeFile(staleFile, "sensitive", "utf8");
			await fs.promises.mkdir(recentDir, { recursive: true });
			await fs.promises.writeFile(recentFile, "recent", "utf8");
			const oldTime = new Date(Date.now() - (15 * 60 * 1000));
			const recentTime = new Date(Date.now() - (2 * 60 * 1000));
			await fs.promises.utimes(staleDir, oldTime, oldTime);
			await fs.promises.utimes(staleFile, oldTime, oldTime);
			await fs.promises.utimes(recentDir, recentTime, recentTime);
			await fs.promises.utimes(recentFile, recentTime, recentTime);

			const { previewSyncFromCodexMultiAuth } = await import("../lib/codex-multi-auth-sync.js");
			await expect(previewSyncFromCodexMultiAuth(process.cwd())).resolves.toMatchObject({
				rootDir,
				accountsPath: globalPath,
				scope: "global",
			});

			await expect(fs.promises.stat(staleDir)).rejects.toThrow();
			await expect(fs.promises.stat(recentDir)).resolves.toBeTruthy();
		} finally {
			await fs.promises.rm(fakeHome, { recursive: true, force: true });
		}
	});

	it("retries stale temp sweep once on transient Windows lock errors", async () => {
		const rootDir = join(process.cwd(), ".tmp-codex-multi-auth");
		const fakeHome = await fs.promises.mkdtemp(join(os.tmpdir(), "codex-sync-home-"));
		process.env.CODEX_MULTI_AUTH_DIR = rootDir;
		process.env.HOME = fakeHome;
		process.env.USERPROFILE = fakeHome;
		const globalPath = join(rootDir, "openai-codex-accounts.json");
		const tempRoot = join(fakeHome, ".opencode", "tmp");
		const staleDir = join(tempRoot, "oc-chatgpt-multi-auth-sync-stale-retry-test");
		const staleFile = join(staleDir, "accounts.json");
		mockExistsSync.mockImplementation((candidate) => String(candidate) === globalPath);
		mockSourceStorageFile(
			globalPath,
			JSON.stringify({
				version: 3,
				activeIndex: 0,
				activeIndexByFamily: {},
				accounts: [{ accountId: "org-source", organizationId: "org-source", refreshToken: "rt-source", addedAt: 1, lastUsed: 1 }],
			}),
		);

		const originalRm = fs.promises.rm.bind(fs.promises);
		let staleSweepBlocked = false;
		const rmSpy = vi.spyOn(fs.promises, "rm").mockImplementation(async (path, options) => {
			if (!staleSweepBlocked && String(path) === staleDir) {
				staleSweepBlocked = true;
				throw Object.assign(new Error("busy"), { code: "EBUSY" });
			}
			return originalRm(path, options as never);
		});
		const loggerModule = await import("../lib/logger.js");

		try {
			await fs.promises.mkdir(staleDir, { recursive: true });
			await fs.promises.writeFile(staleFile, "sensitive", "utf8");
			const oldTime = new Date(Date.now() - (15 * 60 * 1000));
			await fs.promises.utimes(staleDir, oldTime, oldTime);
			await fs.promises.utimes(staleFile, oldTime, oldTime);

			const { previewSyncFromCodexMultiAuth } = await import("../lib/codex-multi-auth-sync.js");
			await expect(previewSyncFromCodexMultiAuth(process.cwd())).resolves.toMatchObject({
				rootDir,
				accountsPath: globalPath,
				scope: "global",
			});

			expect(staleSweepBlocked).toBe(true);
			expect(rmSpy.mock.calls.filter(([path]) => String(path) === staleDir)).toHaveLength(2);
			expect(vi.mocked(loggerModule.logWarn)).not.toHaveBeenCalledWith(
				expect.stringContaining("Failed to sweep stale codex sync temp directory"),
			);
			await expect(fs.promises.stat(staleDir)).rejects.toThrow();
		} finally {
			rmSpy.mockRestore();
			await fs.promises.rm(fakeHome, { recursive: true, force: true });
		}
	});

	it("skips source accounts whose emails already exist locally during sync", async () => {
		const rootDir = join(process.cwd(), ".tmp-codex-multi-auth");
		process.env.CODEX_MULTI_AUTH_DIR = rootDir;
		const globalPath = join(rootDir, "openai-codex-accounts.json");
		mockExistsSync.mockImplementation((candidate) => String(candidate) === globalPath);
		mockSourceStorageFile(globalPath, 
			JSON.stringify({
				version: 3,
				activeIndex: 0,
				activeIndexByFamily: {},
				accounts: [
					{
						accountId: "org-shared-a",
						organizationId: "org-shared-a",
						accountIdSource: "org",
						email: "shared@example.com",
						refreshToken: "rt-shared-a",
						addedAt: 1,
						lastUsed: 1,
					},
					{
						accountId: "org-shared-b",
						organizationId: "org-shared-b",
						accountIdSource: "org",
						email: "shared@example.com",
						refreshToken: "rt-shared-b",
						addedAt: 2,
						lastUsed: 2,
					},
					{
						accountId: "org-new",
						organizationId: "org-new",
						accountIdSource: "org",
						email: "new@example.com",
						refreshToken: "rt-new",
						addedAt: 3,
						lastUsed: 3,
					},
				],
			}),
		);

		const storageModule = await import("../lib/storage.js");
		const currentStorage = {
			version: 3 as const,
			activeIndex: 0,
			activeIndexByFamily: {},
			accounts: [
				{
					accountId: "org-existing",
					organizationId: "org-existing",
					accountIdSource: "org",
					email: "shared@example.com",
					refreshToken: "rt-existing",
					addedAt: 10,
					lastUsed: 10,
				},
			],
		} satisfies AccountStorageV3;
		vi.mocked(storageModule.loadAccounts).mockResolvedValue(currentStorage);

		vi.mocked(storageModule.previewImportAccountsWithExistingStorage).mockImplementationOnce(async (filePath) => {
			const raw = await fs.promises.readFile(filePath, "utf8");
			const parsed = JSON.parse(raw) as { accounts: Array<{ email?: string }> };
			expect(parsed.accounts.map((account) => account.email)).toEqual([
				"new@example.com",
			]);
			return { imported: 1, skipped: 0, total: 1 };
		});
		vi.mocked(storageModule.importAccounts).mockImplementationOnce(async (filePath, _options, prepare) => {
			const raw = await fs.promises.readFile(filePath, "utf8");
			const parsed = JSON.parse(raw) as AccountStorageV3;
			const prepared = prepare ? prepare(parsed, currentStorage) : parsed;
			expect(prepared.accounts.map((account) => account.email)).toEqual([
				"new@example.com",
			]);
			return {
				imported: 1,
				skipped: 0,
				total: 1,
				backupStatus: "created",
				backupPath: "/tmp/filtered-sync-backup.json",
			};
		});

		const { previewSyncFromCodexMultiAuth, syncFromCodexMultiAuth } = await import("../lib/codex-multi-auth-sync.js");

		await expect(previewSyncFromCodexMultiAuth(process.cwd())).resolves.toMatchObject({
			accountsPath: globalPath,
			imported: 1,
			total: 1,
			skipped: 0,
		});
		await expect(syncFromCodexMultiAuth(process.cwd())).resolves.toMatchObject({
			accountsPath: globalPath,
			imported: 1,
			total: 1,
			skipped: 0,
		});
	});

	it("treats refresh tokens as case-sensitive identities during sync filtering", async () => {
		const rootDir = join(process.cwd(), ".tmp-codex-multi-auth");
		process.env.CODEX_MULTI_AUTH_DIR = rootDir;
		const globalPath = join(rootDir, "openai-codex-accounts.json");
		mockExistsSync.mockImplementation((candidate) => String(candidate) === globalPath);
		mockSourceStorageFile(
			globalPath,
			JSON.stringify({
				version: 3,
				activeIndex: 0,
				activeIndexByFamily: {},
				accounts: [
					{
						refreshToken: "abc-token",
						addedAt: 1,
						lastUsed: 1,
					},
				],
			}),
		);

		const storageModule = await import("../lib/storage.js");
		const currentStorage = {
			version: 3 as const,
			activeIndex: 0,
			activeIndexByFamily: {},
			accounts: [
				{
					refreshToken: "ABC-token",
					addedAt: 10,
					lastUsed: 10,
				},
			],
		} satisfies AccountStorageV3;
		vi.mocked(storageModule.loadAccounts).mockResolvedValue(currentStorage);
		vi.mocked(storageModule.previewImportAccountsWithExistingStorage).mockImplementationOnce(async (filePath) => {
			const raw = await fs.promises.readFile(filePath, "utf8");
			const parsed = JSON.parse(raw) as { accounts: Array<{ refreshToken?: string }> };
			expect(parsed.accounts).toHaveLength(1);
			expect(parsed.accounts[0]?.refreshToken).toBe("abc-token");
			return { imported: 1, skipped: 0, total: 2 };
		});

		const { previewSyncFromCodexMultiAuth } = await import("../lib/codex-multi-auth-sync.js");
		await expect(previewSyncFromCodexMultiAuth(process.cwd())).resolves.toMatchObject({
			accountsPath: globalPath,
			imported: 1,
			total: 2,
			skipped: 0,
		});
	});

	it("deduplicates email-less source accounts by identity before import", async () => {
		const rootDir = join(process.cwd(), ".tmp-codex-multi-auth");
		process.env.CODEX_MULTI_AUTH_DIR = rootDir;
		const globalPath = join(rootDir, "openai-codex-accounts.json");
		mockExistsSync.mockImplementation((candidate) => String(candidate) === globalPath);
		mockSourceStorageFile(globalPath, 
			JSON.stringify({
				version: 3,
				activeIndex: 0,
				activeIndexByFamily: {},
				accounts: [
					{
						accountId: "org-shared",
						organizationId: "org-shared",
						accountIdSource: "org",
						refreshToken: "rt-shared",
						addedAt: 1,
						lastUsed: 1,
					},
					{
						accountId: "org-shared",
						organizationId: "org-shared",
						accountIdSource: "org",
						refreshToken: "rt-shared",
						addedAt: 2,
						lastUsed: 2,
					},
				],
			}),
		);

		const storageModule = await import("../lib/storage.js");
		vi.mocked(storageModule.deduplicateAccounts).mockImplementationOnce((accounts) => [accounts[1]]);
		vi.mocked(storageModule.previewImportAccountsWithExistingStorage).mockImplementationOnce(async (filePath) => {
			const raw = await fs.promises.readFile(filePath, "utf8");
			const parsed = JSON.parse(raw) as { accounts: Array<{ refreshToken?: string }> };
			expect(parsed.accounts).toHaveLength(1);
			expect(parsed.accounts[0]?.refreshToken).toBe("rt-shared");
			return { imported: 1, skipped: 0, total: 1 };
		});

		const { previewSyncFromCodexMultiAuth } = await import("../lib/codex-multi-auth-sync.js");
		await expect(previewSyncFromCodexMultiAuth(process.cwd())).resolves.toMatchObject({
			accountsPath: globalPath,
			imported: 1,
			total: 1,
			skipped: 0,
		});
	});

	it("normalizes org-scoped source accounts to include organizationId before import", async () => {
		const rootDir = join(process.cwd(), ".tmp-codex-multi-auth");
		process.env.CODEX_MULTI_AUTH_DIR = rootDir;
		const globalPath = join(rootDir, "openai-codex-accounts.json");
		mockExistsSync.mockImplementation((candidate) => String(candidate) === globalPath);
		mockSourceStorageFile(globalPath, 
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
		const resolved = await loadCodexMultiAuthSourceStorage(process.cwd());

		expect(resolved.storage.accounts[0]?.organizationId).toBe("org-example123");
	});

	it("throws for invalid JSON in the external accounts file", async () => {
		const rootDir = join(process.cwd(), ".tmp-codex-multi-auth");
		process.env.CODEX_MULTI_AUTH_DIR = rootDir;
		const globalPath = join(rootDir, "openai-codex-accounts.json");
		mockExistsSync.mockImplementation((candidate) => String(candidate) === globalPath);
		mockSourceStorageFile(globalPath, "not valid json");

		const { loadCodexMultiAuthSourceStorage } = await import("../lib/codex-multi-auth-sync.js");
		await expect(loadCodexMultiAuthSourceStorage(process.cwd())).rejects.toThrow(/Invalid JSON/);
	});

	it("enforces finite sync capacity override for prune-capable flows", async () => {
		const rootDir = join(process.cwd(), ".tmp-codex-multi-auth");
		process.env.CODEX_MULTI_AUTH_DIR = rootDir;
		process.env.CODEX_AUTH_SYNC_MAX_ACCOUNTS = "2";
		const globalPath = join(rootDir, "openai-codex-accounts.json");
		mockExistsSync.mockImplementation((candidate) => String(candidate) === globalPath);
		mockSourceStorageFile(globalPath, 
			JSON.stringify({
				version: 3,
				activeIndex: 0,
				activeIndexByFamily: {},
				accounts: [
					{
						accountId: "org-new-1",
						organizationId: "org-new-1",
						accountIdSource: "org",
						email: "new-1@example.com",
						refreshToken: "rt-new-1",
						addedAt: 1,
						lastUsed: 1,
					},
					{
						accountId: "org-new-2",
						organizationId: "org-new-2",
						accountIdSource: "org",
						email: "new-2@example.com",
						refreshToken: "rt-new-2",
						addedAt: 2,
						lastUsed: 2,
					},
				],
			}),
		);

		const storageModule = await import("../lib/storage.js");
		vi.mocked(storageModule.loadAccounts).mockResolvedValue({
			version: 3,
			activeIndex: 0,
			activeIndexByFamily: {},
			accounts: [
				{
					accountId: "org-existing",
					organizationId: "org-existing",
					accountIdSource: "org",
					email: "existing@example.com",
					refreshToken: "rt-existing",
					addedAt: 10,
					lastUsed: 10,
				},
			],
		});

		const { previewSyncFromCodexMultiAuth, CodexMultiAuthSyncCapacityError } = await import("../lib/codex-multi-auth-sync.js");
		await expect(previewSyncFromCodexMultiAuth(process.cwd())).rejects.toBeInstanceOf(
			CodexMultiAuthSyncCapacityError,
		);
	});

	it("enforces finite sync capacity override during apply", async () => {
		const rootDir = join(process.cwd(), ".tmp-codex-multi-auth");
		process.env.CODEX_MULTI_AUTH_DIR = rootDir;
		process.env.CODEX_AUTH_SYNC_MAX_ACCOUNTS = "2";
		const globalPath = join(rootDir, "openai-codex-accounts.json");
		mockExistsSync.mockImplementation((candidate) => String(candidate) === globalPath);
		mockSourceStorageFile(
			globalPath,
			JSON.stringify({
				version: 3,
				activeIndex: 0,
				activeIndexByFamily: {},
				accounts: [
					{
						accountId: "org-new-1",
						organizationId: "org-new-1",
						accountIdSource: "org",
						email: "new-1@example.com",
						refreshToken: "rt-new-1",
						addedAt: 1,
						lastUsed: 1,
					},
					{
						accountId: "org-new-2",
						organizationId: "org-new-2",
						accountIdSource: "org",
						email: "new-2@example.com",
						refreshToken: "rt-new-2",
						addedAt: 2,
						lastUsed: 2,
					},
				],
			}),
		);

		const storageModule = await import("../lib/storage.js");
		const currentStorage = {
			version: 3 as const,
			activeIndex: 0,
			activeIndexByFamily: {},
			accounts: [
				{
					accountId: "org-existing",
					organizationId: "org-existing",
					accountIdSource: "org",
					email: "existing@example.com",
					refreshToken: "rt-existing",
					addedAt: 10,
					lastUsed: 10,
				},
			],
		} satisfies AccountStorageV3;
		vi.mocked(storageModule.importAccounts).mockImplementationOnce(async (filePath, _options, prepare) => {
			const raw = await fs.promises.readFile(filePath, "utf8");
			const parsed = JSON.parse(raw) as AccountStorageV3;
			if (prepare) {
				prepare(parsed, currentStorage);
			}
			return {
				imported: 2,
				skipped: 0,
				total: 4,
				backupStatus: "created",
				backupPath: "/tmp/codex-multi-auth-sync-backup.json",
			};
		});

		const { syncFromCodexMultiAuth, CodexMultiAuthSyncCapacityError } = await import("../lib/codex-multi-auth-sync.js");
		await expect(syncFromCodexMultiAuth(process.cwd())).rejects.toBeInstanceOf(
			CodexMultiAuthSyncCapacityError,
		);
	});

	it("ignores a zero sync capacity override and warns instead of disabling sync", async () => {
		const rootDir = join(process.cwd(), ".tmp-codex-multi-auth");
		process.env.CODEX_MULTI_AUTH_DIR = rootDir;
		process.env.CODEX_AUTH_SYNC_MAX_ACCOUNTS = "0";
		const globalPath = join(rootDir, "openai-codex-accounts.json");
		mockExistsSync.mockImplementation((candidate) => String(candidate) === globalPath);
		mockSourceStorageFile(
			globalPath,
			JSON.stringify({
				version: 3,
				activeIndex: 0,
				activeIndexByFamily: {},
				accounts: [
					{
						accountId: "org-new-1",
						organizationId: "org-new-1",
						accountIdSource: "org",
						email: "new-1@example.com",
						refreshToken: "rt-new-1",
						addedAt: 1,
						lastUsed: 1,
					},
				],
			}),
		);

		const loggerModule = await import("../lib/logger.js");
		const { previewSyncFromCodexMultiAuth } = await import("../lib/codex-multi-auth-sync.js");

		await expect(previewSyncFromCodexMultiAuth(process.cwd())).resolves.toMatchObject({
			accountsPath: globalPath,
		});
		expect(vi.mocked(loggerModule.logWarn)).toHaveBeenCalledWith(
			expect.stringContaining('CODEX_AUTH_SYNC_MAX_ACCOUNTS override value "0" is not a positive finite number; ignoring.'),
		);
	});

	it("reports when the source alone exceeds a finite sync capacity", async () => {
		const rootDir = join(process.cwd(), ".tmp-codex-multi-auth");
		process.env.CODEX_MULTI_AUTH_DIR = rootDir;
		process.env.CODEX_AUTH_SYNC_MAX_ACCOUNTS = "2";
		const globalPath = join(rootDir, "openai-codex-accounts.json");
		mockExistsSync.mockImplementation((candidate) => String(candidate) === globalPath);
		mockSourceStorageFile(
			globalPath,
			JSON.stringify({
				version: 3,
				activeIndex: 0,
				activeIndexByFamily: {},
				accounts: [
					{
						accountId: "org-new-1",
						organizationId: "org-new-1",
						accountIdSource: "org",
						email: "new-1@example.com",
						refreshToken: "rt-new-1",
						addedAt: 1,
						lastUsed: 1,
					},
					{
						accountId: "org-new-2",
						organizationId: "org-new-2",
						accountIdSource: "org",
						email: "new-2@example.com",
						refreshToken: "rt-new-2",
						addedAt: 2,
						lastUsed: 2,
					},
					{
						accountId: "org-new-3",
						organizationId: "org-new-3",
						accountIdSource: "org",
						email: "new-3@example.com",
						refreshToken: "rt-new-3",
						addedAt: 3,
						lastUsed: 3,
					},
				],
			}),
		);

		const storageModule = await import("../lib/storage.js");
		vi.mocked(storageModule.loadAccounts).mockResolvedValue({
			version: 3,
			activeIndex: 0,
			activeIndexByFamily: {},
			accounts: [],
		});

		const { previewSyncFromCodexMultiAuth, CodexMultiAuthSyncCapacityError } = await import("../lib/codex-multi-auth-sync.js");
		let thrown: unknown;
		try {
			await previewSyncFromCodexMultiAuth(process.cwd());
		} catch (error) {
			thrown = error;
		}
		expect(thrown).toBeInstanceOf(CodexMultiAuthSyncCapacityError);
		expect(thrown).toMatchObject({
			name: "CodexMultiAuthSyncCapacityError",
			details: expect.objectContaining({
				sourceDedupedTotal: 3,
				importableNewAccounts: 0,
				needToRemove: 1,
				suggestedRemovals: [],
			}),
		});
	});

	it("cleans up tagged synced overlaps by normalizing org-scoped identities first", async () => {
		const storageModule = await import("../lib/storage.js");
		vi.mocked(storageModule.withAccountStorageTransaction).mockImplementationOnce(async (handler) =>
			handler(
				{
					version: 3,
					activeIndex: 0,
					activeIndexByFamily: {},
					accounts: [
						{
							accountId: "org-example123",
							accountIdSource: "org",
							accountTags: ["codex-multi-auth-sync"],
							refreshToken: "sync-refresh",
							addedAt: 1,
							lastUsed: 1,
						},
						{
							accountId: "org-example123",
							organizationId: "org-example123",
							accountIdSource: "org",
							accountTags: ["codex-multi-auth-sync"],
							refreshToken: "sync-refresh",
							addedAt: 2,
							lastUsed: 2,
						},
					],
				},
				vi.fn(async () => {}),
			),
		);
		vi.mocked(storageModule.normalizeAccountStorage).mockImplementationOnce((value: unknown): AccountStorageV3 => {
			const record = value as {
				version: 3;
				activeIndex: number;
				activeIndexByFamily: Record<string, number>;
				accounts: AccountStorageV3["accounts"];
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
			updated: 0,
		});
	});

	it("reads the raw storage file so duplicate tagged rows are removed from disk", async () => {
		const storageModule = await import("../lib/storage.js");
		const persist = vi.fn(async (_next: AccountStorageV3) => {});
		vi.mocked(storageModule.withAccountStorageTransaction).mockImplementationOnce(async (handler) =>
			handler(
				{
					version: 3,
					activeIndex: 0,
					activeIndexByFamily: {},
					accounts: [
						{
							accountId: "org-sync",
							organizationId: "org-sync",
							accountIdSource: "org",
							accountTags: ["codex-multi-auth-sync"],
							email: "sync@example.com",
							refreshToken: "sync-token",
							addedAt: 2,
							lastUsed: 2,
						},
					],
				},
				persist,
			),
		);
		mockSourceStorageFile(
			"/tmp/opencode-accounts.json",
			JSON.stringify({
				version: 3,
				activeIndex: 0,
				activeIndexByFamily: {},
				accounts: [
					{
						accountId: "org-sync",
						accountIdSource: "org",
						accountTags: ["codex-multi-auth-sync"],
						email: "sync@example.com",
						refreshToken: "sync-token",
						addedAt: 1,
						lastUsed: 1,
					},
					{
						accountId: "org-sync",
						organizationId: "org-sync",
						accountIdSource: "org",
						accountTags: ["codex-multi-auth-sync"],
						email: "sync@example.com",
						refreshToken: "sync-token",
						addedAt: 2,
						lastUsed: 2,
					},
				],
			}),
		);
		vi.mocked(storageModule.normalizeAccountStorage).mockImplementationOnce((value: unknown): AccountStorageV3 => {
			const record = value as {
				version: 3;
				activeIndex: number;
				activeIndexByFamily: Record<string, number>;
				accounts: AccountStorageV3["accounts"];
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
			updated: 0,
		});
		const saved = persist.mock.calls[0]?.[0];
		if (!saved) {
			throw new Error("Expected persisted overlap cleanup result");
		}
		expect(saved.accounts).toHaveLength(1);
		expect(saved.accounts[0]?.organizationId).toBe("org-sync");
	});

	it("does not count synced overlap records as updated when only key order differs", async () => {
		const storageModule = await import("../lib/storage.js");
		const persist = vi.fn(async () => {});
		vi.mocked(storageModule.withAccountStorageTransaction).mockImplementationOnce(async (handler) =>
			handler(
				{
					version: 3,
					activeIndex: 0,
					activeIndexByFamily: {},
					accounts: [
						{
							refreshToken: "sync-token",
							accountTags: ["codex-multi-auth-sync"],
							organizationId: "org-sync",
							accountId: "org-sync",
							accountIdSource: "org",
							addedAt: 2,
							lastUsed: 2,
						},
					],
				},
				persist,
			),
		);
		mockSourceStorageFile(
			"/tmp/opencode-accounts.json",
			JSON.stringify({
				version: 3,
				activeIndex: 0,
				activeIndexByFamily: {},
				accounts: [
					{
						accountId: "org-sync",
						organizationId: "org-sync",
						accountIdSource: "org",
						accountTags: ["codex-multi-auth-sync"],
						refreshToken: "sync-token",
						addedAt: 2,
						lastUsed: 2,
					},
				],
			}),
		);

		const { cleanupCodexMultiAuthSyncedOverlaps } = await import("../lib/codex-multi-auth-sync.js");
		await expect(cleanupCodexMultiAuthSyncedOverlaps()).resolves.toEqual({
			before: 1,
			after: 1,
			removed: 0,
			updated: 0,
		});
		expect(persist).not.toHaveBeenCalled();
	});

	it("migrates v1 raw overlap snapshots without collapsing duplicate tagged rows before cleanup", async () => {
		const storageModule = await import("../lib/storage.js");
		const persist = vi.fn(async (_next: AccountStorageV3) => {});
		vi.mocked(storageModule.withAccountStorageTransaction).mockImplementationOnce(async (handler) =>
			handler(
				{
					version: 3,
					activeIndex: 0,
					activeIndexByFamily: { codex: 0 },
					accounts: [
						{
							accountId: "org-sync",
							accountIdSource: "org",
							accountTags: ["codex-multi-auth-sync"],
							refreshToken: "sync-token",
							addedAt: 1,
							lastUsed: 1,
						},
					],
				},
				persist,
			),
		);
		mockSourceStorageFile(
			"/tmp/opencode-accounts.json",
			JSON.stringify({
				version: 1,
				activeIndex: 1,
				accounts: [
					{
						accountId: "org-sync",
						accountIdSource: "org",
						accountTags: ["codex-multi-auth-sync"],
						refreshToken: "sync-token",
						addedAt: 1,
						lastUsed: 1,
					},
					{
						accountId: "org-sync",
						organizationId: "org-sync",
						accountIdSource: "org",
						accountTags: ["codex-multi-auth-sync"],
						refreshToken: "sync-token",
						addedAt: 2,
						lastUsed: 2,
					},
				],
			}),
		);
		vi.mocked(storageModule.normalizeAccountStorage).mockImplementationOnce((value: unknown): AccountStorageV3 => {
			const record = value as {
				version: 3;
				activeIndex: number;
				activeIndexByFamily: Record<string, number>;
				accounts: AccountStorageV3["accounts"];
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
			updated: 0,
		});
		const saved = persist.mock.calls[0]?.[0];
		if (!saved) {
			throw new Error("Expected persisted overlap cleanup result");
		}
		expect(saved.accounts).toHaveLength(1);
		expect(saved.accounts[0]?.organizationId).toBe("org-sync");
		expect(saved.activeIndexByFamily?.codex).toBe(0);
	});

	it("falls back to in-memory overlap cleanup state on transient Windows lock errors", async () => {
		const storageModule = await import("../lib/storage.js");
		const loggerModule = await import("../lib/logger.js");
		const persist = vi.fn(async (_next: AccountStorageV3) => {});
		vi.mocked(storageModule.deduplicateAccounts).mockImplementationOnce((accounts) => {
			return accounts.length > 1 ? [accounts[1] ?? accounts[0]].filter(Boolean) : accounts;
		});
		vi.mocked(storageModule.withAccountStorageTransaction).mockImplementationOnce(async (handler) =>
			handler(
				{
					version: 3,
					activeIndex: 0,
					activeIndexByFamily: {},
					accounts: [
						{
							accountId: "org-sync",
							accountIdSource: "org",
							accountTags: ["codex-multi-auth-sync"],
							refreshToken: "sync-token",
							addedAt: 1,
							lastUsed: 1,
						},
						{
							accountId: "org-sync",
							organizationId: "org-sync",
							accountIdSource: "org",
							accountTags: ["codex-multi-auth-sync"],
							refreshToken: "sync-token",
							addedAt: 2,
							lastUsed: 2,
						},
					],
				},
				persist,
			),
		);
		mockReadFile.mockRejectedValueOnce(Object.assign(new Error("busy"), { code: "EBUSY" }));
		const storagePath = await import("../lib/storage.js");
		vi.mocked(storagePath.getStoragePath).mockReturnValueOnce("/tmp/opencode-accounts.json");

		const { cleanupCodexMultiAuthSyncedOverlaps } = await import("../lib/codex-multi-auth-sync.js");
		await expect(cleanupCodexMultiAuthSyncedOverlaps()).resolves.toEqual({
			before: 2,
			after: 1,
			removed: 1,
			updated: 0,
		});
		const saved = persist.mock.calls[0]?.[0];
		if (!saved) {
			throw new Error("Expected persisted overlap cleanup result");
		}
		expect(saved.accounts).toHaveLength(1);
		expect(saved.accounts[0]?.organizationId).toBe("org-sync");
		expect(vi.mocked(loggerModule.logWarn)).toHaveBeenCalledWith(
			expect.stringContaining("raw storage snapshot for synced overlap cleanup (EBUSY)"),
		);
	});

	it("limits overlap cleanup to accounts tagged from codex-multi-auth sync", async () => {
		const storageModule = await import("../lib/storage.js");
		vi.mocked(storageModule.withAccountStorageTransaction).mockImplementationOnce(async (handler) =>
			handler(
				{
					version: 3,
					activeIndex: 0,
					activeIndexByFamily: {},
					accounts: [
						{
							refreshToken: "legacy-a",
							email: "shared@example.com",
							addedAt: 1,
							lastUsed: 1,
						},
						{
							refreshToken: "legacy-b",
							email: "shared@example.com",
							addedAt: 2,
							lastUsed: 2,
						},
						{
							accountId: "org-sync",
							organizationId: "org-sync",
							accountIdSource: "org",
							accountTags: ["codex-multi-auth-sync"],
							email: "sync@example.com",
							refreshToken: "sync-token",
							addedAt: 3,
							lastUsed: 3,
						},
						{
							accountId: "org-sync",
							organizationId: "org-sync",
							accountIdSource: "org",
							accountTags: ["codex-multi-auth-sync"],
							email: "sync@example.com",
							refreshToken: "sync-token",
							addedAt: 4,
							lastUsed: 4,
						},
					],
				},
				vi.fn(async () => {}),
			),
		);

		const { cleanupCodexMultiAuthSyncedOverlaps } = await import("../lib/codex-multi-auth-sync.js");
		await expect(cleanupCodexMultiAuthSyncedOverlaps()).resolves.toEqual({
			before: 4,
			after: 4,
			removed: 0,
			updated: 1,
		});
	});

	it("removes synced accounts that overlap preserved local accounts", async () => {
		const storageModule = await import("../lib/storage.js");
		const persist = vi.fn(async (_next: AccountStorageV3) => {});
		vi.mocked(storageModule.withAccountStorageTransaction).mockImplementationOnce(async (handler) =>
			handler(
				{
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
							addedAt: 5,
							lastUsed: 5,
						},
						{
							accountId: "org-sync",
							organizationId: "org-sync",
							accountIdSource: "org",
							accountTags: ["codex-multi-auth-sync"],
							email: "shared@example.com",
							refreshToken: "rt-sync",
							addedAt: 4,
							lastUsed: 4,
						},
					],
				},
				persist,
			),
		);

		const { cleanupCodexMultiAuthSyncedOverlaps } = await import("../lib/codex-multi-auth-sync.js");
		await expect(cleanupCodexMultiAuthSyncedOverlaps()).resolves.toEqual({
			before: 2,
			after: 1,
			removed: 1,
			updated: 0,
		});
		const saved = persist.mock.calls[0]?.[0];
		if (!saved) {
			throw new Error("Expected persisted overlap cleanup result");
		}
		expect(saved.accounts).toHaveLength(1);
		expect(saved.accounts[0]?.accountId).toBe("org-local");
	});

	it("remaps active indices when synced overlap cleanup reorders accounts", async () => {
		const storageModule = await import("../lib/storage.js");
		const persist = vi.fn(async (_next: AccountStorageV3) => {});
		vi.mocked(storageModule.withAccountStorageTransaction).mockImplementationOnce(async (handler) =>
			handler(
				{
					version: 3,
					activeIndex: 0,
					activeIndexByFamily: { codex: 0 },
					accounts: [
						{
							accountId: "org-sync",
							organizationId: "org-sync",
							accountIdSource: "org",
							accountTags: ["codex-multi-auth-sync"],
							email: "sync@example.com",
							refreshToken: "sync-token",
							addedAt: 3,
							lastUsed: 3,
						},
						{
							accountId: "org-local",
							organizationId: "org-local",
							accountIdSource: "org",
							email: "local@example.com",
							refreshToken: "local-token",
							addedAt: 4,
							lastUsed: 4,
						},
					],
				},
				persist,
			),
		);

		const { cleanupCodexMultiAuthSyncedOverlaps } = await import("../lib/codex-multi-auth-sync.js");
		await cleanupCodexMultiAuthSyncedOverlaps();

		const saved = persist.mock.calls[0]?.[0];
		if (!saved) {
			throw new Error("Expected persisted overlap cleanup result");
		}
		expect(saved.accounts.map((account) => account.accountId)).toEqual(["org-local", "org-sync"]);
		expect(saved.activeIndex).toBe(1);
		expect(saved.activeIndexByFamily?.codex).toBe(1);
	});

	it("does not block preview when account limit is unlimited", async () => {
		const rootDir = join(process.cwd(), ".tmp-codex-multi-auth");
		process.env.CODEX_MULTI_AUTH_DIR = rootDir;
		const globalPath = join(rootDir, "openai-codex-accounts.json");
		mockExistsSync.mockImplementation((candidate) => String(candidate) === globalPath);
		mockSourceStorageFile(globalPath, 
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

		const { previewSyncFromCodexMultiAuth } = await import("../lib/codex-multi-auth-sync.js");

		await expect(previewSyncFromCodexMultiAuth(process.cwd())).resolves.toMatchObject({
			accountsPath: globalPath,
			imported: 2,
			total: 4,
			skipped: 0,
		});
	});

	it("warns instead of failing when post-success temp cleanup cannot remove sync data", async () => {
		const rootDir = join(process.cwd(), ".tmp-codex-multi-auth");
		process.env.CODEX_MULTI_AUTH_DIR = rootDir;
		const globalPath = join(rootDir, "openai-codex-accounts.json");
		mockExistsSync.mockImplementation((candidate) => String(candidate) === globalPath);
		mockSourceStorageFile(
			globalPath,
			JSON.stringify({
				version: 3,
				activeIndex: 0,
				activeIndexByFamily: {},
				accounts: [{ refreshToken: "sync-refresh", addedAt: 1, lastUsed: 1 }],
			}),
		);
		const rmSpy = vi.spyOn(fs.promises, "rm").mockRejectedValue(new Error("rm failed"));
		const loggerModule = await import("../lib/logger.js");
		const storageModule = await import("../lib/storage.js");
		try {
			const { syncFromCodexMultiAuth } = await import("../lib/codex-multi-auth-sync.js");

			await expect(syncFromCodexMultiAuth(process.cwd())).resolves.toMatchObject({
				accountsPath: globalPath,
				imported: 2,
				backupStatus: "created",
			});
			expect(vi.mocked(loggerModule.logWarn)).toHaveBeenCalledWith(
				expect.stringContaining("Failed to remove temporary codex sync directory"),
			);
		} finally {
			rmSpy.mockRestore();
		}
	});

	it("does not block source-only imports above the old cap when limit is unlimited", async () => {
		const rootDir = join(process.cwd(), ".tmp-codex-multi-auth");
		process.env.CODEX_MULTI_AUTH_DIR = rootDir;
		const globalPath = join(rootDir, "openai-codex-accounts.json");
		mockExistsSync.mockImplementation((candidate) => String(candidate) === globalPath);
		mockSourceStorageFile(globalPath, 
			JSON.stringify({
				version: 3,
				activeIndex: 0,
				activeIndexByFamily: {},
				accounts: Array.from({ length: 21 }, (_, index) => ({
					accountId: `org-source-${index + 1}`,
					organizationId: `org-source-${index + 1}`,
					accountIdSource: "org",
					email: `source${index + 1}@example.com`,
					refreshToken: `rt-source-${index + 1}`,
					addedAt: index + 1,
					lastUsed: index + 1,
				})),
			}),
		);

		const storageModule = await import("../lib/storage.js");
		vi.mocked(storageModule.loadAccounts).mockResolvedValue({
			version: 3,
			activeIndex: 0,
			activeIndexByFamily: {},
			accounts: [
				{
					accountId: "org-local",
					organizationId: "org-local",
					accountIdSource: "org",
					email: "local@example.com",
					refreshToken: "rt-local",
					addedAt: 1,
					lastUsed: 1,
				},
			],
		});
		vi.mocked(storageModule.previewImportAccountsWithExistingStorage).mockImplementationOnce(async (filePath) => {
			const raw = await fs.promises.readFile(filePath, "utf8");
			const parsed = JSON.parse(raw) as { accounts: Array<{ accountId?: string }> };
			expect(parsed.accounts).toHaveLength(21);
			expect(parsed.accounts[0]?.accountId).toBe("org-source-1");
			expect(parsed.accounts[20]?.accountId).toBe("org-source-21");
			return { imported: 21, skipped: 0, total: 22 };
		});

		const { previewSyncFromCodexMultiAuth } = await import("../lib/codex-multi-auth-sync.js");

		await expect(previewSyncFromCodexMultiAuth(process.cwd())).resolves.toMatchObject({
			accountsPath: globalPath,
			imported: 21,
			total: 22,
			skipped: 0,
		});
	});

	it("does not produce capacity errors for large existing stores when unlimited", async () => {
		const rootDir = join(process.cwd(), ".tmp-codex-multi-auth");
		process.env.CODEX_MULTI_AUTH_DIR = rootDir;
		const globalPath = join(rootDir, "openai-codex-accounts.json");
		mockExistsSync.mockImplementation((candidate) => String(candidate) === globalPath);
		mockSourceStorageFile(globalPath, 
			JSON.stringify({
				version: 3,
				activeIndex: 0,
				activeIndexByFamily: {},
				accounts: Array.from({ length: 50 }, (_, index) => ({
					accountId: `org-source-${index + 1}`,
					organizationId: `org-source-${index + 1}`,
					accountIdSource: "org",
					email: `source${index + 1}@example.com`,
					refreshToken: `rt-source-${index + 1}`,
					addedAt: index + 1,
					lastUsed: index + 1,
				})),
			}),
		);
		const storageModule = await import("../lib/storage.js");
		vi.mocked(storageModule.previewImportAccountsWithExistingStorage).mockImplementationOnce(async (filePath) => {
			const raw = await fs.promises.readFile(filePath, "utf8");
			const parsed = JSON.parse(raw) as { accounts: Array<{ accountId?: string }> };
			expect(parsed.accounts).toHaveLength(50);
			expect(parsed.accounts[0]?.accountId).toBe("org-source-1");
			expect(parsed.accounts[49]?.accountId).toBe("org-source-50");
			return { imported: 50, skipped: 0, total: 52 };
		});

		const { previewSyncFromCodexMultiAuth } = await import("../lib/codex-multi-auth-sync.js");
		await expect(previewSyncFromCodexMultiAuth(process.cwd())).resolves.toMatchObject({
			accountsPath: globalPath,
			imported: 50,
			total: 52,
			skipped: 0,
		});
	});
});
