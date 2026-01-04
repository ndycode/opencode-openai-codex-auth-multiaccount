import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { OAuthServerInfo } from "../types.js";

// Resolve path to oauth-success.html (one level up from auth/ subfolder)
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const successHtml = fs.readFileSync(path.join(__dirname, "..", "oauth-success.html"), "utf-8");

/**
 * Start a small local HTTP server that waits for /auth/callback and returns the code
 * @param options - OAuth state for validation
 * @returns Promise that resolves to server info
 */
export function startLocalOAuthServer({ state }: { state: string }): Promise<OAuthServerInfo> {
	const server = http.createServer((req, res) => {
		try {
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
			res.end(successHtml);
			(server as http.Server & { _lastCode?: string })._lastCode = code;
		} catch {
			res.statusCode = 500;
			res.end("Internal error");
		}
	});

	return new Promise((resolve) => {
		server
			.listen(1455, "127.0.0.1", () => {
				resolve({
					port: 1455,
					ready: true,
					close: () => server.close(),
					waitForCode: async () => {
						const poll = () => new Promise<void>((r) => setTimeout(r, 100));
						for (let i = 0; i < 600; i++) {
							const lastCode = (server as http.Server & { _lastCode?: string })._lastCode;
							if (lastCode) return { code: lastCode };
							await poll();
						}
						return null;
					},
				});
			})
			.on("error", (err: NodeJS.ErrnoException) => {
				console.error(
					"[openai-codex-plugin] Failed to bind http://127.0.0.1:1455 (",
					err?.code,
					") Falling back to manual paste.",
				);
				resolve({
					port: 1455,
					ready: false,
					close: () => {
						try {
							server.close();
						} catch {}
					},
					waitForCode: async () => null,
				});
			});
	});
}
