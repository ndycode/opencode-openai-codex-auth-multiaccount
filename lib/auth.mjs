import { generatePKCE } from "@openauthjs/openauth/pkce";
import { randomBytes } from "node:crypto";

// OAuth constants (from openai/codex)
export const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
export const AUTHORIZE_URL = "https://auth.openai.com/oauth/authorize";
export const TOKEN_URL = "https://auth.openai.com/oauth/token";
export const REDIRECT_URI = "http://localhost:1455/auth/callback";
export const SCOPE = "openid profile email offline_access";

/**
 * Generate a random state value for OAuth flow
 * @returns {string} Random hex string
 */
export function createState() {
	return randomBytes(16).toString("hex");
}

/**
 * Parse authorization code and state from user input
 * @param {string} input - User input (URL, code#state, or just code)
 * @returns {{code?: string, state?: string}} Parsed authorization data
 */
export function parseAuthorizationInput(input) {
	const value = (input || "").trim();
	if (!value) return {};

	try {
		const url = new URL(value);
		return {
			code: url.searchParams.get("code") ?? undefined,
			state: url.searchParams.get("state") ?? undefined,
		};
	} catch {}

	if (value.includes("#")) {
		const [code, state] = value.split("#", 2);
		return { code, state };
	}
	if (value.includes("code=")) {
		const params = new URLSearchParams(value);
		return {
			code: params.get("code") ?? undefined,
			state: params.get("state") ?? undefined,
		};
	}
	return { code: value };
}

/**
 * Exchange authorization code for access and refresh tokens
 * @param {string} code - Authorization code from OAuth flow
 * @param {string} verifier - PKCE verifier
 * @param {string} [redirectUri] - OAuth redirect URI
 * @returns {Promise<{type: "success", access: string, refresh: string, expires: number} | {type: "failed"}>}
 */
export async function exchangeAuthorizationCode(
	code,
	verifier,
	redirectUri = REDIRECT_URI,
) {
	const res = await fetch(TOKEN_URL, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			grant_type: "authorization_code",
			client_id: CLIENT_ID,
			code,
			code_verifier: verifier,
			redirect_uri: redirectUri,
		}),
	});
	if (!res.ok) {
		const text = await res.text().catch(() => "");
		console.error("[openai-codex-auth] code->token failed:", res.status, text);
		return { type: "failed" };
	}
	const json = await res.json();
	if (
		!json?.access_token ||
		!json?.refresh_token ||
		typeof json?.expires_in !== "number"
	) {
		console.error("[openai-codex-auth] token response missing fields:", json);
		return { type: "failed" };
	}
	return {
		type: "success",
		access: json.access_token,
		refresh: json.refresh_token,
		expires: Date.now() + json.expires_in * 1000,
	};
}

/**
 * Decode a JWT token to extract payload
 * @param {string} token - JWT token to decode
 * @returns {any} Decoded payload or null if invalid
 */
export function decodeJWT(token) {
	try {
		const parts = token.split(".");
		if (parts.length !== 3) return null;
		const payload = parts[1];
		const decoded = Buffer.from(payload, "base64").toString("utf-8");
		return JSON.parse(decoded);
	} catch {
		return null;
	}
}

/**
 * Refresh access token using refresh token
 * @param {string} refreshToken - Refresh token
 * @returns {Promise<{type: "success", access: string, refresh: string, expires: number} | {type: "failed"}>}
 */
export async function refreshAccessToken(refreshToken) {
	try {
		const response = await fetch(TOKEN_URL, {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				grant_type: "refresh_token",
				refresh_token: refreshToken,
				client_id: CLIENT_ID,
			}),
		});

		if (!response.ok) {
			const text = await response.text().catch(() => "");
			console.error(
				"[openai-codex-plugin] Token refresh failed:",
				response.status,
				text,
			);
			return { type: "failed" };
		}

		const json = await response.json();
		if (
			!json?.access_token ||
			!json?.refresh_token ||
			typeof json?.expires_in !== "number"
		) {
			console.error(
				"[openai-codex-plugin] Token refresh response missing fields:",
				json,
			);
			return { type: "failed" };
		}

		return {
			type: "success",
			access: json.access_token,
			refresh: json.refresh_token,
			expires: Date.now() + json.expires_in * 1000,
		};
	} catch (error) {
		console.error("[openai-codex-plugin] Token refresh error:", error);
		return { type: "failed" };
	}
}

/**
 * Create OAuth authorization flow
 * @returns {Promise<{pkce: any, state: string, url: string}>}
 */
export async function createAuthorizationFlow() {
	const pkce = await generatePKCE();
	const state = createState();

	const url = new URL(AUTHORIZE_URL);
	url.searchParams.set("response_type", "code");
	url.searchParams.set("client_id", CLIENT_ID);
	url.searchParams.set("redirect_uri", REDIRECT_URI);
	url.searchParams.set("scope", SCOPE);
	url.searchParams.set("code_challenge", pkce.challenge);
	url.searchParams.set("code_challenge_method", "S256");
	url.searchParams.set("state", state);
	url.searchParams.set("id_token_add_organizations", "true");
	url.searchParams.set("codex_cli_simplified_flow", "true");
	url.searchParams.set("originator", "codex_cli_rs");

	return { pkce, state, url: url.toString() };
}
