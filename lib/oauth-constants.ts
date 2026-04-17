/**
 * OAuth callback loopback constants.
 *
 * These define the 127.0.0.1 loopback address, port, and path that both the
 * local OAuth callback server (`lib/auth/server.ts`) and the redirect URI
 * builder (`lib/auth/auth.ts`) must agree on. Keeping them in one module
 * prevents drift between the bound host/port and the advertised redirect URI,
 * which RFC 8252 §7.3 requires to match exactly.
 *
 * This module is pure: it performs no I/O, persistence, or logging, so
 * centralizing these values does not introduce new Windows lock or
 * token-redaction surfaces.
 */
export const OAUTH_CALLBACK_LOOPBACK_HOST = "127.0.0.1";
export const OAUTH_CALLBACK_PORT = 1455;
export const OAUTH_CALLBACK_PATH = "/auth/callback";
export const OAUTH_CALLBACK_BIND_URL = `http://${OAUTH_CALLBACK_LOOPBACK_HOST}:${OAUTH_CALLBACK_PORT}`;
