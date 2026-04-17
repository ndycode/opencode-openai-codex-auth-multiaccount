import { describe, expect, it } from "vitest";
import { REDIRECT_URI } from "../lib/auth/auth.js";
import {
	createDeactivatedWorkspaceError,
	createUsageRequestTimeoutError,
	DEACTIVATED_WORKSPACE_ERROR_CODE,
	isDeactivatedWorkspaceErrorMessage,
	isUsageRequestTimeoutMessage,
	OAUTH_CALLBACK_BIND_URL,
	OAUTH_CALLBACK_LOOPBACK_HOST,
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
		expect(OAUTH_CALLBACK_LOOPBACK_HOST).toBe("127.0.0.1");
		expect(OAUTH_CALLBACK_BIND_URL).toBe(`http://127.0.0.1:${OAUTH_CALLBACK_PORT}`);
		// RFC 8252 §7.3: redirect URI MUST use the 127.0.0.1 literal, matching
		// the host the callback server binds to. `localhost` would resolve via
		// DNS and is not equivalent.
		expect(REDIRECT_URI).toBe(
			`http://${OAUTH_CALLBACK_LOOPBACK_HOST}:${OAUTH_CALLBACK_PORT}${OAUTH_CALLBACK_PATH}`,
		);
		expect(REDIRECT_URI).toContain("127.0.0.1");
		expect(REDIRECT_URI).not.toContain("localhost");
	});
});
