#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import {
	isDirectRunPath as isDirectRunPathCore,
	runInstaller,
} from "./install-oc-codex-multi-auth-core.js";

export * from "./install-oc-codex-multi-auth-core.js";

const __filename = fileURLToPath(import.meta.url);

export function isDirectRunPath(
	argvPath = process.argv[1],
	modulePath = __filename,
	resolveRealPath,
) {
	return isDirectRunPathCore(argvPath, modulePath, resolveRealPath);
}

if (isDirectRunPath()) {
	runInstaller().catch((error) => {
		const message = error instanceof Error ? error.message : String(error);
		console.error(`Installer failed: ${message}`);
		process.exit(1);
	});
}
