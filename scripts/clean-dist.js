import { promises as fs } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function normalizeRelativePath(path) {
	return path.replaceAll("\\", "/");
}

export async function cleanDist(options = {}) {
	const repoRoot = resolve(options.repoRoot ?? resolve(__dirname, ".."));
	const distDir = resolve(options.distDir ?? resolve(repoRoot, "dist"));
	const relativeDist = normalizeRelativePath(relative(repoRoot, distDir));

	if (relativeDist !== "dist") {
		throw new Error(`Refusing to clean non-dist path: ${distDir}`);
	}

	await fs.rm(distDir, { recursive: true, force: true });
	return { distDir };
}

if (process.argv[1] && resolve(process.argv[1]) === __filename) {
	await cleanDist();
}
