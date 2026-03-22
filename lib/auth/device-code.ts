import { setTimeout as sleep } from "node:timers/promises";
import { logError } from "../logger.js";
import type { TokenResult } from "../types.js";
import { AUTHORIZE_URL, CLIENT_ID, exchangeAuthorizationCode } from "./auth.js";

const DEFAULT_DEVICE_CODE_MAX_WAIT_MS = 15 * 60 * 1000;
const DEFAULT_DEVICE_CODE_INTERVAL_SECONDS = 5;

export interface DeviceCodeSession {
	verificationUrl: string;
	userCode: string;
	deviceAuthId: string;
	intervalSeconds: number;
}

type DeviceCodeReadyResult = {
	type: "ready";
	session: DeviceCodeSession;
};

type DeviceCodeFailureResult = {
	type: "failed";
	failure: Extract<TokenResult, { type: "failed" }>;
};

type DeviceCodeRequestResponse = {
	deviceAuthId: string;
	userCode: string;
	intervalSeconds: number;
};

type DeviceCodePollResponse = {
	authorizationCode: string;
	codeVerifier: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function getAuthOrigin(authBaseUrl: string = AUTHORIZE_URL): string {
	return new URL(authBaseUrl).origin;
}

function getDeviceAuthApiBase(authBaseUrl?: string): string {
	return `${getAuthOrigin(authBaseUrl)}/api/accounts/deviceauth`;
}

function getDeviceVerificationUrl(authBaseUrl?: string): string {
	return `${getAuthOrigin(authBaseUrl)}/codex/device`;
}

function getDeviceRedirectUri(authBaseUrl?: string): string {
	return `${getAuthOrigin(authBaseUrl)}/deviceauth/callback`;
}

function getErrorMessage(status: number, bodyText: string, fallback: string): string {
	const trimmed = bodyText.trim();
	if (!trimmed) {
		return fallback;
	}
	return `${fallback} (${status}): ${trimmed}`;
}

function parseIntervalSeconds(value: unknown): number {
	if (typeof value === "number" && Number.isFinite(value) && value > 0) {
		return Math.max(1, Math.floor(value));
	}
	if (typeof value === "string") {
		const parsed = Number.parseInt(value.trim(), 10);
		if (Number.isFinite(parsed) && parsed > 0) {
			return Math.max(1, parsed);
		}
	}
	return DEFAULT_DEVICE_CODE_INTERVAL_SECONDS;
}

function parseDeviceCodeRequestResponse(raw: unknown): DeviceCodeRequestResponse | null {
	if (!isRecord(raw)) return null;

	const deviceAuthId =
		typeof raw.device_auth_id === "string" && raw.device_auth_id.trim()
			? raw.device_auth_id.trim()
			: undefined;
	const userCode =
		typeof raw.user_code === "string" && raw.user_code.trim()
			? raw.user_code.trim()
			: typeof raw.usercode === "string" && raw.usercode.trim()
				? raw.usercode.trim()
				: undefined;

	if (!deviceAuthId || !userCode) {
		return null;
	}

	return {
		deviceAuthId,
		userCode,
		intervalSeconds: parseIntervalSeconds(raw.interval),
	};
}

function parseDeviceCodePollResponse(raw: unknown): DeviceCodePollResponse | null {
	if (!isRecord(raw)) return null;

	const authorizationCode =
		typeof raw.authorization_code === "string" && raw.authorization_code.trim()
			? raw.authorization_code.trim()
			: undefined;
	const codeVerifier =
		typeof raw.code_verifier === "string" && raw.code_verifier.trim()
			? raw.code_verifier.trim()
			: undefined;

	if (!authorizationCode || !codeVerifier) {
		return null;
	}

	return {
		authorizationCode,
		codeVerifier,
	};
}

export function buildDeviceCodeInstructions(session: DeviceCodeSession): string {
	return [
		`Open this link and sign in: ${session.verificationUrl}`,
		`Enter this one-time code: ${session.userCode}`,
		"This code expires in about 15 minutes.",
	].join("\n");
}

export async function createDeviceCodeSession(options?: {
	authBaseUrl?: string;
	clientId?: string;
}): Promise<DeviceCodeReadyResult | DeviceCodeFailureResult> {
	const authBaseUrl = options?.authBaseUrl ?? AUTHORIZE_URL;
	const clientId = options?.clientId ?? CLIENT_ID;

	try {
		const response = await fetch(`${getDeviceAuthApiBase(authBaseUrl)}/usercode`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ client_id: clientId }),
		});

		if (!response.ok) {
			const bodyText = await response.text().catch(() => "");
			const message =
				response.status === 404
					? "Device code login is not enabled for this auth server. Retry with browser login or manual URL paste."
					: getErrorMessage(
						response.status,
						bodyText,
						"Device code login could not be started",
					);
			logError(`device-code usercode request failed: ${response.status} ${bodyText}`);
			return {
				type: "failed",
				failure: {
					type: "failed",
					reason: "http_error",
					statusCode: response.status,
					message,
				},
			};
		}

		const rawJson = (await response.json()) as unknown;
		const parsed = parseDeviceCodeRequestResponse(rawJson);
		if (!parsed) {
			logError("device-code usercode response validation failed", rawJson);
			return {
				type: "failed",
				failure: {
					type: "failed",
					reason: "invalid_response",
					message: "Device code login returned an invalid response",
				},
			};
		}

		return {
			type: "ready",
			session: {
				verificationUrl: getDeviceVerificationUrl(authBaseUrl),
				userCode: parsed.userCode,
				deviceAuthId: parsed.deviceAuthId,
				intervalSeconds: parsed.intervalSeconds,
			},
		};
	} catch (error) {
		const err = error as Error;
		logError("device-code usercode request error", err);
		return {
			type: "failed",
			failure: {
				type: "failed",
				reason: "network_error",
				message: err?.message,
			},
		};
	}
}

export async function completeDeviceCodeSession(
	session: DeviceCodeSession,
	options?: {
		authBaseUrl?: string;
		maxWaitMs?: number;
	},
): Promise<TokenResult> {
	const authBaseUrl = options?.authBaseUrl ?? AUTHORIZE_URL;
	const maxWaitMs = options?.maxWaitMs ?? DEFAULT_DEVICE_CODE_MAX_WAIT_MS;
	const pollUrl = `${getDeviceAuthApiBase(authBaseUrl)}/token`;
	const startedAt = Date.now();

	try {
		while (Date.now() - startedAt < maxWaitMs) {
			const response = await fetch(pollUrl, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					device_auth_id: session.deviceAuthId,
					user_code: session.userCode,
				}),
			});

			if (response.ok) {
				const rawJson = (await response.json()) as unknown;
				const parsed = parseDeviceCodePollResponse(rawJson);
				if (!parsed) {
					logError("device-code token poll response validation failed", rawJson);
					return {
						type: "failed",
						reason: "invalid_response",
						message: "Device code login returned an invalid authorization payload",
					};
				}

				return await exchangeAuthorizationCode(
					parsed.authorizationCode,
					parsed.codeVerifier,
					getDeviceRedirectUri(authBaseUrl),
				);
			}

			if (response.status === 403 || response.status === 404) {
				await sleep(session.intervalSeconds * 1000);
				continue;
			}

			const bodyText = await response.text().catch(() => "");
			logError(`device-code token poll failed: ${response.status} ${bodyText}`);
			return {
				type: "failed",
				reason: "http_error",
				statusCode: response.status,
				message: getErrorMessage(
					response.status,
					bodyText,
					"Device code authorization failed",
				),
			};
		}

		return {
			type: "failed",
			reason: "unknown",
			message: "Device code authorization timed out after 15 minutes",
		};
	} catch (error) {
		const err = error as Error;
		logError("device-code token poll error", err);
		return {
			type: "failed",
			reason: "network_error",
			message: err?.message,
		};
	}
}
