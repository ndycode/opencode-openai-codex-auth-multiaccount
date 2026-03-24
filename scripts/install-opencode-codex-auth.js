#!/usr/bin/env node

import { existsSync } from "node:fs";
import { readFile, writeFile, mkdir, copyFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";

const PLUGIN_NAME = "oc-chatgpt-multi-auth";

const args = new Set(process.argv.slice(2));
const requestedModern = args.has("--modern");
const requestedLegacy = args.has("--legacy");

if (requestedModern && requestedLegacy) {
	console.error("Choose only one of --modern or --legacy.");
	process.exit(1);
}

const configMode = requestedModern ? "modern" : requestedLegacy ? "legacy" : "full";

if (args.has("--help") || args.has("-h")) {
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
	process.exit(0);
}

const dryRun = args.has("--dry-run");
const skipCacheClear = args.has("--no-cache-clear");

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const modernTemplatePath = join(repoRoot, "config", "opencode-modern.json");
const legacyTemplatePath = join(repoRoot, "config", "opencode-legacy.json");

const configDir = join(homedir(), ".config", "opencode");
const configPath = join(configDir, "opencode.json");
const cacheDir = join(homedir(), ".cache", "opencode");
const cacheNodeModules = join(cacheDir, "node_modules", PLUGIN_NAME);
const cacheBunLock = join(cacheDir, "bun.lock");
const cachePackageJson = join(cacheDir, "package.json");

function log(message) {
	console.log(message);
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

async function readJson(filePath) {
	const content = await readFile(filePath, "utf-8");
	return JSON.parse(content);
}

async function loadTemplate(mode) {
	if (mode === "modern") {
		return readJson(modernTemplatePath);
	}
	if (mode === "legacy") {
		return readJson(legacyTemplatePath);
	}

	const [modernTemplate, legacyTemplate] = await Promise.all([
		readJson(modernTemplatePath),
		readJson(legacyTemplatePath),
	]);

	return {
		...modernTemplate,
		provider: {
			...modernTemplate.provider,
			openai: {
				...modernTemplate.provider.openai,
				models: {
					...modernTemplate.provider.openai.models,
					...legacyTemplate.provider.openai.models,
				},
			},
		},
	};
}

async function backupConfig(sourcePath) {
	const timestamp = new Date()
		.toISOString()
		.replace(/[:.]/g, "-")
		.replace("T", "_")
		.replace("Z", "");
	const backupPath = `${sourcePath}.bak-${timestamp}`;
	if (!dryRun) {
		await copyFile(sourcePath, backupPath);
	}
	return backupPath;
}

async function removePluginFromCachePackage() {
	if (!existsSync(cachePackageJson)) {
		return;
	}

	let cacheData;
	try {
		cacheData = await readJson(cachePackageJson);
	} catch (error) {
		log(`Warning: Could not parse ${cachePackageJson} (${error}). Skipping.`);
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
		log(`[dry-run] Would update ${cachePackageJson} to remove ${PLUGIN_NAME}`);
		return;
	}

	await writeFile(cachePackageJson, formatJson(cacheData), "utf-8");
}

async function clearCache() {
	if (skipCacheClear) {
		log("Skipping cache clear (--no-cache-clear).");
		return;
	}

	if (dryRun) {
		log(`[dry-run] Would remove ${cacheNodeModules}`);
		log(`[dry-run] Would remove ${cacheBunLock}`);
	} else {
		await rm(cacheNodeModules, { recursive: true, force: true });
		await rm(cacheBunLock, { force: true });
	}

	await removePluginFromCachePackage();
}

async function main() {
	const requiredTemplatePaths = configMode === "modern"
		? [modernTemplatePath]
		: configMode === "legacy"
			? [legacyTemplatePath]
			: [modernTemplatePath, legacyTemplatePath];

	for (const templatePath of requiredTemplatePaths) {
		if (!existsSync(templatePath)) {
			throw new Error(`Config template not found at ${templatePath}`);
		}
	}

	const template = await loadTemplate(configMode);
	template.plugin = [PLUGIN_NAME];

	let nextConfig = template;
	if (existsSync(configPath)) {
		const backupPath = await backupConfig(configPath);
		log(`${dryRun ? "[dry-run] Would create backup" : "Backup created"}: ${backupPath}`);

		try {
			const existing = await readJson(configPath);
			const merged = { ...existing };
			merged.plugin = normalizePluginList(existing.plugin);
			const provider = (existing.provider && typeof existing.provider === "object")
				? { ...existing.provider }
				: {};
			provider.openai = template.provider.openai;
			merged.provider = provider;
			nextConfig = merged;
		} catch (error) {
			log(`Warning: Could not parse existing config (${error}). Replacing with template.`);
			nextConfig = template;
		}
	} else {
		log("No existing config found. Creating new global config.");
	}

	if (dryRun) {
		log(`[dry-run] Would write ${configPath} using ${configMode} config`);
	} else {
		await mkdir(configDir, { recursive: true });
		await writeFile(configPath, formatJson(nextConfig), "utf-8");
		log(`Wrote ${configPath} (${configMode} config)`);
	}

	await clearCache();

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
}

main().catch((error) => {
	console.error(`Installer failed: ${error instanceof Error ? error.message : error}`);
	process.exit(1);
});
