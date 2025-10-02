import { spawn } from "node:child_process";
import {
	createAuthorizationFlow,
	exchangeAuthorizationCode,
	decodeJWT,
	refreshAccessToken,
	REDIRECT_URI,
} from "./lib/auth.mjs";
import { getCodexInstructions } from "./lib/codex.mjs";
import { startLocalOAuthServer } from "./lib/server.mjs";
import { logRequest } from "./lib/logger.mjs";
import { transformRequestBody } from "./lib/request-transformer.mjs";
import { convertSseToJson, ensureContentType } from "./lib/response-handler.mjs";

/**
 * @type {import('@opencode-ai/plugin').Plugin}
 */
export async function OpenAIAuthPlugin({ client }) {
	return {
		auth: {
			provider: "openai",
			/**
			 * @param {() => Promise<any>} getAuth
			 * @param {any} provider - Provider configuration from opencode.json
			 */
			async loader(getAuth, provider) {
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

				// Extract user configuration from provider structure
				// Supports both global options and per-model options following Anthropic pattern
				const userConfig = {
					global: provider?.options || {},
					models: provider?.models || {},
				};

				// Fetch Codex instructions (cached with ETag)
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

						// Track body for later use
						let body;

						// Parse and modify request body
						if (init?.body) {
							try {
								body = JSON.parse(init.body);
								const originalModel = body.model;

								// Log original request
								logRequest("before-transform", {
									url,
									originalModel,
									model: body.model,
									hasTools: !!body.tools,
									hasInput: !!body.input,
									inputLength: body.input?.length,
									body,
								});

								// Transform request body for Codex API with user configuration
								body = transformRequestBody(body, CODEX_INSTRUCTIONS, userConfig);

								// Log transformed request
								logRequest("after-transform", {
									url,
									originalModel,
									normalizedModel: body.model,
									hasTools: !!body.tools,
									hasInput: !!body.input,
									inputLength: body.input?.length,
									reasoning: body.reasoning,
									textVerbosity: body.text?.verbosity,
									include: body.include,
									body,
								});

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

						// Log response status
						logRequest("response", {
							status: response.status,
							ok: response.ok,
							statusText: response.statusText,
							headers: Object.fromEntries(response.headers.entries()),
						});

						// Log errors
						if (!response.ok) {
							const text = await response.text();
							console.error(
								`[openai-codex-plugin] ${response.status} error:`,
								text,
							);
							logRequest("error-response", {
								status: response.status,
								error: text,
							});
							// Return a new response with the error text so the SDK can parse it
							return new Response(text, {
								status: response.status,
								statusText: response.statusText,
								headers: response.headers,
							});
						}

						// Ensure response has content-type header
						const responseHeaders = ensureContentType(response.headers);

						// For non-tool requests (compact/summarize), convert streaming SSE to JSON
						// generateText() expects a non-streaming JSON response, not SSE
						if (body?.tools === undefined) {
							return await convertSseToJson(response, responseHeaders);
						}

						// For tool requests, return stream as-is (streamText handles SSE)
						return new Response(response.body, {
							status: response.status,
							statusText: response.statusText,
							headers: responseHeaders,
						});
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
