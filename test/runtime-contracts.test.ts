import { describe, expect, it } from "vitest";
import { REDIRECT_URI } from "../lib/auth/auth.js";
import {
	createDeactivatedWorkspaceError,
	createUsageRequestTimeoutError,
	DEACTIVATED_WORKSPACE_ERROR_CODE,
	isDeactivatedWorkspaceErrorMessage,
	isUsageRequestTimeoutMessage,
	OAUTH_CALLBACK_BIND_URL,
	OAUTH_CALLBACK_PATH,
	OAUTH_CALLBACK_PORT,
	USAGE_REQUEST_TIMEOUT_MESSAGE,
} from "../lib/runtime-contracts.js";

describe("runtime contracts", () => {
	it("creates stable sentinel errors for workspace deactivation and usage timeouts", () => {
		const deactivatedWorkspaceError = createDeactivatedWorkspaceError();
		const usageTimeoutError = createUsageRequestTimeoutError();

		expect(deactivatedWorkspaceError.message).toBe(DEACTIVATED_WORKSPACE_ERROR_CODE);
		expect(isDeactivatedWorkspaceErrorMessage(deactivatedWorkspaceError.message)).toBe(true);
		expect(isDeactivatedWorkspaceErrorMessage("workspace-deactivated")).toBe(false);

		expect(usageTimeoutError.message).toBe(USAGE_REQUEST_TIMEOUT_MESSAGE);
		expect(isUsageRequestTimeoutMessage(usageTimeoutError.message)).toBe(true);
		expect(isUsageRequestTimeoutMessage("request timed out")).toBe(false);
	});

	it("keeps the OAuth callback runtime values aligned", () => {
		expect(OAUTH_CALLBACK_PORT).toBe(1455);
		expect(OAUTH_CALLBACK_PATH).toBe("/auth/callback");
		expect(OAUTH_CALLBACK_BIND_URL).toBe(`http://127.0.0.1:${OAUTH_CALLBACK_PORT}`);
		expect(REDIRECT_URI).toBe(`http://localhost:${OAUTH_CALLBACK_PORT}${OAUTH_CALLBACK_PATH}`);
	});
});
