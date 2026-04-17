import { describe, expect, it } from "vitest";
import {
	createDeactivatedWorkspaceError,
	createUsageRequestTimeoutError,
	DEACTIVATED_WORKSPACE_ERROR_CODE,
	isDeactivatedWorkspaceErrorMessage,
	isUsageRequestTimeoutMessage,
	USAGE_REQUEST_TIMEOUT_MESSAGE,
} from "../lib/error-sentinels.js";

describe("error sentinels", () => {
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
});
