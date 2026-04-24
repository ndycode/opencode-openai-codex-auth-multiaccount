import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_NAME = "oc-codex-multi-auth";
const LEGACY_PACKAGE_NAMES = ["oc-chatgpt-multi-auth"];
const WINDOWS_RENAME_RETRY_ATTEMPTS = 5;
const WINDOWS_RENAME_RETRY_BASE_DELAY_MS = 10;

function getManagedPackageNames() {
	return [PACKAGE_NAME, ...LEGACY_PACKAGE_NAMES];
}

function printHelp() {
	console.log(`Usage: ${PACKAGE_NAME} [--modern|--legacy] [--dry-run] [--no-cache-clear]\n\n` +
		"Default behavior:\n" +
		"  - Installs/updates global config at ~/.config/opencode/opencode.json\n" +
		"  - Uses full catalog config by default (9 base models + 36 explicit presets)\n" +
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
		cacheNodeModulesPaths: getManagedPackageNames().map((name) => join(cacheDir, "node_modules", name)),
		cachePackagePaths: getManagedPackageNames().map((name) => join(cacheDir, "packages", `${name}@latest`)),
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

function normalizePluginEntryForMatch(entry) {
	const trimmed = entry.trim();
	let normalized = trimmed.toLowerCase();
	try {
		normalized = decodeURIComponent(normalized);
	} catch {
		// Keep the raw lowercased value when a malformed URI escape is present.
	}
	normalized = normalized.replace(/\\/g, "/").replace(/\/+$/g, "");
	if (normalized.endsWith("/dist")) {
		normalized = normalized.slice(0, -"/dist".length);
	}
	return normalized;
}

function isManagedPluginEntry(entry) {
	if (typeof entry !== "string") return false;
	const trimmed = entry.trim().toLowerCase();
	const normalized = normalizePluginEntryForMatch(entry);
	return getManagedPackageNames().some((name) => {
		const lowerName = name.toLowerCase();
		return trimmed === lowerName ||
			trimmed.startsWith(`${lowerName}@`) ||
			normalized.endsWith(`/${lowerName}`) ||
			normalized.endsWith(`/node_modules/${lowerName}`);
	});
}

function normalizePluginList(list) {
	const entries = Array.isArray(list) ? list.filter(Boolean) : [];
	const filtered = entries.filter((entry) => !isManagedPluginEntry(entry));
	return [...filtered, PACKAGE_NAME];
}

function formatJson(obj) {
	return `${JSON.stringify(obj, null, 2)}\n`;
}

// Top-level keys inside `provider.openai` that the installer owns absolutely.
// These are always sourced from the template (overwritten or removed) so the
// plugin's required runtime shape is authoritative. Any OTHER key the user has
// placed under `provider.openai` is preserved as-is. `models` is handled
// separately because it's a map where user-added model ids must survive while
// template-shipped ids win on collision.
const MANAGED_OPENAI_KEYS = new Set(["baseURL", "apiKey", "options"]);

function isPlainObject(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

// Deep-merge `provider.openai` preserving unknown user keys while letting the
// installer overwrite the managed shape it ships. This replaces the earlier
// wholesale overwrite which clobbered custom user-added keys (see audit top-20
// #6).
function mergeOpenaiProvider(existingOpenai, templateOpenai) {
	const existingSafe = isPlainObject(existingOpenai) ? existingOpenai : {};
	const templateSafe = isPlainObject(templateOpenai) ? templateOpenai : {};

	const result = {};

	// 1. Start with the user's non-managed keys (unknown-to-installer settings).
	for (const [key, value] of Object.entries(existingSafe)) {
		if (MANAGED_OPENAI_KEYS.has(key)) continue;
		if (key === "models") continue; // handled explicitly below
		result[key] = value;
	}

	// 2. Apply template-managed keys. Installer is source of truth for these.
	for (const [key, value] of Object.entries(templateSafe)) {
		if (key === "models") continue; // handled explicitly below
		result[key] = value;
	}

	// 3. Merge `models` by id: template wins on collision, user-added ids survive.
	const existingModels = isPlainObject(existingSafe.models) ? existingSafe.models : {};
	const templateModels = isPlainObject(templateSafe.models) ? templateSafe.models : {};
	const mergedModels = { ...existingModels, ...templateModels };
	if (Object.keys(mergedModels).length > 0) {
		result.models = mergedModels;
	}

	return result;
}

// Naive line-by-line diff for displaying config changes in dry-run. Good enough
// for eyeballing; not intended to be parsed or round-tripped.
function formatConfigDiff(existingConfig, nextConfig) {
	const oldText = existingConfig === undefined ? "" : formatJson(existingConfig);
	const newText = formatJson(nextConfig);
	if (oldText === newText) {
		return "(no changes)";
	}
	const lines = [];
	lines.push("--- existing");
	lines.push("+++ proposed");
	if (existingConfig === undefined) {
		lines.push("- (no existing config)");
	} else {
		for (const line of oldText.split("\n")) {
			lines.push(`- ${line}`);
		}
	}
	for (const line of newText.split("\n")) {
		lines.push(`+ ${line}`);
	}
	return lines.join("\n");
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
	return JSON.parse(content.charCodeAt(0) === 0xfeff ? content.slice(1) : content);
}

async function renameWithWindowsRetry(sourcePath, destinationPath) {
	let lastError = null;

	for (let attempt = 0; attempt < WINDOWS_RENAME_RETRY_ATTEMPTS; attempt += 1) {
		try {
			await rename(sourcePath, destinationPath);
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
		if (deps && typeof deps === "object") {
			for (const name of getManagedPackageNames()) {
				if (name in deps) {
					delete deps[name];
					changed = true;
				}
			}
		}
	}

	if (!changed) {
		return;
	}

	if (dryRun) {
		log(`[dry-run] Would update ${paths.cachePackageJson} to remove ${getManagedPackageNames().join(", ")}`);
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
		for (const cacheNodeModulesPath of paths.cacheNodeModulesPaths) {
			log(`[dry-run] Would remove ${cacheNodeModulesPath}`);
		}
		for (const cachePackagePath of paths.cachePackagePaths) {
			log(`[dry-run] Would remove ${cachePackagePath}`);
		}
		log(`[dry-run] Would remove ${paths.cacheBunLock}`);
	} else {
		for (const cacheNodeModulesPath of paths.cacheNodeModulesPaths) {
			await rm(cacheNodeModulesPath, { recursive: true, force: true });
		}
		for (const cachePackagePath of paths.cachePackagePaths) {
			await rm(cachePackagePath, { recursive: true, force: true });
		}
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
	template.plugin = [PACKAGE_NAME];

	let nextConfig = template;
	let existingConfig;
	if (existsSync(paths.configPath)) {
		const backupPath = await backupConfig(paths.configPath, dryRun);
		log(`${dryRun ? "[dry-run] Would create backup" : "Backup created"}: ${backupPath}`);

		try {
			const existing = await readJson(paths.configPath);
			existingConfig = existing;
			const merged = { ...existing };
			merged.plugin = normalizePluginList(existing.plugin);
			const provider = (existing.provider && typeof existing.provider === "object")
				? { ...existing.provider }
				: {};
			provider.openai = mergeOpenaiProvider(existing.provider?.openai, template.provider?.openai);
			merged.provider = provider;
			nextConfig = merged;
		} catch (error) {
			log(`Warning: Could not parse existing config (${formatErrorForLog(error)}). Replacing with template.`);
			existingConfig = undefined;
			nextConfig = template;
		}
	} else {
		log("No existing config found. Creating new global config.");
	}

	let wrote = false;
	if (dryRun) {
		log(`[dry-run] Would write ${paths.configPath} using ${configMode} config`);
		log(`[dry-run] Diff for ${paths.configPath}:`);
		log(formatConfigDiff(existingConfig, nextConfig));
	} else {
		await writeFileAtomic(paths.configPath, formatJson(nextConfig));
		wrote = true;
		log(`Wrote ${paths.configPath} (${configMode} config)`);
	}

	await clearCache(paths, dryRun, skipCacheClear);

	log("\nDone. Restart OpenCode to (re)install the plugin.");
	log("Example: opencode");
	if (configMode === "modern") {
		log("Note: Modern config intentionally shows 9 base model entries; use --variant to access all 36 shipped presets.");
	}
	if (configMode === "legacy") {
		log("Note: Legacy config writes 36 explicit preset entries and is also safe for older OpenCode versions.");
	}
	if (configMode === "full") {
		log("Note: Full config installs both modern base models and explicit preset entries so the full shipped catalog is visible by default.");
	}

	return {
		exitCode: 0,
		action: "install",
		configMode,
		configPath: paths.configPath,
		dryRun: Boolean(dryRun),
		wrote,
	};
}

export const __test = {
	buildPaths,
	backupConfig,
	copyFileWithWindowsRetry,
	formatConfigDiff,
	mergeFullTemplate,
	mergeOpenaiProvider,
	parseCliArgs,
	writeFileAtomic,
	renameWithWindowsRetry,
	resolveHomeDirectory,
};
