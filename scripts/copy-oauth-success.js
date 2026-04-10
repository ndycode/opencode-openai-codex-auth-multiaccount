import { promises as fs } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function normalizePathForCompare(path) {
	const resolved = resolve(path);
	return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function getDefaultPaths() {
	const modulePath = join(__dirname, "..", "dist", "lib", "oauth-success.js");
	const dest = join(__dirname, "..", "dist", "lib", "oauth-success.html");
	return { modulePath, dest };
}

async function loadOAuthSuccessHtml(modulePath) {
	const moduleUrl = pathToFileURL(modulePath).href;
	const mod = await import(moduleUrl);
	if (typeof mod.oauthSuccessHtml !== "string") {
		throw new TypeError(`Expected oauthSuccessHtml string export from ${modulePath}`);
	}
	return mod.oauthSuccessHtml;
}

export async function copyOAuthSuccessHtml(options = {}) {
	const defaults = getDefaultPaths();
	const modulePath = options.modulePath ?? defaults.modulePath;
	const dest = options.dest ?? defaults.dest;
	const html = options.html ?? (await loadOAuthSuccessHtml(modulePath));

	await fs.mkdir(dirname(dest), { recursive: true });
	await fs.writeFile(dest, html, "utf-8");

	return { modulePath, dest };
}

const isDirectRun = (() => {
	if (!process.argv[1]) return false;
	return normalizePathForCompare(process.argv[1]) === normalizePathForCompare(__filename);
})();

if (isDirectRun) {
	await copyOAuthSuccessHtml();
}
