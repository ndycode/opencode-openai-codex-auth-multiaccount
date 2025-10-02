import http from "node:http";

/**
 * Start a small local HTTP server that waits for /auth/callback and returns the code
 * @param {{state: string}} options - OAuth state for validation
 * @returns {Promise<{port: number, close: () => void, waitForCode: () => Promise<{code: string} | null>}>}
 */
export function startLocalOAuthServer({ state }) {
	const server = http.createServer((req, res) => {
		try {
			const url = new URL(req.url, "http://localhost");
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
			res.end(
				"<html><body>OpenAI ChatGPT login complete. You can close this window.</body></html>",
			);
			server._lastCode = code;
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
					close: () => server.close(),
					waitForCode: async () => {
						const poll = () => new Promise((r) => setTimeout(r, 100));
						for (let i = 0; i < 600; i++) {
							if (server._lastCode) return { code: server._lastCode };
							await poll();
						}
						return null;
					},
				});
			})
			.on("error", (err) => {
				console.error(
					"[openai-codex-plugin] Failed to bind http://127.0.0.1:1455 (",
					err?.code,
					") Falling back to manual paste.",
				);
				resolve({
					port: 1455,
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
