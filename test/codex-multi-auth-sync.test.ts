import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import { join } from "node:path";
import { findProjectRoot, getProjectStorageKey } from "../lib/storage/paths.js";

vi.mock("../lib/logger.js", () => ({
	logWarn: vi.fn(),
}));

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

	beforeEach(() => {
		vi.resetModules();
		vi.clearAllMocks();
		mockReadFile.mockReset();
		mockReadFile.mockImplementation((path, options) =>
			originalReadFile(path as Parameters<typeof fs.promises.readFile>[0], options as never),
		);
		delete process.env.CODEX_MULTI_AUTH_DIR;
		delete process.env.CODEX_HOME;
	});

	afterEach(() => {
		process.env.CODEX_MULTI_AUTH_DIR = originalEnv.CODEX_MULTI_AUTH_DIR;
		process.env.CODEX_HOME = originalEnv.CODEX_HOME;
		process.env.USERPROFILE = originalEnv.USERPROFILE;
		process.env.HOME = originalEnv.HOME;
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

		expect(vi.mocked(storageModule.previewImportAccounts)).toHaveBeenCalledWith(
			expect.stringContaining("oc-chatgpt-multi-auth-sync-"),
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
		vi.mocked(storageModule.previewImportAccounts).mockRejectedValueOnce(new Error("preview failed"));

		const { previewSyncFromCodexMultiAuth } = await import("../lib/codex-multi-auth-sync.js");
		await expect(previewSyncFromCodexMultiAuth(process.cwd())).rejects.toThrow("preview failed");
		expect(vi.mocked(storageModule.previewImportAccounts)).toHaveBeenCalledTimes(1);
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

		const mkdtempSpy = vi.spyOn(fs.promises, "mkdtemp").mockRejectedValueOnce(new Error("mkdtemp failed"));
		const storageModule = await import("../lib/storage.js");

		try {
			const { previewSyncFromCodexMultiAuth } = await import("../lib/codex-multi-auth-sync.js");
			await expect(previewSyncFromCodexMultiAuth(process.cwd())).rejects.toThrow("mkdtemp failed");
			expect(vi.mocked(storageModule.previewImportAccounts)).not.toHaveBeenCalledWith(
				expect.stringContaining(os.tmpdir()),
			);
		} finally {
			mkdtempSpy.mockRestore();
		}
	});

	it("logs a warning when secure temp cleanup fails", async () => {
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

		const rmSpy = vi.spyOn(fs.promises, "rm").mockRejectedValueOnce(new Error("cleanup blocked"));
		const loggerModule = await import("../lib/logger.js");

		try {
			const { previewSyncFromCodexMultiAuth } = await import("../lib/codex-multi-auth-sync.js");
			await expect(previewSyncFromCodexMultiAuth(process.cwd())).resolves.toMatchObject({
				accountsPath: globalPath,
				imported: 2,
			});
			expect(vi.mocked(loggerModule.logWarn)).toHaveBeenCalledWith(
				expect.stringContaining("Failed to remove temporary codex sync directory"),
			);
		} finally {
			rmSpy.mockRestore();
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
		};
		vi.mocked(storageModule.withAccountStorageTransaction)
			.mockImplementationOnce(async (handler) => handler(currentStorage, vi.fn(async () => {})))
			.mockImplementationOnce(async (handler) => handler(currentStorage, vi.fn(async () => {})));

		vi.mocked(storageModule.previewImportAccounts).mockImplementationOnce(async (filePath) => {
			const raw = await fs.promises.readFile(filePath, "utf8");
			const parsed = JSON.parse(raw) as { accounts: Array<{ email?: string }> };
			expect(parsed.accounts.map((account) => account.email)).toEqual(["new@example.com"]);
			return { imported: 1, skipped: 0, total: 1 };
		});
		vi.mocked(storageModule.importAccounts).mockImplementationOnce(async (filePath) => {
			const raw = await fs.promises.readFile(filePath, "utf8");
			const parsed = JSON.parse(raw) as { accounts: Array<{ email?: string }> };
			expect(parsed.accounts.map((account) => account.email)).toEqual(["new@example.com"]);
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
		vi.mocked(storageModule.previewImportAccounts).mockImplementationOnce(async (filePath) => {
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
		vi.mocked(storageModule.withAccountStorageTransaction).mockImplementationOnce(async (handler) =>
			handler(
				{
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
				},
				vi.fn(async () => {}),
			),
		);

		const { previewSyncFromCodexMultiAuth, CodexMultiAuthSyncCapacityError } = await import("../lib/codex-multi-auth-sync.js");
		await expect(previewSyncFromCodexMultiAuth(process.cwd())).rejects.toBeInstanceOf(
			CodexMultiAuthSyncCapacityError,
		);
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
			updated: 0,
		});
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
							email: "local@example.com",
							refreshToken: "rt-local",
							addedAt: 1,
							lastUsed: 1,
						},
					],
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

		const { previewSyncFromCodexMultiAuth } = await import("../lib/codex-multi-auth-sync.js");
		await expect(previewSyncFromCodexMultiAuth(process.cwd())).resolves.toMatchObject({
			accountsPath: globalPath,
			imported: 2,
			total: 4,
			skipped: 0,
		});
	});
});
