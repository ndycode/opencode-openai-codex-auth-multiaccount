import { readFileSync } from "node:fs";
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
});
