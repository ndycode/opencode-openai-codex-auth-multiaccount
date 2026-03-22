import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { REDIRECT_URI } from "../lib/auth/auth.js";
import { transformRequestBody } from "../lib/request/request-transformer.js";
import {
	createDeactivatedWorkspaceError,
	createUsageRequestTimeoutError,
	DEACTIVATED_WORKSPACE_ERROR_CODE,
	isDeactivatedWorkspaceErrorMessage,
	OAUTH_CALLBACK_BIND_URL,
	OAUTH_CALLBACK_PATH,
	OAUTH_CALLBACK_PORT,
	USAGE_REQUEST_TIMEOUT_MESSAGE,
} from "../lib/runtime-contracts.js";
import type { RequestBody, UserConfig } from "../lib/types.js";

const testDir = path.dirname(fileURLToPath(import.meta.url));

function readRepoFile(relativePath: string): string {
	return readFileSync(path.resolve(testDir, "..", relativePath), "utf8");
}

describe("runtime contracts", () => {
	it("creates stable sentinel errors for workspace deactivation and usage timeouts", () => {
		const deactivatedWorkspaceError = createDeactivatedWorkspaceError();
		const usageTimeoutError = createUsageRequestTimeoutError();

		expect(deactivatedWorkspaceError.message).toBe(DEACTIVATED_WORKSPACE_ERROR_CODE);
		expect(isDeactivatedWorkspaceErrorMessage(deactivatedWorkspaceError.message)).toBe(true);
		expect(isDeactivatedWorkspaceErrorMessage("workspace-deactivated")).toBe(false);

		expect(usageTimeoutError.message).toBe(USAGE_REQUEST_TIMEOUT_MESSAGE);
	});

	it("keeps the OAuth callback runtime values aligned", () => {
		expect(OAUTH_CALLBACK_PORT).toBe(1455);
		expect(OAUTH_CALLBACK_PATH).toBe("/auth/callback");
		expect(OAUTH_CALLBACK_BIND_URL).toBe(`http://127.0.0.1:${OAUTH_CALLBACK_PORT}`);
		expect(REDIRECT_URI).toBe(`http://localhost:${OAUTH_CALLBACK_PORT}${OAUTH_CALLBACK_PATH}`);
	});

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
