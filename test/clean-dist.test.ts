import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("clean-dist script", () => {
	it("exports cleanDist() for reuse/testing", async () => {
		const mod = await import("../scripts/clean-dist.js");
		expect(typeof mod.cleanDist).toBe("function");
	});

	it("removes only the dist directory under the provided repo root", async () => {
		const mod = await import("../scripts/clean-dist.js");
		const root = await mkdtemp(join(tmpdir(), "opencode-clean-dist-"));
		const staleFile = join(root, "dist", "lib", "stale.js");
		const siblingFile = join(root, "README.md");

		try {
			await mkdir(join(root, "dist", "lib"), { recursive: true });
			await writeFile(staleFile, "stale", "utf8");
			await writeFile(siblingFile, "keep", "utf8");

			await mod.cleanDist({ repoRoot: root });

			await expect(readFile(staleFile, "utf8")).rejects.toMatchObject({
				code: "ENOENT",
			});
			await expect(readFile(siblingFile, "utf8")).resolves.toBe("keep");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("refuses to remove a path other than the repo dist directory", async () => {
		const mod = await import("../scripts/clean-dist.js");
		const root = await mkdtemp(join(tmpdir(), "opencode-clean-dist-"));

		try {
			await expect(
				mod.cleanDist({ repoRoot: root, distDir: join(root, "not-dist") }),
			).rejects.toThrow("Refusing to clean non-dist path");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
