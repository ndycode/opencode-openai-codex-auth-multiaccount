import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, describe, expect, it } from "vitest";

const tempRoots: string[] = [];
const TEMP_CLEANUP_ATTEMPTS = 3;
const TEMP_CLEANUP_DELAY_MS = 100;

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

			await delay(TEMP_CLEANUP_DELAY_MS);
		}
	}
}

afterEach(async () => {
	await Promise.all(tempRoots.splice(0).map((root) => cleanupTempRoot(root)));
});

async function createDocsFixture(markdown = "# Guide\n") {
	// docs-check resolves local links against process.cwd(), so fixtures must live
	// under the repo root for relative-link validation to exercise real behavior.
	const repoTempDir = path.join(process.cwd(), "tmp");
	await mkdir(repoTempDir, { recursive: true });

	const root = await mkdtemp(path.join(repoTempDir, "docs-check-"));
	tempRoots.push(root);

	const docsDir = path.join(root, "docs");
	const targetsDir = path.join(docsDir, "targets");
	await mkdir(targetsDir, { recursive: true });

	const docsFile = path.join(docsDir, "guide.md");
	await writeFile(docsFile, markdown, "utf8");

	const existingTarget = path.join(targetsDir, "exists.md");
	await writeFile(existingTarget, "# Target\n", "utf8");

	return { docsFile, root };
}

describe("docs-check script", () => {
	it("keeps balanced parentheses inside markdown link targets", async () => {
		const { extractMarkdownLinks } = await import("../scripts/ci/docs-check.js");

		const markdown = "[Config Guide](docs/guides/config(v2).md)";

		expect(extractMarkdownLinks(markdown)).toEqual(["docs/guides/config(v2).md"]);
	});

	it("skips anchor-only and external links", async () => {
		const { validateLink } = await import("../scripts/ci/docs-check.js");
		const { docsFile } = await createDocsFixture();

		await expect(validateLink(docsFile, "#section")).resolves.toBeNull();
		await expect(validateLink(docsFile, "https://example.com/docs")).resolves.toBeNull();
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

	it("accepts angle-bracket targets that include an optional title", async () => {
		const { extractMarkdownLinks, validateLink } = await import("../scripts/ci/docs-check.js");
		const { docsFile } = await createDocsFixture('[Config Guide](<./targets/exists.md> "Config target")\n');
		const markdown = await readFile(docsFile, "utf8");
		const [linkTarget] = extractMarkdownLinks(markdown);

		expect(linkTarget).toBe("./targets/exists.md");
		await expect(validateLink(docsFile, linkTarget)).resolves.toBeNull();
	});
});
