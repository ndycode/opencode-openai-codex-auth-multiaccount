/**
 * Shared runtime constants and sentinel helpers only. This module is pure: it
 * does not perform I/O, persistence, or logging, so centralizing these values
 * does not introduce new Windows lock or token-redaction surfaces.
 */
export const OAUTH_CALLBACK_LOOPBACK_HOST = "127.0.0.1";
export const OAUTH_CALLBACK_PORT = 1455;
export const OAUTH_CALLBACK_PATH = "/auth/callback";
export const OAUTH_CALLBACK_BIND_URL = `http://${OAUTH_CALLBACK_LOOPBACK_HOST}:${OAUTH_CALLBACK_PORT}`;

export const DEACTIVATED_WORKSPACE_ERROR_CODE = "deactivated_workspace";
export const USAGE_REQUEST_TIMEOUT_MESSAGE = "Usage request timed out";

export function createDeactivatedWorkspaceError(): Error {
	return new Error(DEACTIVATED_WORKSPACE_ERROR_CODE);
}

export function isDeactivatedWorkspaceErrorMessage(message: string | undefined): boolean {
	return message === DEACTIVATED_WORKSPACE_ERROR_CODE;
}

export function createUsageRequestTimeoutError(): Error {
	return new Error(USAGE_REQUEST_TIMEOUT_MESSAGE);
}

export function isUsageRequestTimeoutMessage(message: string | undefined): boolean {
	return message === USAGE_REQUEST_TIMEOUT_MESSAGE;
}
