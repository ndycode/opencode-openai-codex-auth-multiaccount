/**
 * Sentinel error codes and factory/matcher helpers.
 *
 * These sentinels are the runtime contract between throwing code paths (e.g.
 * request pipeline, usage tracking) and the orchestrator in `index.ts` that
 * inspects error messages to decide on account rotation, cooldown, and retry
 * behaviour. Keeping the sentinel string and its create/match helpers in one
 * module guarantees producers and consumers cannot drift apart.
 *
 * This module is pure: it performs no I/O, persistence, or logging, so
 * centralizing these values does not introduce new Windows lock or
 * token-redaction surfaces.
 */
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
