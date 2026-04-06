import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

type OpenAiTemplate = {
	provider: {
		openai: {
			models: Record<string, unknown>;
		};
	};
};

async function createTempHome() {
	return mkdtemp(join(tmpdir(), "oc-codex-install-"));
}

describe("install-oc-codex-multi-auth script", () => {
	let tempHome: string | null = null;

	afterEach(async () => {
		vi.restoreAllMocks();
		vi.doUnmock("node:fs/promises");
		if (tempHome) {
			await rm(tempHome, { recursive: true, force: true });
			tempHome = null;
		}
	});

	it("shows help even when conflicting mode flags are present", async () => {
		vi.resetModules();
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const { runInstaller } = await import("../scripts/install-oc-codex-multi-auth-core.js");

		await expect(runInstaller(["--modern", "--legacy", "--help"])).resolves.toMatchObject({
			action: "help",
			exitCode: 0,
		});

		expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("Usage: oc-codex-multi-auth"));
		expect(errorSpy).not.toHaveBeenCalled();
	});

	it("writes the merged full catalog and normalizes plugin entries", async () => {
		vi.resetModules();
		tempHome = await createTempHome();
		const { runInstaller } = await import("../scripts/install-oc-codex-multi-auth-core.js");
		const configDir = join(tempHome, ".config", "opencode");
		const configPath = join(configDir, "opencode.json");

		await mkdir(configDir, { recursive: true });
		await writeFile(
			configPath,
			JSON.stringify({
				plugin: ["existing-plugin", "oc-chatgpt-multi-auth@old"],
				provider: {
					anthropic: { baseURL: "https://example.invalid" },
					openai: {
						models: {
							old: { name: "old" },
						},
					},
				},
				customSetting: true,
			}, null, 2),
			"utf-8",
		);

		await expect(
			runInstaller(["--no-cache-clear"], {
				env: {
					...process.env,
					HOME: tempHome,
					USERPROFILE: tempHome,
				},
			}),
		).resolves.toMatchObject({
			action: "install",
			configMode: "full",
			exitCode: 0,
		});

		const saved = JSON.parse(await readFile(configPath, "utf-8")) as {
			customSetting: boolean;
			plugin: string[];
			provider: {
				anthropic: { baseURL: string };
				openai: { models: Record<string, unknown> };
			};
		};

		expect(saved.customSetting).toBe(true);
		expect(saved.plugin).toEqual(["existing-plugin", "oc-codex-multi-auth"]);
		expect(saved.provider.anthropic).toEqual({ baseURL: "https://example.invalid" });
		const modernTemplate = JSON.parse(
			await readFile(new URL("../config/opencode-modern.json", import.meta.url), "utf-8"),
		) as OpenAiTemplate;
		const legacyTemplate = JSON.parse(
			await readFile(new URL("../config/opencode-legacy.json", import.meta.url), "utf-8"),
		) as OpenAiTemplate;
		const expectedCount = Object.keys(modernTemplate.provider.openai.models).length
			+ Object.keys(legacyTemplate.provider.openai.models).length;
		expect(Object.keys(saved.provider.openai.models)).toHaveLength(expectedCount);
		expect(saved.provider.openai.models["gpt-5.4"]).toBeDefined();
		expect(saved.provider.openai.models["gpt-5.4-high"]).toBeDefined();
		const configEntries = await readdir(configDir);
		expect(configEntries).toEqual(
			expect.arrayContaining([
				"opencode.json",
				expect.stringMatching(/^opencode\.json\.bak-/),
			]),
		);
	});

	it("keeps cache files when --no-cache-clear is set but still unpins the cached package entry", async () => {
		vi.resetModules();
		tempHome = await createTempHome();
		const { runInstaller } = await import("../scripts/install-oc-codex-multi-auth-core.js");
		const configDir = join(tempHome, ".config", "opencode");
		const configPath = join(configDir, "opencode.json");
		const cacheDir = join(tempHome, ".cache", "opencode");
		const legacyCacheNodeModules = join(cacheDir, "node_modules", "oc-chatgpt-multi-auth");
		const cacheNodeModules = join(cacheDir, "node_modules", "oc-codex-multi-auth");
		const cacheBunLock = join(cacheDir, "bun.lock");
		const cachePackageJson = join(cacheDir, "package.json");

		await mkdir(configDir, { recursive: true });
		await mkdir(cacheNodeModules, { recursive: true });
		await mkdir(legacyCacheNodeModules, { recursive: true });
		await writeFile(configPath, JSON.stringify({ plugin: [] }, null, 2), "utf-8");
		await writeFile(cacheBunLock, "lockfile", "utf-8");
		await writeFile(
			cachePackageJson,
			JSON.stringify(
				{
					dependencies: {
						"oc-chatgpt-multi-auth": "file:../pinned-plugin.tgz",
						"oc-codex-multi-auth": "file:../new-plugin.tgz",
						other: "^1.0.0",
					},
				},
				null,
				2,
			),
			"utf-8",
		);

		await expect(
			runInstaller(["--no-cache-clear"], {
				env: {
					...process.env,
					HOME: tempHome,
					USERPROFILE: tempHome,
				},
			}),
		).resolves.toMatchObject({
			action: "install",
			configMode: "full",
			exitCode: 0,
		});

		await expect(readFile(cacheBunLock, "utf-8")).resolves.toBe("lockfile");
		await expect(readdir(cacheNodeModules)).resolves.toEqual([]);
		await expect(readdir(legacyCacheNodeModules)).resolves.toEqual([]);
		const cachePackage = JSON.parse(await readFile(cachePackageJson, "utf-8")) as {
			dependencies: Record<string, string>;
		};
		expect(cachePackage.dependencies["oc-chatgpt-multi-auth"]).toBeUndefined();
		expect(cachePackage.dependencies["oc-codex-multi-auth"]).toBeUndefined();
		expect(cachePackage.dependencies.other).toBe("^1.0.0");
	});

	it("rejects full-mode merges when modern and legacy templates overlap", async () => {
		vi.resetModules();
		const { __test } = await import("../scripts/install-oc-codex-multi-auth-core.js");

		const modernTemplate = {
			provider: {
				openai: {
					models: {
						"gpt-5.4": { name: "base" },
					},
				},
			},
		};
		const legacyTemplate = {
			provider: {
				openai: {
					models: {
						"gpt-5.4": { name: "preset" },
					},
				},
			},
		};

		expect(() => __test.mergeFullTemplate(modernTemplate, legacyTemplate)).toThrow(
			/Full config template collision/,
		);
	});

	it("retries backup copies after transient Windows lock errors", async () => {
		vi.resetModules();
		tempHome = await createTempHome();
		const sourcePath = join(tempHome, "opencode.json");
		const copyFileMock = vi.fn()
			.mockRejectedValueOnce(Object.assign(new Error("busy"), { code: "EBUSY" }))
			.mockResolvedValue(undefined);

		vi.doMock("node:fs/promises", async () => {
			const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
			return {
				...actual,
				copyFile: copyFileMock,
			};
		});

		const { __test } = await import("../scripts/install-oc-codex-multi-auth-core.js");
		const backupPath = await __test.backupConfig(sourcePath, false);

		expect(copyFileMock).toHaveBeenCalledTimes(2);
		expect(copyFileMock).toHaveBeenNthCalledWith(1, sourcePath, backupPath);
		expect(copyFileMock).toHaveBeenNthCalledWith(2, sourcePath, backupPath);
		expect(backupPath).toMatch(/opencode\.json\.bak-/);
	});

	it("retries atomic rename after transient Windows lock errors", async () => {
		vi.resetModules();
		const renameMock = vi.fn()
			.mockRejectedValueOnce(Object.assign(new Error("locked"), { code: "EPERM" }))
			.mockResolvedValue(undefined);

		vi.doMock("node:fs/promises", async () => {
			const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
			return {
				...actual,
				rename: renameMock,
			};
		});

		const { __test } = await import("../scripts/install-oc-codex-multi-auth-core.js");
		await expect(__test.renameWithWindowsRetry("from.tmp", "to.json")).resolves.toBeUndefined();
		expect(renameMock).toHaveBeenCalledTimes(2);
		expect(renameMock).toHaveBeenNthCalledWith(1, "from.tmp", "to.json");
		expect(renameMock).toHaveBeenNthCalledWith(2, "from.tmp", "to.json");
	});
});
