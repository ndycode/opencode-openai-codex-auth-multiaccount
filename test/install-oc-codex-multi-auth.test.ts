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

		await expect(runInstaller(["--modern", "--full", "--legacy", "--help"])).resolves.toMatchObject({
			action: "help",
			exitCode: 0,
		});

		expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("Usage: oc-codex-multi-auth"));
		expect(errorSpy).not.toHaveBeenCalled();
	});

	it("writes compact UI catalog by default, preserves user model entries, and normalizes plugin entries", async () => {
		vi.resetModules();
		tempHome = await createTempHome();
		const { runInstaller } = await import("../scripts/install-oc-codex-multi-auth-core.js");
		const configDir = join(tempHome, ".config", "opencode");
		const configPath = join(configDir, "opencode.json");

		await mkdir(configDir, { recursive: true });
		await writeFile(
			configPath,
			JSON.stringify({
				plugin: [
					"existing-plugin",
					"oc-chatgpt-multi-auth@old",
					"file:///C:/Users/neil/DevTools/pkg/npm-global/node_modules/oc-codex-multi-auth",
					"C:\\Users\\neil\\DevTools\\pkg\\npm-global\\node_modules\\oc-chatgpt-multi-auth\\dist",
				],
				provider: {
					anthropic: { baseURL: "https://example.invalid" },
					openai: {
						models: {
							old: { name: "old" },
							"gpt-5.4": { name: "stale base model" },
							"gpt-5.5-high": { name: "stale explicit preset" },
							"gpt-5.5-fast-medium": { name: "stale explicit preset" },
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
			configMode: "modern",
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
		// Template catalog ids plus the user's preserved `old` entry (deep-merge).
		// Explicit preset ids from earlier full installs are managed installer
		// output, so compact mode prunes them instead of treating them as custom.
		const expectedCount = Object.keys(modernTemplate.provider.openai.models).length + 1;
		expect(Object.keys(saved.provider.openai.models)).toHaveLength(expectedCount);
		expect(saved.provider.openai.models["gpt-5.5"]).toBeDefined();
		expect(saved.provider.openai.models["gpt-5.5-fast"]).toBeDefined();
		expect(saved.provider.openai.models["gpt-5.4"]).toBeUndefined();
		expect(saved.provider.openai.models["gpt-5.5-high"]).toBeUndefined();
		expect(saved.provider.openai.models["gpt-5.5-fast-medium"]).toBeUndefined();
		// User-added model survives deep-merge without overriding template ids.
		expect(saved.provider.openai.models["old"]).toEqual({ name: "old" });
		const configEntries = await readdir(configDir);
		expect(configEntries).toEqual(
			expect.arrayContaining([
				"opencode.json",
				expect.stringMatching(/^opencode\.json\.bak-/),
			]),
		);
	});

	it("writes the merged full catalog when --full is requested", async () => {
		vi.resetModules();
		tempHome = await createTempHome();
		const { runInstaller } = await import("../scripts/install-oc-codex-multi-auth-core.js");
		const configDir = join(tempHome, ".config", "opencode");
		const configPath = join(configDir, "opencode.json");

		await mkdir(configDir, { recursive: true });
		await writeFile(configPath, JSON.stringify({ plugin: [] }, null, 2), "utf-8");

		await expect(
			runInstaller(["--full", "--no-cache-clear"], {
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

		const saved = JSON.parse(await readFile(configPath, "utf-8")) as OpenAiTemplate;
		const modernTemplate = JSON.parse(
			await readFile(new URL("../config/opencode-modern.json", import.meta.url), "utf-8"),
		) as OpenAiTemplate;
		const legacyTemplate = JSON.parse(
			await readFile(new URL("../config/opencode-legacy.json", import.meta.url), "utf-8"),
		) as OpenAiTemplate;
		const expectedCount = Object.keys(modernTemplate.provider.openai.models).length
			+ Object.keys(legacyTemplate.provider.openai.models).length;

		expect(Object.keys(saved.provider.openai.models)).toHaveLength(expectedCount);
		expect(saved.provider.openai.models["gpt-5.5"]).toBeDefined();
		expect(saved.provider.openai.models["gpt-5.5-high"]).toBeDefined();
		expect(saved.provider.openai.models["gpt-5.5-fast"]).toBeDefined();
		expect(saved.provider.openai.models["gpt-5.5-fast-medium"]).toBeDefined();
	});

	it("merges tui.json plugin entries without clobbering plugin_enabled", async () => {
		vi.resetModules();
		tempHome = await createTempHome();
		const { runInstaller } = await import("../scripts/install-oc-codex-multi-auth-core.js");
		const configDir = join(tempHome, ".config", "opencode");
		const configPath = join(configDir, "opencode.json");
		const tuiConfigPath = join(configDir, "tui.json");

		await mkdir(configDir, { recursive: true });
		await writeFile(configPath, JSON.stringify({ plugin: [] }, null, 2), "utf-8");
		await writeFile(
			tuiConfigPath,
			JSON.stringify(
				{
					plugin: [
						"other-tui-plugin",
						"oc-chatgpt-multi-auth@old",
						"file:///C:/Users/neil/pkg/node_modules/oc-codex-multi-auth",
					],
					plugin_enabled: {
						"other.id": false,
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
			tuiConfigPath,
		});

		const saved = JSON.parse(await readFile(tuiConfigPath, "utf-8")) as {
			$schema: string;
			plugin: string[];
			plugin_enabled: Record<string, boolean>;
		};
		expect(saved.$schema).toBe("https://opencode.ai/tui.json");
		expect(saved.plugin).toEqual(["other-tui-plugin", "oc-codex-multi-auth"]);
		expect(saved.plugin_enabled).toEqual({ "other.id": false });
		const configEntries = await readdir(configDir);
		expect(configEntries).toEqual(
			expect.arrayContaining([
				"tui.json",
				expect.stringMatching(/^tui\.json\.bak-/),
			]),
		);
	});

	it("parses BOM-prefixed existing config and preserves custom keys on merge", async () => {
		vi.resetModules();
		tempHome = await createTempHome();
		const { runInstaller } = await import("../scripts/install-oc-codex-multi-auth-core.js");
		const configDir = join(tempHome, ".config", "opencode");
		const configPath = join(configDir, "opencode.json");

		await mkdir(configDir, { recursive: true });
		const existing = {
			plugin: ["some-other-plugin"],
			provider: {
				openai: {
					myCustomKey: "preserve-me",
					models: {
						"user-only-model": { name: "User Only Model" },
					},
				},
			},
		};
		await writeFile(configPath, `\uFEFF${JSON.stringify(existing, null, 2)}`, "utf-8");

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
			exitCode: 0,
		});

		const saved = JSON.parse(await readFile(configPath, "utf-8")) as {
			plugin: string[];
			provider: {
				openai: {
					myCustomKey?: string;
					models: Record<string, unknown>;
				};
			};
		};

		expect(saved.plugin).toEqual(expect.arrayContaining(["some-other-plugin", "oc-codex-multi-auth"]));
		expect(saved.provider.openai.myCustomKey).toBe("preserve-me");
		expect(saved.provider.openai.models["user-only-model"]).toBeDefined();
		expect(saved.provider.openai.models["gpt-5.5"]).toBeDefined();
	});

	it("parses BOM-less existing config and preserves custom keys on merge", async () => {
		vi.resetModules();
		tempHome = await createTempHome();
		const { runInstaller } = await import("../scripts/install-oc-codex-multi-auth-core.js");
		const configDir = join(tempHome, ".config", "opencode");
		const configPath = join(configDir, "opencode.json");

		await mkdir(configDir, { recursive: true });
		await writeFile(
			configPath,
			JSON.stringify(
				{
					plugin: ["some-other-plugin"],
					provider: {
						openai: {
							myCustomKey: "preserve-me",
							models: {
								"user-only-model": { name: "User Only Model" },
							},
						},
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
			exitCode: 0,
		});

		const saved = JSON.parse(await readFile(configPath, "utf-8")) as {
			provider: {
				openai: {
					myCustomKey?: string;
					models: Record<string, unknown>;
				};
			};
		};

		expect(saved.provider.openai.myCustomKey).toBe("preserve-me");
		expect(saved.provider.openai.models["user-only-model"]).toBeDefined();
		expect(saved.provider.openai.models["gpt-5.5"]).toBeDefined();
	});

	it("deep-merges provider.openai preserving user customizations while overwriting managed keys", async () => {
		vi.resetModules();
		tempHome = await createTempHome();
		const { runInstaller } = await import("../scripts/install-oc-codex-multi-auth-core.js");
		const configDir = join(tempHome, ".config", "opencode");
		const configPath = join(configDir, "opencode.json");

		await mkdir(configDir, { recursive: true });
		await writeFile(
			configPath,
			JSON.stringify({
				provider: {
					openai: {
						baseURL: "https://legacy.example.com",
						apiKey: "{env:OPENAI_API_KEY}",
						myCustomKey: "preserved",
						nested: { foo: "bar" },
						options: { textVerbosity: "low" },
						models: {
							"gpt-5.5": { name: "user override" },
							"my-fine-tune": { name: "custom user model" },
						},
					},
				},
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
			exitCode: 0,
		});

		const saved = JSON.parse(await readFile(configPath, "utf-8")) as {
			provider: {
				openai: Record<string, unknown> & {
					options?: Record<string, unknown>;
					models?: Record<string, unknown>;
				};
			};
		};

		// Managed keys overwritten: baseURL / apiKey removed (template does not set
		// them), options replaced with template value, models.gpt-5.5 reset to template.
		expect(saved.provider.openai.baseURL).toBeUndefined();
		expect(saved.provider.openai.apiKey).toBeUndefined();
		expect(saved.provider.openai.options).not.toEqual({ textVerbosity: "low" });
		expect(saved.provider.openai.models?.["gpt-5.5"]).not.toEqual({ name: "user override" });

		// Non-managed keys preserved as-is.
		expect(saved.provider.openai.myCustomKey).toBe("preserved");
		expect(saved.provider.openai.nested).toEqual({ foo: "bar" });

		// User-added model surviving deep-merge.
		expect(saved.provider.openai.models?.["my-fine-tune"]).toEqual({ name: "custom user model" });
	});

	it("dry-run does not write and prints a diff to stdout", async () => {
		vi.resetModules();
		tempHome = await createTempHome();
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const { runInstaller } = await import("../scripts/install-oc-codex-multi-auth-core.js");
		const configDir = join(tempHome, ".config", "opencode");
		const configPath = join(configDir, "opencode.json");

		await mkdir(configDir, { recursive: true });
		await writeFile(
			configPath,
			JSON.stringify({
				plugin: ["existing-plugin"],
				provider: {
					openai: {
						models: { "pre-existing": { name: "pre-existing" } },
					},
				},
			}, null, 2),
			"utf-8",
		);

		const result = await runInstaller(["--dry-run", "--no-cache-clear"], {
			env: {
				...process.env,
				HOME: tempHome,
				USERPROFILE: tempHome,
			},
		});

		expect(result).toMatchObject({ action: "install", dryRun: true, wrote: false, exitCode: 0 });

		const stdout = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
		expect(stdout).toContain("[dry-run] Diff for");
		expect(stdout).toContain("provider");
		expect(stdout).toContain("--- existing");
		expect(stdout).toContain("+++ proposed");

		// Disk state must remain the literal prior contents (no overwrite, no backup write).
		const onDisk = JSON.parse(await readFile(configPath, "utf-8")) as {
			plugin: string[];
			provider: { openai: { models: Record<string, unknown> } };
		};
		expect(onDisk.plugin).toEqual(["existing-plugin"]);
		expect(onDisk.provider.openai.models["pre-existing"]).toBeDefined();
		const entries = await readdir(configDir);
		expect(entries).toEqual(["opencode.json"]);
	});

	it("formatConfigDiff unit: emits proposed markers when there is no existing config", async () => {
		vi.resetModules();
		const { __test } = await import("../scripts/install-oc-codex-multi-auth-core.js");
		const diff = __test.formatConfigDiff(undefined, { provider: { openai: { models: {} } } });
		expect(diff).toContain("--- existing");
		expect(diff).toContain("+++ proposed");
		expect(diff).toContain("- (no existing config)");
		expect(diff).toContain("+ ");
		expect(diff).toContain("provider");
	});

	it("mergeOpenaiProvider unit: strips unknown managed keys even when template omits them", async () => {
		vi.resetModules();
		const { __test } = await import("../scripts/install-oc-codex-multi-auth-core.js");
		const merged = __test.mergeOpenaiProvider(
			{
				baseURL: "https://legacy.example.com",
				apiKey: "user-secret",
				options: { textVerbosity: "low" },
				myCustomKey: "keep",
				models: {
					shared: { name: "user-shared" },
					userOnly: { name: "user-only" },
				},
			},
			{
				options: { textVerbosity: "medium" },
				models: {
					shared: { name: "template-shared" },
					templateOnly: { name: "template-only" },
				},
			},
		);
		expect(merged.baseURL).toBeUndefined();
		expect(merged.apiKey).toBeUndefined();
		expect(merged.options).toEqual({ textVerbosity: "medium" });
		expect(merged.myCustomKey).toBe("keep");
		expect(merged.models).toEqual({
			shared: { name: "template-shared" },
			userOnly: { name: "user-only" },
			templateOnly: { name: "template-only" },
		});
	});

	it("mergeOpenaiProvider unit: prunes known managed model keys while preserving custom models", async () => {
		vi.resetModules();
		const { __test } = await import("../scripts/install-oc-codex-multi-auth-core.js");
		const merged = __test.mergeOpenaiProvider(
			{
				models: {
					"gpt-5.5-high": { name: "stale explicit preset" },
					"userOnly": { name: "custom user model" },
				},
			},
			{
				models: {
					"gpt-5.5": { name: "compact base model" },
				},
			},
			{
				modelKeysToRemove: new Set(["gpt-5.5-high"]),
			},
		);

		expect(merged.models).toEqual({
			userOnly: { name: "custom user model" },
			"gpt-5.5": { name: "compact base model" },
		});
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
			configMode: "modern",
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

	it("clears OpenCode node_modules and package cache layouts", async () => {
		vi.resetModules();
		tempHome = await createTempHome();
		const { runInstaller } = await import("../scripts/install-oc-codex-multi-auth-core.js");
		const configDir = join(tempHome, ".config", "opencode");
		const configPath = join(configDir, "opencode.json");
		const cacheDir = join(tempHome, ".cache", "opencode");
		const legacyCacheNodeModules = join(cacheDir, "node_modules", "oc-chatgpt-multi-auth");
		const cacheNodeModules = join(cacheDir, "node_modules", "oc-codex-multi-auth");
		const legacyCachePackage = join(cacheDir, "packages", "oc-chatgpt-multi-auth@latest");
		const cachePackage = join(cacheDir, "packages", "oc-codex-multi-auth@latest");
		const cacheBunLock = join(cacheDir, "bun.lock");
		const cachePackageJson = join(cacheDir, "package.json");

		await mkdir(configDir, { recursive: true });
		await mkdir(cacheNodeModules, { recursive: true });
		await mkdir(legacyCacheNodeModules, { recursive: true });
		await mkdir(cachePackage, { recursive: true });
		await mkdir(legacyCachePackage, { recursive: true });
		await writeFile(configPath, JSON.stringify({ plugin: [] }, null, 2), "utf-8");
		await writeFile(join(cacheNodeModules, "package.json"), "{}", "utf-8");
		await writeFile(join(legacyCacheNodeModules, "package.json"), "{}", "utf-8");
		await writeFile(join(cachePackage, "package.json"), "{}", "utf-8");
		await writeFile(join(legacyCachePackage, "package.json"), "{}", "utf-8");
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
			runInstaller([], {
				env: {
					...process.env,
					HOME: tempHome,
					USERPROFILE: tempHome,
				},
			}),
		).resolves.toMatchObject({
			action: "install",
			configMode: "modern",
			exitCode: 0,
		});

		await expect(readdir(cacheNodeModules)).rejects.toMatchObject({ code: "ENOENT" });
		await expect(readdir(legacyCacheNodeModules)).rejects.toMatchObject({ code: "ENOENT" });
		await expect(readdir(cachePackage)).rejects.toMatchObject({ code: "ENOENT" });
		await expect(readdir(legacyCachePackage)).rejects.toMatchObject({ code: "ENOENT" });
		await expect(readFile(cacheBunLock, "utf-8")).rejects.toMatchObject({ code: "ENOENT" });

		const cachedPackageJson = JSON.parse(await readFile(cachePackageJson, "utf-8")) as {
			dependencies: Record<string, string>;
		};
		expect(cachedPackageJson.dependencies["oc-chatgpt-multi-auth"]).toBeUndefined();
		expect(cachedPackageJson.dependencies["oc-codex-multi-auth"]).toBeUndefined();
		expect(cachedPackageJson.dependencies.other).toBe("^1.0.0");
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
