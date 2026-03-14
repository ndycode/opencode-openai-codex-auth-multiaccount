import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";

const tempRoots = [];

afterEach(async () => {
	await Promise.all(
		tempRoots.splice(0).map((root) =>
			rm(root, { recursive: true, force: true }).catch((error) => {
				const message = error instanceof Error ? error.message : String(error);
				console.warn(`[docs-check test] failed to clean up ${root}: ${message}`);
			}),
		),
	);
});

async function createDocsFixture(markdown = "# Guide\n") {
	const root = await mkdtemp(path.join(tmpdir(), "docs-check-"));
	tempRoots.push(root);

	const docsDir = path.join(root, "docs");
	const targetsDir = path.join(docsDir, "targets");
	await mkdir(targetsDir, { recursive: true });

	const docsFile = path.join(docsDir, "guide.md");
	await writeFile(docsFile, markdown, "utf8");

	const existingTarget = path.join(targetsDir, "exists.md");
	await writeFile(existingTarget, "# Target\n", "utf8");

	return { docsFile };
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
	});

	it("resolves relative local targets from the markdown file directory", async () => {
		const { validateLink } = await import("../scripts/ci/docs-check.js");
		const { docsFile } = await createDocsFixture();

		await expect(validateLink(docsFile, "./targets/exists.md")).resolves.toBeNull();
		await expect(validateLink(docsFile, "./targets/missing.md")).resolves.toBe("Missing local target: ./targets/missing.md");
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
});
