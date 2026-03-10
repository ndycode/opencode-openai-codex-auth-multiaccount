/**
 * Path resolution utilities for account storage.
 * Extracted from storage.ts to reduce module size.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { homedir, tmpdir } from "node:os";

const PROJECT_MARKERS = [".git", "package.json", "Cargo.toml", "go.mod", "pyproject.toml", ".opencode"];
const PROJECTS_DIR = "projects";
const PROJECT_KEY_HASH_LENGTH = 12;

export function getConfigDir(): string {
	return join(homedir(), ".opencode");
}

export function getProjectConfigDir(projectPath: string): string {
	return join(projectPath, ".opencode");
}

function normalizeProjectPath(projectPath: string): string {
	const resolvedPath = resolve(projectPath);
	const normalizedSeparators = resolvedPath.replace(/\\/g, "/");
	return process.platform === "win32"
		? normalizedSeparators.toLowerCase()
		: normalizedSeparators;
}

function sanitizeProjectName(projectPath: string): string {
	const name = basename(projectPath);
	const sanitized = name.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
	return sanitized || "project";
}

function buildProjectStorageKey(projectPath: string, identityPath: string): string {
	const hash = createHash("sha256")
		.update(identityPath)
		.digest("hex")
		.slice(0, PROJECT_KEY_HASH_LENGTH);
	const projectName = sanitizeProjectName(projectPath).slice(0, 40);
	return `${projectName}-${hash}`;
}

function getCanonicalProjectStorageIdentity(projectPath: string): {
	identityPath: string;
	projectNamePath: string;
} {
	const resolvedProjectPath = resolve(projectPath);
	const gitPath = join(resolvedProjectPath, ".git");
	if (!existsSync(gitPath)) {
		return {
			identityPath: normalizeProjectPath(resolvedProjectPath),
			projectNamePath: resolvedProjectPath,
		};
	}

	try {
		if (statSync(gitPath).isDirectory()) {
			return {
				identityPath: normalizeProjectPath(gitPath),
				projectNamePath: resolvedProjectPath,
			};
		}
		const gitMetadata = readFileSync(gitPath, "utf-8").trim();
		const gitDirMatch = /^gitdir:\s*(.+)$/im.exec(gitMetadata);
		const gitDirValue = gitDirMatch?.[1];
		if (!gitDirValue) {
			return {
				identityPath: normalizeProjectPath(resolvedProjectPath),
				projectNamePath: resolvedProjectPath,
			};
		}
		const gitDir = resolve(resolvedProjectPath, gitDirValue.trim());
		const gitDirParent = dirname(gitDir);
		if (basename(gitDirParent).toLowerCase() === "worktrees") {
			const commonGitDir = dirname(gitDirParent);
			return {
				identityPath: normalizeProjectPath(commonGitDir),
				projectNamePath: dirname(commonGitDir),
			};
		}
		return {
			identityPath: normalizeProjectPath(gitDir),
			projectNamePath: resolvedProjectPath,
		};
	} catch {
		return {
			identityPath: normalizeProjectPath(resolvedProjectPath),
			projectNamePath: resolvedProjectPath,
		};
	}
}

export function getProjectStorageKeyCandidates(projectPath: string): string[] {
	const normalizedProjectPath = normalizeProjectPath(projectPath);
	const canonicalIdentity = getCanonicalProjectStorageIdentity(projectPath);
	const candidates = [
		buildProjectStorageKey(normalizeProjectPath(canonicalIdentity.projectNamePath), canonicalIdentity.identityPath),
		buildProjectStorageKey(normalizedProjectPath, normalizedProjectPath),
	];
	return Array.from(new Set(candidates));
}

export function getProjectStorageKey(projectPath: string): string {
	const canonicalIdentity = getCanonicalProjectStorageIdentity(projectPath);
	return buildProjectStorageKey(
		normalizeProjectPath(canonicalIdentity.projectNamePath),
		canonicalIdentity.identityPath,
	);
}

/**
 * Per-project storage is namespaced under ~/.opencode/projects
 * to avoid writing account files into user repositories.
 */
export function getProjectGlobalConfigDir(projectPath: string): string {
	return join(getConfigDir(), PROJECTS_DIR, getProjectStorageKey(projectPath));
}

export function isProjectDirectory(dir: string): boolean {
	return PROJECT_MARKERS.some((marker) => existsSync(join(dir, marker)));
}

export function findProjectRoot(startDir: string): string | null {
	let current = startDir;
	
	while (current) {
		if (isProjectDirectory(current)) {
			return current;
		}
		
		const parent = dirname(current);
		if (parent === current) {
			break;
		}
		current = parent;
	}
	
	return null;
}

function normalizePathForComparison(filePath: string): string {
	const resolvedPath = resolve(filePath);
	return process.platform === "win32" ? resolvedPath.toLowerCase() : resolvedPath;
}

function isWithinDirectory(baseDir: string, targetPath: string): boolean {
	const normalizedBase = normalizePathForComparison(baseDir);
	const normalizedTarget = normalizePathForComparison(targetPath);
	const rel = relative(normalizedBase, normalizedTarget);
	return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

export function resolvePath(filePath: string): string {
	let resolved: string;
	if (filePath.startsWith("~")) {
		resolved = join(homedir(), filePath.slice(1));
	} else {
		resolved = resolve(filePath);
	}

	const home = homedir();
	const cwd = process.cwd();
	const tmp = tmpdir();
	if (
		!isWithinDirectory(home, resolved) &&
		!isWithinDirectory(cwd, resolved) &&
		!isWithinDirectory(tmp, resolved)
	) {
		throw new Error(`Access denied: path must be within home directory, project directory, or temp directory`);
	}

	return resolved;
}
