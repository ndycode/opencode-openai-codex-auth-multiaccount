import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
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

		expect(() =>
			savePluginConfigMutation((current) => ({
				...current,
				experimental: { syncFromCodexMultiAuth: { enabled: true } },
			})),
		).not.toThrow();

		expect(lockAttempts).toBeGreaterThanOrEqual(2);
		expect(mockWriteFileSync).toHaveBeenCalled();
		expect(vi.mocked(logger.logWarn)).not.toHaveBeenCalled();
	});
});
