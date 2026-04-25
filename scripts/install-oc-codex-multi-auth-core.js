import { existsSync, realpathSync } from "node:fs";
import { copyFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_NAME = "oc-codex-multi-auth";
const LEGACY_PACKAGE_NAMES = ["oc-chatgpt-multi-auth"];
const WINDOWS_RENAME_RETRY_ATTEMPTS = 5;
const WINDOWS_RENAME_RETRY_BASE_DELAY_MS = 10;
const STALE_MANAGED_MODEL_KEYS = new Set([
	"gpt-5.2",
	"gpt-5.3-codex",
	"gpt-5.4",
]);

function getManagedPackageNames() {
	return [PACKAGE_NAME, ...LEGACY_PACKAGE_NAMES];
}

export function normalizePathForCompare(path, resolveRealPath = realpathSync) {
	const resolved = resolve(path);
	try {
		const realPath = resolveRealPath(resolved);
		return process.platform === "win32" ? realPath.toLowerCase() : realPath;
	} catch {
		return process.platform === "win32" ? resolved.toLowerCase() : resolved;
	}
}

export function isDirectRunPath(argvPath, modulePath, resolveRealPath = realpathSync) {
	if (!argvPath || !modulePath) return false;
	return (
		normalizePathForCompare(argvPath, resolveRealPath) ===
		normalizePathForCompare(modulePath, resolveRealPath)
	);
}

function printHelp() {
	console.log(`Usage: ${PACKAGE_NAME} [--modern|--full|--legacy] [--dry-run] [--no-cache-clear]\n\n` +
		"Default behavior:\n" +
		"  - Installs/updates global config at ~/.config/opencode/opencode.json\n" +
		"  - Enables the prompt status bar TUI plugin at ~/.config/opencode/tui.json\n" +
		"  - Uses compact UI config by default (9 base OAuth models + variant picker presets)\n" +
		"  - Ensures plugin is unpinned (latest)\n" +
		"  - Clears OpenCode plugin cache\n\n" +
		"Options:\n" +
		"  --modern           Force compact modern config (9 base OAuth models + --variant presets)\n" +
		"  --full             Install compact base models plus 36 explicit selector entries\n" +
		"  --legacy           Force explicit legacy config (36 preset model entries)\n" +
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
		tuiConfigPath: join(configDir, "tui.json"),
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
	const requestedFull = args.has("--full");
	const requestedLegacy = args.has("--legacy");

	const requestedModes = [requestedModern, requestedFull, requestedLegacy]
		.filter(Boolean).length;
	if (requestedModes > 1) {
		throw new Error("Choose only one of --modern, --full, or --legacy.");
	}

	return {
		wantsHelp: false,
		dryRun: args.has("--dry-run"),
		skipCacheClear: args.has("--no-cache-clear"),
		configMode: requestedFull ? "full" : requestedLegacy ? "legacy" : "modern",
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

function mergeTuiConfig(existingConfig) {
	const existing = isPlainObject(existingConfig) ? { ...existingConfig } : {};
	const next = { ...existing };
	if (typeof next.$schema !== "string" || !next.$schema.trim()) {
		next.$schema = "https://opencode.ai/tui.json";
	}
	next.plugin = normalizePluginList(existing.plugin);
	return next;
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
function mergeOpenaiProvider(existingOpenai, templateOpenai, options = {}) {
	const existingSafe = isPlainObject(existingOpenai) ? existingOpenai : {};
	const templateSafe = isPlainObject(templateOpenai) ? templateOpenai : {};
	const modelKeysToRemove = options.modelKeysToRemove instanceof Set
		? options.modelKeysToRemove
		: new Set();

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
	const prunedExistingModels = Object.fromEntries(
		Object.entries(existingModels).filter(([key]) => !modelKeysToRemove.has(key)),
	);
	const mergedModels = { ...prunedExistingModels, ...templateModels };
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

function getTemplateModelKeys(template) {
	return new Set(Object.keys(template.provider?.openai?.models ?? {}));
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
	const modelKeysToRemove = new Set(STALE_MANAGED_MODEL_KEYS);
	if (configMode === "modern") {
		for (const key of getTemplateModelKeys(await readJson(paths.legacyTemplatePath))) {
			modelKeysToRemove.add(key);
		}
	}
	if (configMode === "legacy") {
		for (const key of getTemplateModelKeys(await readJson(paths.modernTemplatePath))) {
			modelKeysToRemove.add(key);
		}
	}

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
			provider.openai = mergeOpenaiProvider(existing.provider?.openai, template.provider?.openai, {
				modelKeysToRemove,
			});
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

	let nextTuiConfig = mergeTuiConfig(undefined);
	let existingTuiConfig;
	if (existsSync(paths.tuiConfigPath)) {
		const backupPath = await backupConfig(paths.tuiConfigPath, dryRun);
		log(`${dryRun ? "[dry-run] Would create backup" : "Backup created"}: ${backupPath}`);

		try {
			const existing = await readJson(paths.tuiConfigPath);
			existingTuiConfig = existing;
			nextTuiConfig = mergeTuiConfig(existing);
		} catch (error) {
			log(`Warning: Could not parse existing TUI config (${formatErrorForLog(error)}). Replacing with minimal TUI config.`);
			existingTuiConfig = undefined;
			nextTuiConfig = mergeTuiConfig(undefined);
		}
	} else {
		log("No existing TUI config found. Creating new global TUI config.");
	}

	let wrote = false;
	if (dryRun) {
		log(`[dry-run] Would write ${paths.configPath} using ${configMode} config`);
		log(`[dry-run] Diff for ${paths.configPath}:`);
		log(formatConfigDiff(existingConfig, nextConfig));
		log(`[dry-run] Would write ${paths.tuiConfigPath} with the TUI status plugin`);
		log(`[dry-run] Diff for ${paths.tuiConfigPath}:`);
		log(formatConfigDiff(existingTuiConfig, nextTuiConfig));
	} else {
		await writeFileAtomic(paths.configPath, formatJson(nextConfig));
		await writeFileAtomic(paths.tuiConfigPath, formatJson(nextTuiConfig));
		wrote = true;
		log(`Wrote ${paths.configPath} (${configMode} config)`);
		log(`Wrote ${paths.tuiConfigPath} (TUI status plugin)`);
	}

	await clearCache(paths, dryRun, skipCacheClear);

	log("\nDone. Restart OpenCode to (re)install the plugin.");
	log("Example: opencode");
	if (configMode === "modern") {
		log("Note: Modern config intentionally shows 9 base OAuth model entries; use the variant picker for reasoning presets.");
	}
	if (configMode === "legacy") {
		log("Note: Legacy config writes 36 explicit preset entries and is also safe for older OpenCode versions.");
	}
	if (configMode === "full") {
		log("Note: Full config installs both compact base models and explicit preset entries for direct selector IDs.");
	}

	return {
		exitCode: 0,
		action: "install",
		configMode,
		configPath: paths.configPath,
		tuiConfigPath: paths.tuiConfigPath,
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
	mergeTuiConfig,
	parseCliArgs,
	writeFileAtomic,
	renameWithWindowsRetry,
	resolveHomeDirectory,
};
