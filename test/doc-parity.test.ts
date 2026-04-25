import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { OAUTH_CALLBACK_PATH, OAUTH_CALLBACK_PORT } from "../lib/oauth-constants.js";
import { transformRequestBody } from "../lib/request/request-transformer.js";
import type { RequestBody, UserConfig } from "../lib/types.js";

const testDir = path.dirname(fileURLToPath(import.meta.url));

function readRepoFile(relativePath: string): string {
	try {
		return readFileSync(path.resolve(testDir, "..", relativePath), "utf8");
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`Failed to read ${relativePath}: ${message}`);
	}
}

function collectRepoFiles(relativeDir: string): string[] {
	const root = path.resolve(testDir, "..", relativeDir);
	const results: string[] = [];

	function visit(dir: string): void {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const fullPath = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				visit(fullPath);
				continue;
			}
			results.push(path.relative(path.resolve(testDir, ".."), fullPath).replaceAll("\\", "/"));
		}
	}

	visit(root);
	return results.sort();
}

describe("runtime documentation parity", () => {
	it("keeps the documented stateless request contract aligned with the runtime transform", async () => {
		const requestBody: RequestBody = {
			model: "gpt-5",
			input: [
				{
					type: "message",
					role: "user",
					content: [{ type: "input_text", text: "quota ping" }],
				},
			],
		};
		const userConfig: UserConfig = { global: {}, models: {} };

		const transformedBody = await transformRequestBody(requestBody, "test instructions", userConfig);

		expect(transformedBody.store).toBe(false);
		expect(transformedBody.include).toContain("reasoning.encrypted_content");

		const docsExpectations: Array<[string, string[]]> = [
			[
				"docs/getting-started.md",
				[
					`http://127.0.0.1:${OAUTH_CALLBACK_PORT}${OAUTH_CALLBACK_PATH}`,
					"`store: false`",
					"`reasoning.encrypted_content`",
				],
			],
			[
				"docs/configuration.md",
				[
					"`reasoning.encrypted_content`",
					"store\": false",
				],
			],
			[
				"docs/development/ARCHITECTURE.md",
				[
					"`store: false`",
					"`reasoning.encrypted_content`",
				],
			],
			[
				"docs/troubleshooting.md",
				[
					"1455",
					"`reasoning.encrypted_content`",
				],
			],
			[
				"docs/faq.md",
				[
					"`1455`",
				],
			],
		];

		for (const [relativePath, fragments] of docsExpectations) {
			const fileContents = readRepoFile(relativePath);
			for (const fragment of fragments) {
				expect(fileContents).toContain(fragment);
			}
		}
	});

	it("keeps shipped config examples aligned with the stateless Codex contract", () => {
		const configExpectations: Array<[string, string[]]> = [
			[
				"config/minimal-opencode.json",
				[
					"\"store\": false",
					"\"reasoning.encrypted_content\"",
				],
			],
			[
				"config/opencode-modern.json",
				[
					"\"store\": false",
					"\"reasoning.encrypted_content\"",
				],
			],
			[
				"config/opencode-legacy.json",
				[
					"\"store\": false",
					"\"reasoning.encrypted_content\"",
				],
			],
		];

		for (const [relativePath, fragments] of configExpectations) {
			const fileContents = readRepoFile(relativePath);
			for (const fragment of fragments) {
				expect(fileContents).toContain(fragment);
			}
		}
	});

	it("keeps the documented tool layout aligned with the live registry", () => {
		const toolFiles = readdirSync(path.resolve(testDir, "..", "lib/tools"))
			.filter((name) => /^codex-[a-z-]+\.ts$/.test(name))
			.map((name) => name.replace(/\.ts$/, ""))
			.sort();
		const registryContents = readRepoFile("lib/tools/index.ts");
		const registeredTools = Array.from(
			registryContents.matchAll(/"(codex-[a-z-]+)":\s*createCodex/g),
			(match) => match[1],
		).sort();

		expect(registeredTools).toEqual(toolFiles);
		expect(registeredTools).toHaveLength(21);

		const docsExpectations: Array<[string, string[]]> = [
			[
				"docs/development/ARCHITECTURE.md",
				[
					"21 OpenCode tools",
					"every registered `codex-*` tool is its own file under `lib/tools/`",
				],
			],
			[
				"docs/development/TESTING.md",
				[
					"Confirm commands exist in `lib/tools/index.ts`",
					"test/tools-codex-*.test.ts",
				],
			],
			[
				"lib/tools/AGENTS.md",
				[
					"21 `codex-*` tools",
					"codex-keychain.ts",
				],
			],
		];

		for (const [relativePath, fragments] of docsExpectations) {
			const fileContents = readRepoFile(relativePath);
			for (const fragment of fragments) {
				expect(fileContents).toContain(fragment);
			}
		}
	});

	it("keeps the documented docs layout aligned with the live docs tree", () => {
		const docsFiles = collectRepoFiles("docs");
		const requiredDocs = [
			"docs/_config.yml",
			"docs/DOCUMENTATION.md",
			"docs/README.md",
			"docs/index.md",
			"docs/getting-started.md",
			"docs/configuration.md",
			"docs/troubleshooting.md",
			"docs/faq.md",
			"docs/privacy.md",
			"docs/OPENCODE_PR_PROPOSAL.md",
			"docs/development/ARCHITECTURE.md",
			"docs/development/CONFIG_FIELDS.md",
			"docs/development/CONFIG_FLOW.md",
			"docs/development/TESTING.md",
			"docs/development/TUI_PARITY_CHECKLIST.md",
			"docs/audits/INDEX.md",
			"docs/audits/_findings/T01-architecture.md",
			"docs/audits/_findings/T16-code-health.md",
			"docs/audits/_meta/findings-ledger.csv",
			"docs/audits/_meta/verification-report.md",
		];

		for (const relativePath of requiredDocs) {
			expect(docsFiles).toContain(relativePath);
		}

		const numberedAuditFiles = docsFiles.filter((relativePath) =>
			/^docs\/audits\/\d{2}-[a-z0-9-]+\.md$/.test(relativePath),
		);
		const findingFiles = docsFiles.filter((relativePath) =>
			/^docs\/audits\/_findings\/T\d{2}-[a-z0-9-]+\.md$/.test(relativePath),
		);

		expect(numberedAuditFiles).toHaveLength(16);
		expect(findingFiles).toHaveLength(16);

		const docsExpectations: Array<[string, string[]]> = [
			[
				"docs/DOCUMENTATION.md",
				[
					"OPENCODE_PR_PROPOSAL.md",
					"development/",
					"audits/",
					"_findings/",
					"_meta/",
				],
			],
			[
				"docs/development/ARCHITECTURE.md",
				[
					"## Documentation Layout",
					"DOCUMENTATION.md",
					"OPENCODE_PR_PROPOSAL.md",
					"current-structure audit corpus",
				],
			],
			[
				"docs/audits/02-system-map.md",
				[
					"Documentation map:",
					"docs/",
					"development/",
					"audits/",
					"Doc/code alignment rule",
				],
			],
		];

		for (const [relativePath, fragments] of docsExpectations) {
			const fileContents = readRepoFile(relativePath);
			for (const fragment of fragments) {
				expect(fileContents).toContain(fragment);
			}
		}
	});

	it("keeps regenerated audit docs free of stale pre-split anchors", () => {
		const stalePatterns = [
			/d92a8/i,
			/5975-line/i,
			/1296-line/i,
			/18 inline/i,
			/index\.ts:5995/i,
			/index\.ts:4992/i,
		];
		const hits: string[] = [];

		for (const relativePath of collectRepoFiles("docs/audits")) {
			const fileContents = readRepoFile(relativePath);
			for (const pattern of stalePatterns) {
				if (pattern.test(fileContents)) {
					hits.push(`${relativePath}: ${pattern.source}`);
				}
			}
		}

		expect(hits).toEqual([]);
	});
});
