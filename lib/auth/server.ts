import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { OAuthServerInfo } from "../types.js";
import { logError, logWarn } from "../logger.js";
import {
	OAUTH_CALLBACK_BIND_URL,
	OAUTH_CALLBACK_LOOPBACK_HOST,
	OAUTH_CALLBACK_PATH,
	OAUTH_CALLBACK_PORT,
} from "../runtime-contracts.js";

// Resolve path to oauth-success.html (one level up from auth/ subfolder)
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const successHtml = fs.readFileSync(path.join(__dirname, "..", "oauth-success.html"), "utf-8");

/**
 * Start a small local HTTP server that waits for /auth/callback and returns the code
 * @param options - OAuth state for validation
 * @returns Promise that resolves to server info
 */
export function startLocalOAuthServer({ state }: { state: string }): Promise<OAuthServerInfo> {
	let pollAborted = false;
	const server = http.createServer((req, res) => {
		try {
			const url = new URL(req.url || "", "http://localhost");
			if (url.pathname !== OAUTH_CALLBACK_PATH) {
				res.statusCode = 404;
				res.end("Not found");
				return;
			}
			if (url.searchParams.get("state") !== state) {
				res.statusCode = 400;
				res.end("State mismatch");
				return;
			}
			const code = url.searchParams.get("code");
			if (!code) {
				res.statusCode = 400;
				res.end("Missing authorization code");
				return;
			}
			res.statusCode = 200;
			res.setHeader("Content-Type", "text/html; charset=utf-8");
			res.setHeader("X-Frame-Options", "DENY");
			res.setHeader("X-Content-Type-Options", "nosniff");
			res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'none'");
			res.end(successHtml);
			(server as http.Server & { _lastCode?: string })._lastCode = code;
	} catch (err) {
		logError(`Request handler error: ${(err as Error)?.message ?? String(err)}`);
		res.statusCode = 500;
		res.end("Internal error");
	}
	});

	server.unref();

	return new Promise((resolve) => {
		server
			.listen(OAUTH_CALLBACK_PORT, OAUTH_CALLBACK_LOOPBACK_HOST, () => {
				resolve({
					port: OAUTH_CALLBACK_PORT,
					ready: true,
					close: () => {
						pollAborted = true;
						server.close();
					},
				waitForCode: async () => {
					const POLL_INTERVAL_MS = 100;
					const TIMEOUT_MS = 5 * 60 * 1000;
					const maxIterations = Math.floor(TIMEOUT_MS / POLL_INTERVAL_MS);
					const poll = () => new Promise<void>((r) => setTimeout(r, POLL_INTERVAL_MS));
					for (let i = 0; i < maxIterations; i++) {
						if (pollAborted) return null;
						const lastCode = (server as http.Server & { _lastCode?: string })._lastCode;
						if (lastCode) return { code: lastCode };
						await poll();
					}
					logWarn("OAuth poll timeout after 5 minutes");
					return null;
				},
				});
			})
			.on("error", (err: NodeJS.ErrnoException) => {
				logError(
					`Failed to bind ${OAUTH_CALLBACK_BIND_URL} (${err?.code}). Suggest device code or manual URL paste.`,
				);
				resolve({
					port: OAUTH_CALLBACK_PORT,
					ready: false,
				close: () => {
					pollAborted = true;
					try {
						server.close();
					} catch (err) {
					logError(`Failed to close OAuth server: ${(err as Error)?.message ?? String(err)}`);
					}
				},
					waitForCode: () => Promise.resolve(null),
				});
			});
	});
}
