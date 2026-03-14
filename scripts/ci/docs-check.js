#!/usr/bin/env node

import { access, readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_FILES = ["README.md", "CONTRIBUTING.md", "SECURITY.md", "CHANGELOG.md"];
const DEFAULT_DIRS = [".github", "config", "docs", "test"];
const MARKDOWN_EXTENSIONS = new Set([".md", ".markdown"]);
const IGNORED_DIRS = new Set([".git", ".github/workflows", ".omx", "dist", "node_modules", "tmp"]);
const __filename = fileURLToPath(import.meta.url);
const REPOSITORY = process.env.GITHUB_REPOSITORY ?? "ndycode/oc-chatgpt-multi-auth";

function getRootDir() {
	return process.cwd();
}

export function normalizePathForCompare(targetPath) {
	const resolved = path.resolve(targetPath);
	return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function normalizeReferenceLabel(label) {
	return label.trim().replace(/\s+/g, " ").toLowerCase();
}

function normalizeLinkTarget(rawTarget) {
	if (!rawTarget) return null;

	let target = rawTarget.trim();
	if (!target) return null;

	const angleTargetWithOptionalTitle = target.match(/^<([^>]+)>(?:\s+["'(].*)?$/);
	if (angleTargetWithOptionalTitle?.[1]) {
		target = angleTargetWithOptionalTitle[1].trim();
	} else {
		const spacedTarget = target.match(/^(\S+)\s+["'(].*$/);
		if (spacedTarget?.[1]) {
			target = spacedTarget[1];
		}

		if (target.startsWith("<") && target.endsWith(">")) {
			target = target.slice(1, -1).trim();
		}
	}

	return target || null;
}

async function exists(targetPath) {
	try {
		await access(targetPath);
		return true;
	} catch {
		return false;
	}
}

async function getPathType(targetPath) {
	try {
		const metadata = await stat(targetPath);
		if (metadata.isDirectory()) return "directory";
		if (metadata.isFile()) return "file";
		return "other";
	} catch {
		return "missing";
	}
}

async function walkMarkdownFiles(dirPath, rootDir = getRootDir()) {
	const entries = await readdir(dirPath, { withFileTypes: true });
	const files = [];

	for (const entry of entries) {
		const absolutePath = path.join(dirPath, entry.name);
		const relativePath = path.relative(rootDir, absolutePath).replace(/\\/g, "/");

		if (entry.isDirectory()) {
			if (IGNORED_DIRS.has(relativePath) || IGNORED_DIRS.has(entry.name)) continue;
			files.push(...(await walkMarkdownFiles(absolutePath, rootDir)));
			continue;
		}

		if (MARKDOWN_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
			files.push(absolutePath);
		}
	}

	return files;
}

async function collectMarkdownFiles(inputPaths, rootDir = getRootDir()) {
	const resolved = new Set();

	if (inputPaths.length > 0) {
		for (const inputPath of inputPaths) {
			const absolutePath = path.resolve(rootDir, inputPath);
			if (!(await exists(absolutePath))) continue;

			const pathType = await getPathType(absolutePath);
			const extension = path.extname(absolutePath).toLowerCase();
			if (pathType === "file" && MARKDOWN_EXTENSIONS.has(extension)) {
				resolved.add(absolutePath);
				continue;
			}

			if (pathType !== "directory") continue;

			const nestedFiles = await walkMarkdownFiles(absolutePath, rootDir);
			for (const nestedFile of nestedFiles) resolved.add(nestedFile);
		}

		return [...resolved].sort();
	}

	for (const file of DEFAULT_FILES) {
		const absolutePath = path.join(rootDir, file);
		if (await exists(absolutePath)) resolved.add(absolutePath);
	}

	for (const dir of DEFAULT_DIRS) {
		const absolutePath = path.join(rootDir, dir);
		if (!(await exists(absolutePath))) continue;
		const nestedFiles = await walkMarkdownFiles(absolutePath, rootDir);
		for (const nestedFile of nestedFiles) resolved.add(nestedFile);
	}

	return [...resolved].sort();
}

function extractLinkTarget(markdown, startIndex) {
	let depth = 1;
	let inAngleTarget = false;
	let isEscaped = false;
	let target = "";

	for (let index = startIndex; index < markdown.length; index += 1) {
		const char = markdown[index];

		if (isEscaped) {
			target += char;
			isEscaped = false;
			continue;
		}

		if (char === "\\") {
			target += char;
			isEscaped = true;
			continue;
		}

		if (inAngleTarget) {
			target += char;
			if (char === ">") inAngleTarget = false;
			continue;
		}

		if (char === "<" && target.trim().length === 0) {
			target += char;
			inAngleTarget = true;
			continue;
		}

		if (char === "(") {
			target += char;
			depth += 1;
			continue;
		}

		if (char === ")") {
			depth -= 1;
			if (depth === 0) {
				return target;
			}
			target += char;
			continue;
		}

		target += char;
	}

	return null;
}

export function extractMarkdownLinks(markdown) {
	const stripped = markdown
		.replace(/```[\s\S]*?```/g, "\n")
		.replace(/`[^`\n]+`/g, "`code`");
	const openerPattern = /!?\[[^\]]*]\(/g;
	const referencePattern = /!?\[([^\]]+)]\[([^\]]*)]/g;
	const referenceDefinitionPattern = /^\s{0,3}\[([^\]]+)]:\s+(.+)$/gm;
	const links = [];
	const referenceDefinitions = new Map();

	for (const match of stripped.matchAll(referenceDefinitionPattern)) {
		const label = normalizeReferenceLabel(match[1] ?? "");
		const target = normalizeLinkTarget(match[2] ?? "");
		if (!label || !target) continue;
		referenceDefinitions.set(label, target);
	}

	for (const match of stripped.matchAll(openerPattern)) {
		const linkStart = (match.index ?? 0) + match[0].length;
		const parsedTarget = extractLinkTarget(stripped, linkStart);
		const target = normalizeLinkTarget(parsedTarget);
		if (!target) continue;
		links.push(target);
	}

	for (const match of stripped.matchAll(referencePattern)) {
		const label = match[2]?.trim() ? match[2] : match[1];
		const referenceTarget = referenceDefinitions.get(normalizeReferenceLabel(label ?? ""));
		if (referenceTarget) links.push(referenceTarget);
	}

	return links;
}

function getWorkflowPathFromUrl(target) {
	try {
		const url = new URL(target);
		if (!["github.com", "www.github.com"].includes(url.hostname)) return null;
		const match = url.pathname.match(/^\/([^/]+)\/([^/]+)\/actions\/workflows\/([^/]+)(?:\/badge\.svg)?$/);
		if (!match) return null;

		const [, ownerFromUrl, repoFromUrl, workflowFile] = match;
		const [owner, repo] = REPOSITORY.split("/");
		if (ownerFromUrl.toLowerCase() !== owner?.toLowerCase() || repoFromUrl.toLowerCase() !== repo?.toLowerCase()) return null;

		return workflowFile;
	} catch {
		return null;
	}
}

export async function validateLink(filePath, linkTarget, rootDir = getRootDir()) {
	if (!linkTarget || linkTarget.startsWith("#")) return null;
	if (/^(mailto:|tel:|data:)/i.test(linkTarget)) return null;

	const workflowFile = getWorkflowPathFromUrl(linkTarget);
	if (workflowFile) {
		const workflowPath = path.join(rootDir, ".github", "workflows", workflowFile);
		if (await exists(workflowPath)) return null;
		return `Missing workflow referenced by GitHub Actions badge/link: ${workflowFile}`;
	}

	if (/^https?:\/\//i.test(linkTarget)) return null;
	// Site-root links depend on the final docs host; only repo-relative targets are checked here.
	if (linkTarget.startsWith("/")) return null;

	const [rawPath] = linkTarget.split(/[?#]/, 1);
	if (!rawPath) return null;

	const resolvedPath = path.resolve(path.dirname(filePath), rawPath);
	const relativeToRoot = path.relative(rootDir, resolvedPath);
	if (relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) {
		return `Local target escapes repository root: ${rawPath}`;
	}

	if (await exists(resolvedPath)) return null;

	return `Missing local target: ${rawPath}`;
}

async function main(rootDir = getRootDir()) {
	const files = await collectMarkdownFiles(process.argv.slice(2), rootDir);
	if (files.length === 0) {
		console.log("docs-check: no markdown files found");
		return;
	}

	const failures = [];

	for (const filePath of files) {
		const contents = await readFile(filePath, "utf8");
		const links = extractMarkdownLinks(contents);

		for (const link of links) {
			const error = await validateLink(filePath, link, rootDir);
			if (!error) continue;
			failures.push(`${path.relative(rootDir, filePath).replace(/\\/g, "/")}: ${error} (${link})`);
		}
	}

	if (failures.length > 0) {
		console.error("docs-check found broken documentation links:");
		for (const failure of failures) {
			console.error(`- ${failure}`);
		}
		process.exitCode = 1;
		return;
	}

	console.log(`docs-check: verified ${files.length} markdown file(s)`);
}

const isDirectRun = process.argv[1]
	? normalizePathForCompare(process.argv[1]) === normalizePathForCompare(__filename)
	: false;

if (isDirectRun) {
	await main();
}
