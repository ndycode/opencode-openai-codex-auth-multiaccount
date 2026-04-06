#!/usr/bin/env node

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runInstaller } from "./install-oc-codex-multi-auth-core.js";

export * from "./install-oc-codex-multi-auth-core.js";

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	runInstaller().catch((error) => {
		const message = error instanceof Error ? error.message : String(error);
		console.error(`Installer failed: ${message}`);
		process.exit(1);
	});
}
