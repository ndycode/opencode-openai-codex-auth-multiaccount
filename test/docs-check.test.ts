import { describe, expect, it } from "vitest";

describe("docs-check script", () => {
	it("keeps balanced parentheses inside markdown link targets", async () => {
		const { extractMarkdownLinks } = await import("../scripts/ci/docs-check.js");

		const markdown = "[Config Guide](docs/guides/config(v2).md)";

		expect(extractMarkdownLinks(markdown)).toEqual(["docs/guides/config(v2).md"]);
	});
});
