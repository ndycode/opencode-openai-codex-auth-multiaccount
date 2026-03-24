import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function createTempHome() {
	return mkdtemp(join(tmpdir(), "oc-chatgpt-install-"));
}

describe("install-opencode-codex-auth script", () => {
	let tempHome: string | null = null;

	afterEach(async () => {
		vi.restoreAllMocks();
		if (tempHome) {
			await rm(tempHome, { recursive: true, force: true });
			tempHome = null;
		}
	});

	it("shows help even when conflicting mode flags are present", async () => {
		vi.resetModules();
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const { runInstaller } = await import("../scripts/install-opencode-codex-auth.js");

		await expect(runInstaller(["--modern", "--legacy", "--help"])).resolves.toMatchObject({
			action: "help",
			exitCode: 0,
		});

		expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("Usage: oc-chatgpt-multi-auth"));
		expect(errorSpy).not.toHaveBeenCalled();
	});

	it("writes the merged full catalog and normalizes plugin entries", async () => {
		vi.resetModules();
		tempHome = await createTempHome();
		const { runInstaller } = await import("../scripts/install-opencode-codex-auth.js");
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
		expect(saved.plugin).toEqual(["existing-plugin", "oc-chatgpt-multi-auth"]);
		expect(saved.provider.anthropic).toEqual({ baseURL: "https://example.invalid" });
		expect(Object.keys(saved.provider.openai.models)).toHaveLength(43);
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
		const { runInstaller } = await import("../scripts/install-opencode-codex-auth.js");
		const configDir = join(tempHome, ".config", "opencode");
		const configPath = join(configDir, "opencode.json");
		const cacheDir = join(tempHome, ".cache", "opencode");
		const cacheNodeModules = join(cacheDir, "node_modules", "oc-chatgpt-multi-auth");
		const cacheBunLock = join(cacheDir, "bun.lock");
		const cachePackageJson = join(cacheDir, "package.json");

		await mkdir(configDir, { recursive: true });
		await mkdir(cacheNodeModules, { recursive: true });
		await writeFile(configPath, JSON.stringify({ plugin: [] }, null, 2), "utf-8");
		await writeFile(cacheBunLock, "lockfile", "utf-8");
		await writeFile(
			cachePackageJson,
			JSON.stringify(
				{
					dependencies: {
						"oc-chatgpt-multi-auth": "file:../pinned-plugin.tgz",
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
		const cachePackage = JSON.parse(await readFile(cachePackageJson, "utf-8")) as {
			dependencies: Record<string, string>;
		};
		expect(cachePackage.dependencies["oc-chatgpt-multi-auth"]).toBeUndefined();
		expect(cachePackage.dependencies.other).toBe("^1.0.0");
	});
});
