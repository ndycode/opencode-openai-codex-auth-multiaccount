import { spawn } from "node:child_process";
import {
	createAuthorizationFlow,
	exchangeAuthorizationCode,
	decodeJWT,
	refreshAccessToken,
	REDIRECT_URI,
} from "./lib/auth.mjs";
import { getCodexInstructions, TOOL_REMAP_MESSAGE } from "./lib/codex.mjs";
import { startLocalOAuthServer } from "./lib/server.mjs";

/**
 * @type {import('@opencode-ai/plugin').Plugin}
 */
export async function OpenAIAuthPlugin({ client }) {
	return {
		auth: {
			provider: "openai",
			/**
			 * @param {() => Promise<any>} getAuth
			 * @param {any} _provider
			 */
			async loader(getAuth, _provider) {
				const auth = await getAuth();

				// Only handle OAuth auth type, skip API key auth
				if (auth.type !== "oauth") {
					return {};
				}

				// Extract accountId from access token JWT
				const decoded = decodeJWT(auth.access);
				const accountId =
					decoded?.["https://api.openai.com/auth"]?.chatgpt_account_id;

				if (!accountId) {
					console.error(
						"[openai-codex-plugin] Failed to extract accountId from token",
					);
					return {};
				}

				// Fetch Codex instructions (cached for 24h)
				const CODEX_INSTRUCTIONS = await getCodexInstructions();

				// Return options that will be passed to the OpenAI SDK
				return {
					apiKey: "chatgpt-oauth", // Dummy key - actual auth handled by fetch
					baseURL: "https://chatgpt.com/backend-api",
					/**
					 * @param {any} input
					 * @param {any} init
					 */
					async fetch(input, init) {
						// Get current auth and refresh if needed
						const currentAuth = await getAuth();
						if (
							currentAuth.type !== "oauth" ||
							!currentAuth.access ||
							currentAuth.expires < Date.now()
						) {
							// Token expired or missing, refresh it
							const refreshResult = await refreshAccessToken(
								currentAuth.refresh,
							);
							if (refreshResult.type === "failed") {
								console.error(
									"[openai-codex-plugin] Failed to refresh token, authentication required",
								);
								return new Response(
									JSON.stringify({ error: "Token refresh failed" }),
									{ status: 401 },
								);
							}

							// Update stored credentials
							await client.auth.set({
								path: { id: "openai" },
								body: {
									type: "oauth",
									access: refreshResult.access,
									refresh: refreshResult.refresh,
									expires: refreshResult.expires,
								},
							});

							// Update current auth reference
							currentAuth.access = refreshResult.access;
							currentAuth.refresh = refreshResult.refresh;
							currentAuth.expires = refreshResult.expires;
						}

						let url = typeof input === "string" ? input : input.url;

						// Rewrite /responses to /codex/responses for Codex backend
						url = url.replace("/responses", "/codex/responses");

						// Parse and modify request body
						if (init?.body) {
							try {
								const body = JSON.parse(init.body);

								// Normalize model name - Codex only supports specific model IDs
								// Map all variants to their base models
								if (body.model) {
									if (body.model.includes("codex")) {
										// Any codex variant → gpt-5-codex
										body.model = "gpt-5-codex";
									} else if (
										body.model.includes("gpt-5") ||
										body.model.includes("gpt-nano")
									) {
										// gpt-5 variants → gpt-5-codex for best tool support
										body.model = "gpt-5-codex";
									} else {
										// Default fallback
										body.model = "gpt-5-codex";
									}
								}

								// Codex requires these fields
								body.store = false;
								body.stream = true;
								body.instructions = CODEX_INSTRUCTIONS;

								// Remove items that reference stored conversation history
								// When store=false, previous items aren't persisted, so filter them out
								if (body.input && Array.isArray(body.input)) {
									body.input = body.input.filter((item) => {
										// Keep items without IDs (new messages)
										if (!item.id) return true;
										// Remove items with response/result IDs (rs_*)
										if (item.id?.startsWith("rs_")) return false;
										return true;
									});

									// Insert tool remapping message as first user input
									body.input.unshift({
										type: "message",
										role: "user",
										content: [
											{
												type: "input_text",
												text: TOOL_REMAP_MESSAGE,
											},
										],
									});
								}

								// Fix reasoning parameters for Codex - hardcoded to high
								if (!body.reasoning) {
									body.reasoning = {};
								}
								body.reasoning.effort = "high";
								body.reasoning.summary = "detailed";
								body.text.verbosity = "medium";

								// Remove unsupported parameters
								body.max_output_tokens = undefined;
								body.max_completion_tokens = undefined;

								init.body = JSON.stringify(body);
							} catch (e) {
								console.error(
									"[openai-codex-plugin] Error parsing request:",
									e,
								);
							}
						}

						// Add ChatGPT OAuth headers
						const headers = new Headers(init?.headers ?? {});
						headers.delete("x-api-key");
						headers.set("Authorization", `Bearer ${currentAuth.access}`);
						headers.set("chatgpt-account-id", accountId);
						headers.set("OpenAI-Beta", "responses=experimental");
						headers.set("originator", "codex_cli_rs");
						headers.set("session_id", crypto.randomUUID());

						const response = await fetch(url, {
							...init,
							headers,
						});

						// Log errors
						if (!response.ok) {
							const text = await response.text();
							console.error(
								`[openai-codex-plugin] ${response.status} error:`,
								text,
							);
							// Return a new response with the error text so the SDK can parse it
							return new Response(text, {
								status: response.status,
								statusText: response.statusText,
								headers: response.headers,
							});
						}

						return response;
					},
				};
			},
			methods: [
				{
					label: "ChatGPT Plus/Pro (Codex Subscription)",
					type: "oauth",
					authorize: async () => {
						const { pkce, state, url } = await createAuthorizationFlow();
						const serverInfo = await startLocalOAuthServer({ state });
						const redirectUri = REDIRECT_URI;

						try {
							const opener =
								process.platform === "darwin"
									? "open"
									: process.platform === "win32"
										? "start"
										: "xdg-open";
							spawn(opener, [url], {
								stdio: "ignore",
								shell: process.platform === "win32",
							});
						} catch {}

						return {
							url: url,
							method: "auto",
							instructions:
								"A browser window should open. Complete login to finish.",
							callback: async () => {
								const result = await serverInfo.waitForCode(state);
								serverInfo.close();
								if (!result) return { type: "failed" };
								const tokens = await exchangeAuthorizationCode(
									result.code,
									pkce.verifier,
									redirectUri,
								);
								return tokens?.type === "success" ? tokens : { type: "failed" };
							},
						};
					},
				},
				{
					provider: "openai",
					label: "Manually enter API Key",
					type: "api",
				},
			],
		},
	};
}

export default OpenAIAuthPlugin;
