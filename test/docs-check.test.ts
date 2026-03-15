import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const tempRoots: string[] = [];
const TEMP_CLEANUP_DELAYS_MS = [100, 500, 2000];
const TEMP_CLEANUP_ATTEMPTS = TEMP_CLEANUP_DELAYS_MS.length + 1;
const DOCS_CHECK_SUBPROCESS_RETRY_DELAYS_MS = [100, 500, 2000];
const DOCS_CHECK_SUBPROCESS_ATTEMPTS =
	DOCS_CHECK_SUBPROCESS_RETRY_DELAYS_MS.length + 1;
const DOCS_CHECK_SUBPROCESS_TIMEOUT_MS = 15_000;
const execFileAsync = promisify(execFile);

async function cleanupTempRoot(root: string) {
	for (let attempt = 1; attempt <= TEMP_CLEANUP_ATTEMPTS; attempt += 1) {
		try {
			await rm(root, { recursive: true, force: true });
			return;
		} catch (error) {
			if (attempt === TEMP_CLEANUP_ATTEMPTS) {
				const message = error instanceof Error ? error.message : String(error);
				console.warn(`[docs-check test] failed to clean up ${root} after ${TEMP_CLEANUP_ATTEMPTS} attempts: ${message}`);
				return;
			}

			await delay(TEMP_CLEANUP_DELAYS_MS[attempt - 1] ?? TEMP_CLEANUP_DELAYS_MS.at(-1) ?? 100);
		}
	}
}

afterEach(async () => {
	await Promise.all(tempRoots.splice(0).map((root) => cleanupTempRoot(root)));
});

async function writeFixtureFiles(root: string, files: Record<string, string>) {
	tempRoots.push(root);

	for (const [relativePath, contents] of Object.entries(files)) {
		const absolutePath = path.join(root, relativePath);
		await mkdir(path.dirname(absolutePath), { recursive: true });
		await writeFile(absolutePath, contents, "utf8");
	}
}

function isTransientDocsCheckSubprocessError(error: unknown) {
	const details = [error instanceof Error ? error.message : String(error)];
	if (error && typeof error === "object") {
		const typedError = error as { stderr?: string; stdout?: string };
		if (typedError.stderr) details.push(typedError.stderr);
		if (typedError.stdout) details.push(typedError.stdout);
	}

	return /\b(EPERM|EBUSY|EACCES)\b/i.test(details.join("\n"));
}

async function runDocsCheckSubprocess(
	scriptPath: string,
	args: string[],
	options: Parameters<typeof execFileAsync>[2],
) {
	for (
		let attempt = 1;
		attempt <= DOCS_CHECK_SUBPROCESS_ATTEMPTS;
		attempt += 1
	) {
		try {
			return await execFileAsync(process.execPath, [scriptPath, ...args], options);
		} catch (error) {
			if (
				process.platform !== "win32" ||
				attempt === DOCS_CHECK_SUBPROCESS_ATTEMPTS ||
				!isTransientDocsCheckSubprocessError(error)
			) {
				throw error;
			}

			await delay(
				DOCS_CHECK_SUBPROCESS_RETRY_DELAYS_MS[attempt - 1] ??
					DOCS_CHECK_SUBPROCESS_RETRY_DELAYS_MS.at(-1) ??
					100,
			);
		}
	}

	throw new Error("docs-check subprocess retry loop exhausted unexpectedly");
}

async function createRepoFixture(files: Record<string, string>) {
	// docs-check resolves local links against process.cwd(), so fixtures must live
	// under the repo root for relative-link validation to exercise real behavior.
	// .gitignore excludes tmp/ and tmp* so a leftover retry-cleanup fixture does
	// not pollute git status if Windows holds a transient lock on removal.
	const repoTempDir = path.join(process.cwd(), "tmp");
	await mkdir(repoTempDir, { recursive: true });

	const root = await mkdtemp(path.join(repoTempDir, "docs-check-"));
	await writeFixtureFiles(root, files);

	return { root };
}

async function createExternalFixture(files: Record<string, string>) {
	// Workflow badge fallback tests need a directory outside the repo so the git
	// remote lookup can cleanly fail when package metadata is absent.
	const root = await mkdtemp(path.join(tmpdir(), "docs-check-external-"));
	await writeFixtureFiles(root, files);

	return { root };
}

async function createDocsFixture(markdown = "# Guide\n") {
	const { root } = await createRepoFixture({
		"docs/guide.md": markdown,
		"docs/targets/exists.md": "# Target\n",
	});

	const docsFile = path.join(root, "docs", "guide.md");

	return { docsFile, root };
}

describe("docs-check script", () => {
	it("keeps balanced parentheses inside markdown link targets", async () => {
		const { extractMarkdownLinks } = await import("../scripts/ci/docs-check.js");

		const markdown = "[Config Guide](docs/guides/config(v2).md)";

		expect(extractMarkdownLinks(markdown)).toEqual(["docs/guides/config(v2).md"]);
	});

	it("skips anchor-only, external, and site-root-prefixed links", async () => {
		const { validateLink } = await import("../scripts/ci/docs-check.js");
		const { docsFile } = await createDocsFixture();

		await expect(validateLink(docsFile, "#section")).resolves.toBeNull();
		await expect(validateLink(docsFile, "https://example.com/docs")).resolves.toBeNull();
		await expect(validateLink(docsFile, "/docs/development/CONFIG_FIELDS.md")).resolves.toBeNull();
	});

	it("requires an absolute markdown file path", async () => {
		const { validateLink } = await import("../scripts/ci/docs-check.js");

		await expect(validateLink("docs/guide.md", "./targets/exists.md", process.cwd())).rejects.toThrow(
			'validateLink: filePath must be absolute, got "docs/guide.md"',
		);
	});

	it("reports missing workflow badge targets", async () => {
		const { validateLink } = await import("../scripts/ci/docs-check.js");
		const { docsFile } = await createDocsFixture();

		await expect(
			validateLink(
				docsFile,
				"https://github.com/ndycode/oc-chatgpt-multi-auth/actions/workflows/does-not-exist.yml/badge.svg",
			),
		).resolves.toBe("Missing workflow referenced by GitHub Actions badge/link: does-not-exist.yml");
		await expect(
			validateLink(
				docsFile,
				"https://github.com/NdyCode/OC-ChatGPT-Multi-Auth/actions/workflows/does-not-exist.yml/badge.svg",
			),
		).resolves.toBe("Missing workflow referenced by GitHub Actions badge/link: does-not-exist.yml");
		await expect(
			validateLink(
				docsFile,
				"https://github.com/octocat/hello-world/actions/workflows/ci.yml/badge.svg",
			),
		).resolves.toBeNull();
	});

	it("uses package metadata to validate workflow badge targets when GitHub Actions context is unavailable", async () => {
		const { validateLink } = await import("../scripts/ci/docs-check.js");
		const { root } = await createExternalFixture({
			"package.json": JSON.stringify(
				{
					name: "fixture-docs-check",
					repository: {
						type: "git",
						url: "git+https://github.com/example/docs-fixture.git",
					},
				},
				null,
				2,
			),
			"docs/guide.md": "# Guide\n",
			".github/workflows/ci.yml": "name: CI\non: push\n",
		});
		const docsFile = path.join(root, "docs", "guide.md");
		const originalRepository = process.env.GITHUB_REPOSITORY;
		delete process.env.GITHUB_REPOSITORY;

		try {
			await expect(
				validateLink(
					docsFile,
					"https://github.com/example/docs-fixture/actions/workflows/ci.yml/badge.svg",
					root,
				),
			).resolves.toBeNull();
			await expect(
				validateLink(
					docsFile,
					"https://github.com/example/docs-fixture/actions/workflows/missing.yml/badge.svg",
					root,
				),
			).resolves.toBe("Missing workflow referenced by GitHub Actions badge/link: missing.yml");
		} finally {
			if (originalRepository === undefined) {
				delete process.env.GITHUB_REPOSITORY;
			} else {
				process.env.GITHUB_REPOSITORY = originalRepository;
			}
		}
	});

	it("skips workflow badge validation when repository metadata cannot be resolved", async () => {
		const { validateLink } = await import("../scripts/ci/docs-check.js");
		const { root } = await createExternalFixture({
			"docs/guide.md": "# Guide\n",
		});
		const docsFile = path.join(root, "docs", "guide.md");
		const originalRepository = process.env.GITHUB_REPOSITORY;
		delete process.env.GITHUB_REPOSITORY;

		try {
			await expect(
				validateLink(
					docsFile,
					"https://github.com/example/docs-fixture/actions/workflows/ci.yml/badge.svg",
					root,
				),
			).resolves.toBeNull();
		} finally {
			if (originalRepository === undefined) {
				delete process.env.GITHUB_REPOSITORY;
			} else {
				process.env.GITHUB_REPOSITORY = originalRepository;
			}
		}
	});

	it("resolves relative local targets from the markdown file directory", async () => {
		const { validateLink } = await import("../scripts/ci/docs-check.js");
		const { docsFile, root } = await createDocsFixture();

		await expect(validateLink(docsFile, "./targets/exists.md")).resolves.toBeNull();
		await expect(validateLink(docsFile, "./targets/exists.md", root)).resolves.toBeNull();
		await expect(validateLink(docsFile, "./targets/missing.md")).resolves.toBe("Missing local target: ./targets/missing.md");
		await expect(validateLink(docsFile, "../../../../outside.md")).resolves.toBe(
			"Local target escapes repository root: ../../../../outside.md",
		);
	});

	it("decodes URL-escaped local paths before checking the filesystem", async () => {
		const { validateLink } = await import("../scripts/ci/docs-check.js");
		const { root } = await createRepoFixture({
			"docs/guide.md": "[Space](./My%20Guide.md)\n[Literal](./bad%2Gname.md)\n",
			"docs/My Guide.md": "# Decoded path target\n",
			"docs/bad%2Gname.md": "# Literal percent target\n",
		});
		const docsFile = path.join(root, "docs", "guide.md");

		await expect(validateLink(docsFile, "./My%20Guide.md", root)).resolves.toBeNull();
		await expect(validateLink(docsFile, "./bad%2Gname.md", root)).resolves.toBeNull();
	});

	it("unescapes markdown-escaped local targets before checking the filesystem", async () => {
		const { extractMarkdownLinks, validateLink } = await import("../scripts/ci/docs-check.js");
		const { root } = await createRepoFixture({
			"docs/guide.md": "[Escaped](./array\\[1\\]\\ \\(v2\\).md)\n",
			"docs/array[1] (v2).md": "# Escaped target\n",
		});
		const docsFile = path.join(root, "docs", "guide.md");
		const markdown = await readFile(docsFile, "utf8");
		const [linkTarget] = extractMarkdownLinks(markdown);

		expect(linkTarget).toBe("./array[1] (v2).md");
		await expect(validateLink(docsFile, linkTarget, root)).resolves.toBeNull();
	});

	it("normalizes direct-run paths consistently for the current platform", async () => {
		const { normalizePathForCompare } = await import("../scripts/ci/docs-check.js");

		const input = process.platform === "win32" ? "C:\\Temp\\Example\\..\\Test.js" : "./scripts/../README.md";
		const resolved = path.resolve(input);
		const expected = process.platform === "win32" ? resolved.toLowerCase() : resolved;

		expect(normalizePathForCompare(input)).toBe(expected);
	});

	it("extracts reference-style definitions so missing targets are still caught", async () => {
		const { extractMarkdownLinks, validateLink } = await import("../scripts/ci/docs-check.js");
		const { docsFile } = await createDocsFixture("[Config Guide][config]\n\n[config]: ./targets/missing.md\n");
		const markdown = await readFile(docsFile, "utf8");
		const [referenceTarget] = extractMarkdownLinks(markdown);

		expect(referenceTarget).toBe("./targets/missing.md");
		await expect(validateLink(docsFile, referenceTarget)).resolves.toBe("Missing local target: ./targets/missing.md");
	});

	it("extracts shortcut reference links so missing targets are still caught", async () => {
		const { extractMarkdownLinks, validateLink } = await import("../scripts/ci/docs-check.js");
		const { docsFile } = await createDocsFixture("[config]\n\n[config]: ./targets/missing.md\n");
		const markdown = await readFile(docsFile, "utf8");
		const [referenceTarget] = extractMarkdownLinks(markdown);

		expect(referenceTarget).toBe("./targets/missing.md");
		await expect(validateLink(docsFile, referenceTarget)).resolves.toBe("Missing local target: ./targets/missing.md");
	});

	it("does not treat inline or full reference links as shortcut references", async () => {
		const { extractMarkdownLinks } = await import("../scripts/ci/docs-check.js");

		const markdown = [
			"[Inline](./targets/inline.md)",
			"[Config][cfg]",
			"",
			"[inline]: ./targets/inline-shortcut.md",
			"[cfg]: ./targets/full.md",
			"[config]: ./targets/full-shortcut.md",
			"",
		].join("\n");

		expect(extractMarkdownLinks(markdown)).toEqual(["./targets/inline.md", "./targets/full.md"]);
	});

	it("ignores links that only appear inside HTML comments", async () => {
		const { extractMarkdownLinks } = await import("../scripts/ci/docs-check.js");

		const markdown = "<!-- [deprecated](./targets/missing.md) -->\n[Config Guide](./targets/exists.md)\n";

		expect(extractMarkdownLinks(markdown)).toEqual(["./targets/exists.md"]);
	});

	it("ignores links that only appear inside tilde-fenced code blocks", async () => {
		const { extractMarkdownLinks } = await import("../scripts/ci/docs-check.js");

		const markdown = "~~~bash\n[missing](./targets/missing.md)\n~~~\n[Config Guide](./targets/exists.md)\n";

		expect(extractMarkdownLinks(markdown)).toEqual(["./targets/exists.md"]);
	});

	it("accepts angle-bracket targets that include an optional title", async () => {
		const { extractMarkdownLinks, validateLink } = await import("../scripts/ci/docs-check.js");
		const { docsFile } = await createDocsFixture('[Config Guide](<./targets/exists.md> "Config target")\n');
		const markdown = await readFile(docsFile, "utf8");
		const [linkTarget] = extractMarkdownLinks(markdown);

		expect(linkTarget).toBe("./targets/exists.md");
		await expect(validateLink(docsFile, linkTarget)).resolves.toBeNull();
	});

	it("discovers default markdown files and skips ignored directories", async () => {
		const { collectMarkdownFiles } = await import("../scripts/ci/docs-check.js");
		const { root } = await createRepoFixture({
			"AGENTS.md": "# Instructions\n",
			"README.md": "# Root\n",
			"CODE_OF_CONDUCT.md": "# Code of Conduct\n",
			"CONTRIBUTING.md": "# Contributing\n",
			"SECURITY.md": "# Security\n",
			"CHANGELOG.md": "# Changelog\n",
			".github/pull_request_template.md": "# PR Template\n",
			".github/workflows/ignored.md": "# Ignored workflow doc\n",
			"config/README.md": "# Config\n",
			"docs/guide.md": "# Guide\n",
			"docs/sub/nested.markdown": "# Nested\n",
			"test/AGENTS.md": "# Test instructions\n",
			"notes/outside.md": "# Outside default dirs\n",
			"tmp/ignored.md": "# Ignored temp\n",
			"dist/ignored.md": "# Ignored dist\n",
			"node_modules/pkg/ignored.md": "# Ignored dependency\n",
		});

		const discoveredFiles = await collectMarkdownFiles([], root);
		const relativeDiscoveredFiles = discoveredFiles.map((filePath: string) =>
			path.relative(root, filePath).replace(/\\/g, "/"),
		);

		expect(relativeDiscoveredFiles).toEqual([
			".github/pull_request_template.md",
			"AGENTS.md",
			"CHANGELOG.md",
			"CODE_OF_CONDUCT.md",
			"CONTRIBUTING.md",
			"README.md",
			"SECURITY.md",
			"config/README.md",
			"docs/guide.md",
			"docs/sub/nested.markdown",
			"test/AGENTS.md",
		]);
	});

	it("collects only explicitly requested markdown files or directories", async () => {
		const { collectMarkdownFiles } = await import("../scripts/ci/docs-check.js");
		const { root } = await createRepoFixture({
			"README.md": "# Root\n",
			"docs/guide.md": "# Guide\n",
			"docs/sub/nested.markdown": "# Nested\n",
			"notes/extra.md": "# Extra\n",
		});

		const explicitFile = await collectMarkdownFiles(["README.md"], root);
		const explicitDirectory = await collectMarkdownFiles(["docs"], root);

		expect(explicitFile.map((filePath: string) => path.relative(root, filePath).replace(/\\/g, "/"))).toEqual(["README.md"]);
		expect(explicitDirectory.map((filePath: string) => path.relative(root, filePath).replace(/\\/g, "/"))).toEqual([
			"docs/guide.md",
			"docs/sub/nested.markdown",
		]);
	});

	it("silently skips missing explicit paths", async () => {
		const { collectMarkdownFiles } = await import("../scripts/ci/docs-check.js");
		const { root } = await createRepoFixture({
			"docs/guide.md": "# Guide\n",
		});

		await expect(collectMarkdownFiles(["missing.md", "missing-dir"], root)).resolves.toEqual([]);
	});

	it("runs the direct docs-check pipeline for an explicit fixture path", async () => {
		const { root } = await createRepoFixture({
			"docs/guide.md": "[Target](./targets/exists.md)\n",
			"docs/targets/exists.md": "# Target\n",
		});
		const scriptPath = path.resolve(process.cwd(), "scripts/ci/docs-check.js");
		const relativeFixtureRoot = path.relative(process.cwd(), root).replace(/\\/g, "/");

		const { stdout, stderr } = await runDocsCheckSubprocess(scriptPath, [relativeFixtureRoot], {
			cwd: process.cwd(),
			timeout: DOCS_CHECK_SUBPROCESS_TIMEOUT_MS,
		});

		expect(stdout).toContain("docs-check: verified 2 markdown file(s)");
		expect(stderr).toBe("");
	});

	it("exits cleanly when no markdown files are found", async () => {
		const { root } = await createRepoFixture({});
		const scriptPath = path.resolve(process.cwd(), "scripts/ci/docs-check.js");
		const relativeFixtureRoot = path.relative(process.cwd(), root).replace(/\\/g, "/");

		const { stdout, stderr } = await runDocsCheckSubprocess(scriptPath, [relativeFixtureRoot], {
			cwd: process.cwd(),
			timeout: DOCS_CHECK_SUBPROCESS_TIMEOUT_MS,
		});

		expect(stdout).toContain("docs-check: no markdown files found");
		expect(stderr).toBe("");
	});

	it("runs the direct docs-check pipeline in default-scan mode", async () => {
		const { root } = await createRepoFixture({
			"README.md": "# Root\n",
			"docs/guide.md": "[Target](./targets/exists.md)\n",
			"docs/targets/exists.md": "# Target\n",
		});
		const scriptPath = path.resolve(process.cwd(), "scripts/ci/docs-check.js");

		const { stdout, stderr } = await runDocsCheckSubprocess(scriptPath, [], {
			cwd: root,
			timeout: DOCS_CHECK_SUBPROCESS_TIMEOUT_MS,
		});

		expect(stdout).toContain("docs-check: verified 3 markdown file(s)");
		expect(stderr).toBe("");
	});

	it("exits with an error when the direct docs-check pipeline finds broken links", async () => {
		const { root } = await createRepoFixture({
			"docs/guide.md": "[Missing](./targets/missing.md)\n",
		});
		const scriptPath = path.resolve(process.cwd(), "scripts/ci/docs-check.js");
		const relativeFixtureRoot = path.relative(process.cwd(), root).replace(/\\/g, "/");
		let failure: (Error & { code?: number; stderr?: string; stdout?: string }) | null = null;

		try {
			await runDocsCheckSubprocess(scriptPath, [relativeFixtureRoot], {
				cwd: process.cwd(),
				timeout: DOCS_CHECK_SUBPROCESS_TIMEOUT_MS,
			});
		} catch (error) {
			if (error instanceof Error) {
				failure = error as Error & { code?: number; stderr?: string; stdout?: string };
			} else {
				throw error;
			}
		}

		expect(failure).not.toBeNull();
		expect(failure?.code).toBe(1);
		expect(failure?.stderr).toContain("docs-check found broken documentation links:");
		expect(failure?.stderr).toContain("docs/guide.md: Missing local target: ./targets/missing.md (./targets/missing.md)");
	});

	it("exits with an error when the direct docs-check pipeline finds a broken workflow badge", async () => {
		const { root } = await createRepoFixture({
			"docs/guide.md":
				"[CI](https://github.com/ndycode/oc-chatgpt-multi-auth/actions/workflows/does-not-exist.yml/badge.svg)\n",
		});
		const scriptPath = path.resolve(process.cwd(), "scripts/ci/docs-check.js");
		const relativeFixtureRoot = path.relative(process.cwd(), root).replace(/\\/g, "/");
		let failure: (Error & { code?: number; stderr?: string; stdout?: string }) | null = null;

		try {
			await runDocsCheckSubprocess(scriptPath, [relativeFixtureRoot], {
				cwd: process.cwd(),
				timeout: DOCS_CHECK_SUBPROCESS_TIMEOUT_MS,
			});
		} catch (error) {
			if (error instanceof Error) {
				failure = error as Error & { code?: number; stderr?: string; stdout?: string };
			} else {
				throw error;
			}
		}

		expect(failure).not.toBeNull();
		expect(failure?.code).toBe(1);
		expect(failure?.stderr).toContain("docs-check found broken documentation links:");
		expect(failure?.stderr).toContain("Missing workflow referenced by GitHub Actions badge/link: does-not-exist.yml");
	});
});
