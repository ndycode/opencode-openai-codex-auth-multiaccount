#!/usr/bin/env node

import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PLUGIN_NAME = "oc-chatgpt-multi-auth";
const WINDOWS_RENAME_RETRY_ATTEMPTS = 5;
const WINDOWS_RENAME_RETRY_BASE_DELAY_MS = 10;

function printHelp() {
	console.log(`Usage: ${PLUGIN_NAME} [--modern|--legacy] [--dry-run] [--no-cache-clear]\n\n` +
		"Default behavior:\n" +
		"  - Installs/updates global config at ~/.config/opencode/opencode.json\n" +
		"  - Uses full catalog config by default (9 base models + 34 explicit presets)\n" +
		"  - Ensures plugin is unpinned (latest)\n" +
		"  - Clears OpenCode plugin cache\n\n" +
		"Options:\n" +
		"  --modern           Force compact modern config (9 base models + --variant presets)\n" +
		"  --legacy           Force explicit legacy config (34 preset model entries)\n" +
		"  --dry-run          Show actions without writing\n" +
		"  --no-cache-clear   Skip clearing OpenCode cache\n"
	);
}

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const modernTemplatePath = join(repoRoot, "config", "opencode-modern.json");
const legacyTemplatePath = join(repoRoot, "config", "opencode-legacy.json");

function log(message) {
	console.log(message);
}

function delay(ms) {
	return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

function isWindowsLockError(error) {
	const code = error?.code;
	return code === "EPERM" || code === "EBUSY";
}

function formatErrorForLog(error) {
	if (error instanceof Error) {
		return error.message;
	}
	return String(error);
}

function resolveHomeDirectory(env = process.env) {
	return env.HOME || env.USERPROFILE || homedir();
}

function buildPaths(homeDir) {
	const configDir = join(homeDir, ".config", "opencode");
	const cacheDir = join(homeDir, ".cache", "opencode");
	return {
		configDir,
		configPath: join(configDir, "opencode.json"),
		cacheDir,
		cacheNodeModules: join(cacheDir, "node_modules", PLUGIN_NAME),
		cacheBunLock: join(cacheDir, "bun.lock"),
		cachePackageJson: join(cacheDir, "package.json"),
		modernTemplatePath,
		legacyTemplatePath,
	};
}

function parseCliArgs(argv = process.argv.slice(2)) {
	const args = new Set(argv);
	if (args.has("--help") || args.has("-h")) {
		return {
			wantsHelp: true,
		};
	}

	const requestedModern = args.has("--modern");
	const requestedLegacy = args.has("--legacy");

	if (requestedModern && requestedLegacy) {
		throw new Error("Choose only one of --modern or --legacy.");
	}

	return {
		wantsHelp: false,
		dryRun: args.has("--dry-run"),
		skipCacheClear: args.has("--no-cache-clear"),
		configMode: requestedModern ? "modern" : requestedLegacy ? "legacy" : "full",
	};
}

function normalizePluginList(list) {
	const entries = Array.isArray(list) ? list.filter(Boolean) : [];
	const filtered = entries.filter((entry) => {
		if (typeof entry !== "string") return true;
		return entry !== PLUGIN_NAME && !entry.startsWith(`${PLUGIN_NAME}@`);
	});
	return [...filtered, PLUGIN_NAME];
}

function formatJson(obj) {
	return `${JSON.stringify(obj, null, 2)}\n`;
}

function isPlainObject(value) {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

function mergeOpenAiConfig(existingOpenAi, templateOpenAi) {
	const existingConfig = isPlainObject(existingOpenAi) ? existingOpenAi : {};
	const templateConfig = isPlainObject(templateOpenAi) ? templateOpenAi : {};
	const existingModels = isPlainObject(existingConfig.models) ? existingConfig.models : {};
	const templateModels = isPlainObject(templateConfig.models) ? templateConfig.models : {};

	return {
		...existingConfig,
		...templateConfig,
		models: {
			...existingModels,
			...templateModels,
		},
	};
}

function mergeFullTemplate(modernTemplate, legacyTemplate) {
	const modernModels = modernTemplate.provider?.openai?.models ?? {};
	const legacyModels = legacyTemplate.provider?.openai?.models ?? {};
	const overlappingKeys = Object.keys(modernModels).filter((key) => Object.hasOwn(legacyModels, key));

	if (overlappingKeys.length > 0) {
		throw new Error(`Full config template collision for model keys: ${overlappingKeys.join(", ")}`);
	}

	return {
		...modernTemplate,
		provider: {
			...(modernTemplate.provider ?? {}),
			openai: {
				...(modernTemplate.provider?.openai ?? {}),
				models: {
					...modernModels,
					...legacyModels,
				},
			},
		},
	};
}

async function readJson(filePath) {
	const content = await readFile(filePath, "utf-8");
	return JSON.parse(content);
}

async function renameWithWindowsRetry(sourcePath, destinationPath) {
	let lastError = null;

	for (let attempt = 0; attempt < WINDOWS_RENAME_RETRY_ATTEMPTS; attempt += 1) {
		try {
			await rename(sourcePath, destinationPath);
			return;
		} catch (error) {
			if (isWindowsLockError(error)) {
				// Windows desktop installs often see brief AV/indexer locks on config
				// files, so retry the atomic rename before surfacing a hard failure.
				lastError = error;
				await delay(WINDOWS_RENAME_RETRY_BASE_DELAY_MS * 2 ** attempt);
				continue;
			}
			throw error;
		}
	}

	if (lastError) {
		throw lastError;
	}
}

async function writeFileAtomic(filePath, content) {
	const uniqueSuffix = `${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
	const tempPath = `${filePath}.${uniqueSuffix}.tmp`;

	try {
		await mkdir(dirname(filePath), { recursive: true });
		await writeFile(tempPath, content, { encoding: "utf-8", mode: 0o600 });
		await renameWithWindowsRetry(tempPath, filePath);
	} catch (error) {
		await rm(tempPath, { force: true }).catch(() => {});
		throw error;
	}
}

async function loadTemplate(mode, paths) {
	if (mode === "modern") {
		return readJson(paths.modernTemplatePath);
	}
	if (mode === "legacy") {
		return readJson(paths.legacyTemplatePath);
	}

	const [modernTemplate, legacyTemplate] = await Promise.all([
		readJson(paths.modernTemplatePath),
		readJson(paths.legacyTemplatePath),
	]);

	return mergeFullTemplate(modernTemplate, legacyTemplate);
}

async function copyFileWithWindowsRetry(sourcePath, destinationPath) {
	let lastError = null;

	for (let attempt = 0; attempt < WINDOWS_RENAME_RETRY_ATTEMPTS; attempt += 1) {
		try {
			await copyFile(sourcePath, destinationPath);
			return;
		} catch (error) {
			if (isWindowsLockError(error)) {
				lastError = error;
				await delay(WINDOWS_RENAME_RETRY_BASE_DELAY_MS * 2 ** attempt);
				continue;
			}
			throw error;
		}
	}

	if (lastError) {
		throw lastError;
	}
}

async function backupConfig(sourcePath, dryRun) {
	const timestamp = new Date()
		.toISOString()
		.replace(/[:.]/g, "-")
		.replace("T", "_")
		.replace("Z", "");
	const backupPath = `${sourcePath}.bak-${timestamp}`;
	if (!dryRun) {
		await copyFileWithWindowsRetry(sourcePath, backupPath);
	}
	return backupPath;
}

async function removePluginFromCachePackage(paths, dryRun) {
	if (!existsSync(paths.cachePackageJson)) {
		return;
	}

	let cacheData;
	try {
		cacheData = await readJson(paths.cachePackageJson);
	} catch (error) {
		log(`Warning: Could not parse ${paths.cachePackageJson} (${formatErrorForLog(error)}). Skipping.`);
		return;
	}

	const sections = [
		"dependencies",
		"devDependencies",
		"peerDependencies",
		"optionalDependencies",
	];

	let changed = false;
	for (const section of sections) {
		const deps = cacheData?.[section];
		if (deps && typeof deps === "object" && PLUGIN_NAME in deps) {
			delete deps[PLUGIN_NAME];
			changed = true;
		}
	}

	if (!changed) {
		return;
	}

	if (dryRun) {
		log(`[dry-run] Would update ${paths.cachePackageJson} to remove ${PLUGIN_NAME}`);
		return;
	}

	await writeFileAtomic(paths.cachePackageJson, formatJson(cacheData));
}

async function clearCache(paths, dryRun, skipCacheClear) {
	if (skipCacheClear) {
		log("Skipping cache clear (--no-cache-clear).");
		await removePluginFromCachePackage(paths, dryRun);
		return;
	}

	if (dryRun) {
		log(`[dry-run] Would remove ${paths.cacheNodeModules}`);
		log(`[dry-run] Would remove ${paths.cacheBunLock}`);
	} else {
		await rm(paths.cacheNodeModules, { recursive: true, force: true });
		await rm(paths.cacheBunLock, { force: true });
	}

	await removePluginFromCachePackage(paths, dryRun);
}

export async function runInstaller(argv = process.argv.slice(2), options = {}) {
	const parsed = parseCliArgs(argv);
	if (parsed.wantsHelp) {
		printHelp();
		return { exitCode: 0, action: "help" };
	}

	const { env = process.env } = options;
	const { configMode, dryRun, skipCacheClear } = parsed;
	const paths = buildPaths(resolveHomeDirectory(env));
	const requiredTemplatePaths = configMode === "modern"
		? [paths.modernTemplatePath]
		: configMode === "legacy"
			? [paths.legacyTemplatePath]
			: [paths.modernTemplatePath, paths.legacyTemplatePath];

	for (const templatePath of requiredTemplatePaths) {
		if (!existsSync(templatePath)) {
			throw new Error(`Config template not found at ${templatePath}`);
		}
	}

	const template = await loadTemplate(configMode, paths);
	template.plugin = [PLUGIN_NAME];

	let nextConfig = template;
	if (existsSync(paths.configPath)) {
		const backupPath = await backupConfig(paths.configPath, dryRun);
		log(`${dryRun ? "[dry-run] Would create backup" : "Backup created"}: ${backupPath}`);

		try {
			const existing = await readJson(paths.configPath);
			const merged = { ...existing };
			merged.plugin = normalizePluginList(existing.plugin);
			const provider = (existing.provider && typeof existing.provider === "object")
				? { ...existing.provider }
				: {};
			provider.openai = mergeOpenAiConfig(provider.openai, template.provider.openai);
			merged.provider = provider;
			nextConfig = merged;
		} catch (error) {
			throw new Error(
				`Could not parse existing config safely (${formatErrorForLog(error)}). ` +
				`Restore from the backup if needed and fix ${paths.configPath} before rerunning.`,
			);
		}
	} else {
		log("No existing config found. Creating new global config.");
	}

	if (dryRun) {
		log(`[dry-run] Would write ${paths.configPath} using ${configMode} config`);
	} else {
		// Persist through a temp file plus rename so Windows AV/file locks do not
		// leave a truncated opencode.json behind during installer updates.
		await writeFileAtomic(paths.configPath, formatJson(nextConfig));
		log(`Wrote ${paths.configPath} (${configMode} config)`);
	}

	await clearCache(paths, dryRun, skipCacheClear);

	log("\nDone. Restart OpenCode to (re)install the plugin.");
	log("Example: opencode");
	if (configMode === "modern") {
		log("Note: Modern config intentionally shows 9 base model entries; use --variant to access all 34 shipped presets.");
	}
	if (configMode === "legacy") {
		log("Note: Legacy config writes 34 explicit preset entries and is also safe for older OpenCode versions.");
	}
	if (configMode === "full") {
		log("Note: Full config installs both modern base models and explicit preset entries so the full shipped catalog is visible by default.");
	}

	return {
		exitCode: 0,
		action: "install",
		configMode,
		configPath: paths.configPath,
	};
}

export const __test = {
	buildPaths,
	backupConfig,
	copyFileWithWindowsRetry,
	mergeFullTemplate,
	parseCliArgs,
	writeFileAtomic,
	renameWithWindowsRetry,
	resolveHomeDirectory,
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	runInstaller().catch((error) => {
		console.error(`Installer failed: ${formatErrorForLog(error)}`);
		process.exit(1);
	});
}
