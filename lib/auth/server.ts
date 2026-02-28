import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { OAuthServerInfo } from "../types.js";
import { logError, logWarn } from "../logger.js";

// Resolve path to oauth-success.html (one level up from auth/ subfolder)
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SUCCESS_HTML_PATH = path.join(__dirname, "..", "oauth-success.html");
const FALLBACK_SUCCESS_HTML = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Authorization Complete</title>
  </head>
  <body>
    <h1>Authorization complete</h1>
    <p>You can return to OpenCode.</p>
  </body>
</html>`;

function loadSuccessHtml(): string {
	try {
		return fs.readFileSync(SUCCESS_HTML_PATH, "utf-8");
	} catch (error) {
		logWarn("oauth-success.html missing; using fallback success page", {
			path: SUCCESS_HTML_PATH,
			error: (error as Error)?.message ?? String(error),
		});
		return FALLBACK_SUCCESS_HTML;
	}
}

const successHtml = loadSuccessHtml();

/**
 * Start a small local HTTP server that waits for /auth/callback and returns the code
 * @param options - OAuth state for validation
 * @returns Promise that resolves to server info
 */
export function startLocalOAuthServer({ state }: { state: string }): Promise<OAuthServerInfo> {
	let pollAborted = false;
	let capturedCode: string | undefined;
	let capturedState: string | undefined;
	const server = http.createServer((req, res) => {
		try {
			if ((req.method ?? "GET").toUpperCase() !== "GET") {
				res.statusCode = 405;
				res.setHeader("Allow", "GET");
				res.end("Method not allowed");
				return;
			}
			const url = new URL(req.url || "", "http://localhost");
			if (url.pathname !== "/auth/callback") {
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
			res.setHeader("Cache-Control", "no-store");
			res.setHeader("Pragma", "no-cache");
			res.end(successHtml);
			if (!capturedCode) {
				capturedCode = code;
				capturedState = state;
			}
		} catch (err) {
			logError(`Request handler error: ${(err as Error)?.message ?? String(err)}`);
			res.statusCode = 500;
			res.end("Internal error");
		}
	});

	server.unref();

	return new Promise((resolve) => {
		server
			.listen(1455, "127.0.0.1", () => {
				resolve({
					port: 1455,
					ready: true,
					close: () => {
						pollAborted = true;
						server.close();
					},
					waitForCode: async (expectedState: string) => {
						const POLL_INTERVAL_MS = 100;
						const TIMEOUT_MS = 5 * 60 * 1000;
						const maxIterations = Math.floor(TIMEOUT_MS / POLL_INTERVAL_MS);
						const poll = () => new Promise<void>((r) => setTimeout(r, POLL_INTERVAL_MS));
						for (let i = 0; i < maxIterations; i++) {
							if (pollAborted) return null;
							if (capturedCode && capturedState === expectedState) {
								const code = capturedCode;
								capturedCode = undefined;
								capturedState = undefined;
								return { code };
							}
							await poll();
						}
						logWarn("OAuth poll timeout after 5 minutes");
						return null;
					},
				});
			})
			.on("error", (err: NodeJS.ErrnoException) => {
				logError(
					`Failed to bind http://127.0.0.1:1455 (${err?.code}). Falling back to manual paste.`,
				);
				resolve({
					port: 1455,
					ready: false,
					close: () => {
						pollAborted = true;
						try {
							server.close();
						} catch (err) {
							logError(`Failed to close OAuth server: ${(err as Error)?.message ?? String(err)}`);
						}
					},
					waitForCode: async (_expectedState: string) => Promise.resolve(null),
				});
			});
	});
}
