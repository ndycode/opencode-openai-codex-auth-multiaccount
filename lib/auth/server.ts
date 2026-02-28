import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { OAuthServerInfo } from "../types.js";
import { logError, logWarn } from "../logger.js";

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
	let capturedCode: string | undefined;
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
					waitForCode: async () => {
						const POLL_INTERVAL_MS = 100;
						const TIMEOUT_MS = 5 * 60 * 1000;
						const maxIterations = Math.floor(TIMEOUT_MS / POLL_INTERVAL_MS);
						const poll = () => new Promise<void>((r) => setTimeout(r, POLL_INTERVAL_MS));
						for (let i = 0; i < maxIterations; i++) {
							if (pollAborted) return null;
							if (capturedCode) {
								const code = capturedCode;
								capturedCode = undefined;
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
					waitForCode: () => Promise.resolve(null),
				});
			});
	});
}
