#!/usr/bin/env node

import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runInstaller } from "./install-oc-codex-multi-auth-core.js";

export * from "./install-oc-codex-multi-auth-core.js";

const __filename = fileURLToPath(import.meta.url);

function normalizePathForCompare(path, resolveRealPath = realpathSync) {
	const resolved = resolve(path);
	try {
		const realPath = resolveRealPath(resolved);
		return process.platform === "win32" ? realPath.toLowerCase() : realPath;
	} catch {
		return process.platform === "win32" ? resolved.toLowerCase() : resolved;
	}
}

export function isDirectRunPath(
	argvPath = process.argv[1],
	modulePath = __filename,
	resolveRealPath = realpathSync,
) {
	if (!argvPath) return false;
	return (
		normalizePathForCompare(argvPath, resolveRealPath) ===
		normalizePathForCompare(modulePath, resolveRealPath)
	);
}

if (isDirectRunPath()) {
	runInstaller().catch((error) => {
		const message = error instanceof Error ? error.message : String(error);
		console.error(`Installer failed: ${message}`);
		process.exit(1);
	});
}
