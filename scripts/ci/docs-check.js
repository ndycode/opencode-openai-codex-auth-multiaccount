#!/usr/bin/env node

import { access, readdir, readFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const DEFAULT_FILES = ["README.md", "CONTRIBUTING.md", "SECURITY.md", "CHANGELOG.md"];
const DEFAULT_DIRS = [".github", "config", "docs", "test"];
const MARKDOWN_EXTENSIONS = new Set([".md", ".markdown"]);
const IGNORED_DIRS = new Set([".git", ".github/workflows", ".omx", "dist", "node_modules", "tmp"]);

async function exists(targetPath) {
	try {
		await access(targetPath);
		return true;
	} catch {
		return false;
	}
}

async function walkMarkdownFiles(dirPath) {
	const entries = await readdir(dirPath, { withFileTypes: true });
	const files = [];

	for (const entry of entries) {
		const absolutePath = path.join(dirPath, entry.name);
		const relativePath = path.relative(ROOT, absolutePath).replace(/\\/g, "/");

		if (entry.isDirectory()) {
			if (IGNORED_DIRS.has(relativePath) || IGNORED_DIRS.has(entry.name)) continue;
			files.push(...(await walkMarkdownFiles(absolutePath)));
			continue;
		}

		if (MARKDOWN_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
			files.push(absolutePath);
		}
	}

	return files;
}

async function collectMarkdownFiles(inputPaths) {
	const resolved = new Set();

	if (inputPaths.length > 0) {
		for (const inputPath of inputPaths) {
			const absolutePath = path.resolve(ROOT, inputPath);
			if (!(await exists(absolutePath))) continue;
			const extension = path.extname(absolutePath).toLowerCase();
			if (MARKDOWN_EXTENSIONS.has(extension)) {
				resolved.add(absolutePath);
				continue;
			}

			const nestedFiles = await walkMarkdownFiles(absolutePath);
			for (const nestedFile of nestedFiles) resolved.add(nestedFile);
		}

		return [...resolved].sort();
	}

	for (const file of DEFAULT_FILES) {
		const absolutePath = path.join(ROOT, file);
		if (await exists(absolutePath)) resolved.add(absolutePath);
	}

	for (const dir of DEFAULT_DIRS) {
		const absolutePath = path.join(ROOT, dir);
		if (!(await exists(absolutePath))) continue;
		const nestedFiles = await walkMarkdownFiles(absolutePath);
		for (const nestedFile of nestedFiles) resolved.add(nestedFile);
	}

	return [...resolved].sort();
}

function extractMarkdownLinks(markdown) {
	const stripped = markdown
		.replace(/```[\s\S]*?```/g, "\n")
		.replace(/`[^`\n]+`/g, "`code`");
	const pattern = /!?\[[^\]]*]\(([^)\n]+)\)/g;
	const links = [];

	for (const match of stripped.matchAll(pattern)) {
		const rawTarget = match[1]?.trim();
		if (!rawTarget) continue;

		let target = rawTarget;
		if (target.startsWith("<") && target.endsWith(">")) {
			target = target.slice(1, -1).trim();
		}

		const spacedTarget = target.match(/^(\S+)\s+["'(].*$/);
		if (spacedTarget?.[1]) {
			target = spacedTarget[1];
		}

		links.push(target);
	}

	return links;
}

function getWorkflowPathFromUrl(target) {
	try {
		const url = new URL(target);
		if (!["github.com", "www.github.com"].includes(url.hostname)) return null;
		const match = url.pathname.match(/\/actions\/workflows\/([^/]+)(?:\/badge\.svg)?$/);
		return match?.[1] ?? null;
	} catch {
		return null;
	}
}

async function validateLink(filePath, linkTarget) {
	if (!linkTarget || linkTarget.startsWith("#")) return null;
	if (/^(mailto:|tel:|data:)/i.test(linkTarget)) return null;

	const workflowFile = getWorkflowPathFromUrl(linkTarget);
	if (workflowFile) {
		const workflowPath = path.join(ROOT, ".github", "workflows", workflowFile);
		if (await exists(workflowPath)) return null;
		return `Missing workflow referenced by GitHub Actions badge/link: ${workflowFile}`;
	}

	if (/^https?:\/\//i.test(linkTarget)) return null;
	if (linkTarget.startsWith("/")) return null;

	const [rawPath] = linkTarget.split(/[?#]/, 1);
	if (!rawPath) return null;

	const resolvedPath = path.resolve(path.dirname(filePath), rawPath);
	if (await exists(resolvedPath)) return null;

	return `Missing local target: ${rawPath}`;
}

async function main() {
	const files = await collectMarkdownFiles(process.argv.slice(2));
	if (files.length === 0) {
		console.log("docs-check: no markdown files found");
		return;
	}

	const failures = [];

	for (const filePath of files) {
		const contents = await readFile(filePath, "utf8");
		const links = extractMarkdownLinks(contents);

		for (const link of links) {
			const error = await validateLink(filePath, link);
			if (!error) continue;
			failures.push(`${path.relative(ROOT, filePath).replace(/\\/g, "/")}: ${error} (${link})`);
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

await main();
