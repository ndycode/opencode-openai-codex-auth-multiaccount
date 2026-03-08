import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as logger from "../lib/logger.js";

vi.mock("node:fs", async () => {
	const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
	return {
		...actual,
		existsSync: vi.fn(),
		readFileSync: vi.fn(),
		mkdirSync: vi.fn(),
		renameSync: vi.fn(),
		unlinkSync: vi.fn(),
		writeFileSync: vi.fn(),
	};
});

vi.mock("../lib/logger.js", async () => {
	const actual = await vi.importActual<typeof import("../lib/logger.js")>("../lib/logger.js");
	return {
		...actual,
		logWarn: vi.fn(),
	};
});

describe("plugin config lock retry", () => {
	const mockExistsSync = vi.mocked(fs.existsSync);
	const mockReadFileSync = vi.mocked(fs.readFileSync);
	const mockMkdirSync = vi.mocked(fs.mkdirSync);
	const mockRenameSync = vi.mocked(fs.renameSync);
	const mockUnlinkSync = vi.mocked(fs.unlinkSync);
	const mockWriteFileSync = vi.mocked(fs.writeFileSync);
	const originalPlatform = process.platform;

	beforeEach(() => {
		vi.resetModules();
		vi.clearAllMocks();
		mockExistsSync.mockReturnValue(false);
		mockReadFileSync.mockReturnValue("{}");
		mockMkdirSync.mockImplementation(() => undefined);
		mockRenameSync.mockImplementation(() => undefined);
		mockUnlinkSync.mockImplementation(() => undefined);
	});

	afterEach(() => {
		vi.restoreAllMocks();
		Object.defineProperty(process, "platform", { value: originalPlatform });
	});

	it("retries transient EPERM when taking the lock on Windows", async () => {
		Object.defineProperty(process, "platform", { value: "win32" });

		let lockAttempts = 0;
		mockWriteFileSync.mockImplementation((filePath) => {
			const path = String(filePath);
			if (path.endsWith(".lock")) {
				lockAttempts += 1;
				if (lockAttempts === 1) {
					const error = new Error("lock busy") as NodeJS.ErrnoException;
					error.code = "EPERM";
					throw error;
				}
			}
			return undefined;
		});

		const { savePluginConfigMutation } = await import("../lib/config.js");

		await expect(
			savePluginConfigMutation((current) => ({
				...current,
				experimental: { syncFromCodexMultiAuth: { enabled: true } },
			})),
		).resolves.toBeUndefined();

		expect(lockAttempts).toBeGreaterThanOrEqual(2);
		expect(mockWriteFileSync).toHaveBeenCalled();
		expect(vi.mocked(logger.logWarn)).not.toHaveBeenCalled();
	});

	it("does not steal a live lock that replaced a stale one before rename", async () => {
		Object.defineProperty(process, "platform", { value: "win32" });
		const configPath = path.join(os.homedir(), ".opencode", "openai-codex-auth-config.json");
		const lockPath = `${configPath}.lock`;
		let lockAttempts = 0;
		let lockFilePresent = true;
		const killSpy = vi.spyOn(process, "kill").mockImplementation((pid) => {
			if (pid === 111) {
				const error = new Error("process not found") as NodeJS.ErrnoException;
				error.code = "ESRCH";
				throw error;
			}
			return true as never;
		});

		mockExistsSync.mockImplementation((filePath) => String(filePath) === lockPath && lockFilePresent);
		mockReadFileSync.mockImplementation((filePath: fs.PathOrFileDescriptor) => {
			const path = String(filePath);
			if (path === lockPath) {
				return lockAttempts === 1 ? "111" : "{}";
			}
			if (path.includes(".stale")) {
				return "222";
			}
			return "{}";
		});
		mockRenameSync.mockImplementation((source, destination) => {
			if (String(source) === lockPath) {
				lockFilePresent = false;
			}
			if (String(destination) === lockPath) {
				lockFilePresent = true;
			}
			return undefined;
		});
		mockWriteFileSync.mockImplementation((filePath) => {
			const path = String(filePath);
			if (path === lockPath) {
				lockAttempts += 1;
				if (lockAttempts === 1) {
					const error = new Error("exists") as NodeJS.ErrnoException;
					error.code = "EEXIST";
					throw error;
				}
			}
			return undefined;
		});

		const { savePluginConfigMutation } = await import("../lib/config.js");

		try {
			await expect(
				savePluginConfigMutation((current) => ({
					...current,
					experimental: { syncFromCodexMultiAuth: { enabled: true } },
				})),
			).resolves.toBeUndefined();
			const lockRenameCalls = mockRenameSync.mock.calls.filter(
				([source, destination]) =>
					String(source) === lockPath || String(destination) === lockPath,
			);
			expect(lockRenameCalls).toHaveLength(2);
			expect(String(lockRenameCalls[0]?.[0])).toBe(lockPath);
			expect(String(lockRenameCalls[1]?.[1])).toBe(lockPath);
			expect(killSpy).toHaveBeenCalledWith(111, 0);
		} finally {
			killSpy.mockRestore();
		}
	});

	it("recovers stale locks on Windows when the pid probe returns EPERM", async () => {
		Object.defineProperty(process, "platform", { value: "win32" });
		const configPath = path.join(os.homedir(), ".opencode", "openai-codex-auth-config.json");
		const lockPath = `${configPath}.lock`;
		let lockAttempts = 0;
		let lockFilePresent = true;
		const killSpy = vi.spyOn(process, "kill").mockImplementation(() => {
			const error = new Error("permission denied") as NodeJS.ErrnoException;
			error.code = "EPERM";
			throw error;
		});

		mockExistsSync.mockImplementation((filePath) => String(filePath) === lockPath && lockFilePresent);
		mockReadFileSync.mockImplementation((filePath: fs.PathOrFileDescriptor) => {
			const pathValue = String(filePath);
			if (pathValue === lockPath) {
				return "111";
			}
			if (pathValue.includes(".stale")) {
				return "111";
			}
			return "{}";
		});
		mockRenameSync.mockImplementation((source, destination) => {
			if (String(source) === lockPath) {
				lockFilePresent = false;
			}
			if (String(destination) === lockPath) {
				lockFilePresent = true;
			}
			return undefined;
		});
		mockWriteFileSync.mockImplementation((filePath) => {
			const pathValue = String(filePath);
			if (pathValue === lockPath) {
				lockAttempts += 1;
				if (lockAttempts === 1) {
					const error = new Error("exists") as NodeJS.ErrnoException;
					error.code = "EEXIST";
					throw error;
				}
			}
			return undefined;
		});

		const { savePluginConfigMutation } = await import("../lib/config.js");

		try {
			await expect(
				savePluginConfigMutation((current) => ({
					...current,
					experimental: { syncFromCodexMultiAuth: { enabled: true } },
				})),
			).resolves.toBeUndefined();
			expect(killSpy).toHaveBeenCalledWith(111, 0);
			expect(mockRenameSync).toHaveBeenCalled();
		} finally {
			killSpy.mockRestore();
		}
	});
});
