/**
 * OpenAI ChatGPT (Codex) OAuth Authentication Plugin for opencode
 *
 * COMPLIANCE NOTICE:
 * This plugin uses OpenAI's official OAuth authentication flow (the same method
 * used by OpenAI's official Codex CLI at https://github.com/openai/codex).
 *
 * INTENDED USE: Personal development and coding assistance with your own
 * ChatGPT Plus/Pro subscription.
 *
 * NOT INTENDED FOR: Commercial resale, multi-user services, high-volume
 * automated extraction, or any use that violates OpenAI's Terms of Service.
 *
 * Users are responsible for ensuring their usage complies with:
 * - OpenAI Terms of Use: https://openai.com/policies/terms-of-use/
 * - OpenAI Usage Policies: https://openai.com/policies/usage-policies/
 *
 * For production applications, use the OpenAI Platform API: https://platform.openai.com/
 *
 * @license MIT with Usage Disclaimer (see LICENSE file)
 * @author numman-ali
 * @repository https://github.com/ndycode/opencode-openai-codex-auth-multi

 */

import { tool, type Plugin, type PluginInput } from "@opencode-ai/plugin";
import type { Auth } from "@opencode-ai/sdk";
import {
        createAuthorizationFlow,
        exchangeAuthorizationCode,
        parseAuthorizationInput,
        REDIRECT_URI,
} from "./lib/auth/auth.js";
import { queuedRefresh } from "./lib/refresh-queue.js";
import { openBrowserUrl } from "./lib/auth/browser.js";
import { startLocalOAuthServer } from "./lib/auth/server.js";
import { promptAddAnotherAccount, promptLoginMode } from "./lib/cli.js";
import {
	getCodexMode,
	getRateLimitToastDebounceMs,
	getRetryAllAccountsMaxRetries,
	getRetryAllAccountsMaxWaitMs,
	getRetryAllAccountsRateLimited,
	getTokenRefreshSkewMs,
	loadPluginConfig,
} from "./lib/config.js";
import {
        AUTH_LABELS,
        CODEX_BASE_URL,
        DUMMY_API_KEY,
        LOG_STAGES,
        PLUGIN_NAME,
        PROVIDER_ID,
        ACCOUNT_LIMITS,
} from "./lib/constants.js";
import { logRequest, logDebug } from "./lib/logger.js";
import { checkAndNotify } from "./lib/auto-update-checker.js";
import { handleContextOverflow } from "./lib/context-overflow.js";
import {
        AccountManager,
        extractAccountEmail,
        extractAccountId,
        formatAccountLabel,
        formatCooldown,
        formatWaitTime,
        sanitizeEmail,
} from "./lib/accounts.js";
import { getStoragePath, loadAccounts, saveAccounts, type AccountStorageV3 } from "./lib/storage.js";
import {
        createCodexHeaders,
        extractRequestUrl,
        handleErrorResponse,
        handleSuccessResponse,
        refreshAndUpdateToken,
        rewriteUrlForCodex,
        shouldRefreshToken,
        transformRequestForCodex,
} from "./lib/request/fetch-helpers.js";
import {
	getRateLimitBackoff,
	RATE_LIMIT_SHORT_RETRY_THRESHOLD_MS,
	resetRateLimitBackoff,
} from "./lib/request/rate-limit-backoff.js";
import { getModelFamily, MODEL_FAMILIES, type ModelFamily } from "./lib/prompts/codex.js";
import type { OAuthAuthDetails, TokenResult, UserConfig } from "./lib/types.js";

/**
 * OpenAI Codex OAuth authentication plugin for opencode
 *
 * This plugin enables opencode to use OpenAI's Codex backend via ChatGPT Plus/Pro
 * OAuth authentication, allowing users to leverage their ChatGPT subscription
 * instead of OpenAI Platform API credits.
 *
 * @example
 * ```json
 * {
 *   "plugin": ["opencode-openai-codex-auth-multi"],

 *   "model": "openai/gpt-5-codex"
 * }
 * ```
 */
export const OpenAIAuthPlugin: Plugin = async ({ client }: PluginInput) => {
        let cachedAccountManager: AccountManager | null = null;

        type TokenSuccess = Extract<TokenResult, { type: "success" }>;

        const buildManualOAuthFlow = (
                pkce: { verifier: string },
                url: string,
                onSuccess?: (tokens: TokenSuccess) => Promise<void>,
        ) => ({
                url,
                method: "code" as const,
                instructions: AUTH_LABELS.INSTRUCTIONS_MANUAL,
                callback: async (input: string) => {
                        const parsed = parseAuthorizationInput(input);
		if (!parsed.code) {
			return { type: "failed" as const, reason: "invalid_response" as const, message: "No authorization code provided" };
		}
                        const tokens = await exchangeAuthorizationCode(
                                parsed.code,
                                pkce.verifier,
                                REDIRECT_URI,
                        );
                        if (tokens?.type === "success" && onSuccess) {
                                await onSuccess(tokens);
                        }
                        return tokens?.type === "success"
                                ? tokens
                                : { type: "failed" as const };
                },
        });

        const promptOAuthCallbackValue = async (message: string): Promise<string> => {
                const { createInterface } = await import("node:readline/promises");
                const { stdin, stdout } = await import("node:process");
                const rl = createInterface({ input: stdin, output: stdout });
                try {
                        return (await rl.question(message)).trim();
                } finally {
                        rl.close();
                }
        };

        const runManualOAuthFlow = async (
                pkce: { verifier: string },
                _url: string,
        ): Promise<TokenResult> => {
                console.log("1. Open the URL above in your browser and sign in.");
                console.log("2. After approving, copy the full redirect URL.");
                console.log("3. Paste it back here.\n");
                const callbackInput = await promptOAuthCallbackValue(
                        "Paste the redirect URL (or just the code) here: ",
                );
                const parsed = parseAuthorizationInput(callbackInput);
                if (!parsed.code) {
                        return { type: "failed" as const };
                }
                return await exchangeAuthorizationCode(
                        parsed.code,
                        pkce.verifier,
                        REDIRECT_URI,
                );
        };

	const runOAuthFlow = async (
		useManualMode: boolean,
		forceNewLogin: boolean = false,
	): Promise<TokenResult> => {
		const { pkce, state, url } = await createAuthorizationFlow({ forceNewLogin });
                console.log("\nOAuth URL:\n" + url + "\n");

                if (useManualMode) {
                        openBrowserUrl(url);
                        return await runManualOAuthFlow(pkce, url);
                }

                let serverInfo: Awaited<ReturnType<typeof startLocalOAuthServer>> | null = null;
                try {
                        serverInfo = await startLocalOAuthServer({ state });
                } catch (err) {
                        logDebug(`[${PLUGIN_NAME}] Failed to start OAuth server: ${(err as Error)?.message ?? String(err)}`);
                        serverInfo = null;
                }
                openBrowserUrl(url);

                if (!serverInfo || !serverInfo.ready) {
                        serverInfo?.close();
                        return await runManualOAuthFlow(pkce, url);
                }

                const result = await serverInfo.waitForCode(state);
                serverInfo.close();

		if (!result) {
			return { type: "failed" as const, reason: "unknown" as const, message: "OAuth callback timeout or cancelled" };
		}

                return await exchangeAuthorizationCode(
                        result.code,
                        pkce.verifier,
                        REDIRECT_URI,
                );
        };

        const persistAccountPool = async (
                results: TokenSuccess[],
                replaceAll: boolean = false,
        ): Promise<void> => {
                if (results.length === 0) return;
                const now = Date.now();
                const stored = replaceAll ? null : await loadAccounts();
                const accounts = stored?.accounts ? [...stored.accounts] : [];

				const indexByRefreshToken = new Map<string, number>();
				const indexByAccountId = new Map<string, number>();
				const indexByEmail = new Map<string, number>();
				for (let i = 0; i < accounts.length; i += 1) {
                        const account = accounts[i];
                        if (!account) continue;
                        if (account.refreshToken) {
                                indexByRefreshToken.set(account.refreshToken, i);
                        }
						if (account.accountId) {
							indexByAccountId.set(account.accountId, i);
						}
						if (account.email) {
							indexByEmail.set(account.email, i);
						}
					}

				for (const result of results) {
						const accountId = extractAccountId(result.access);
						const accountEmail = sanitizeEmail(extractAccountEmail(result.access));
						const existingByEmail =
								accountEmail && indexByEmail.has(accountEmail)
										? indexByEmail.get(accountEmail)
										: undefined;
						const existingById =
								accountId && indexByAccountId.has(accountId)
										? indexByAccountId.get(accountId)
										: undefined;
						const existingByToken = indexByRefreshToken.get(result.refresh);
						const existingIndex = existingById ?? existingByEmail ?? existingByToken;

                        if (existingIndex === undefined) {
                                const newIndex = accounts.length;
                                accounts.push({
                                        accountId,
                                        email: accountEmail,
                                        refreshToken: result.refresh,
                                        addedAt: now,
                                        lastUsed: now,
                                });
								indexByRefreshToken.set(result.refresh, newIndex);
								if (accountId) {
									indexByAccountId.set(accountId, newIndex);
								}
								if (accountEmail) {
									indexByEmail.set(accountEmail, newIndex);
								}
								continue;
                        }

                        const existing = accounts[existingIndex];
                        if (!existing) continue;

						const oldToken = existing.refreshToken;
						const oldEmail = existing.email;
						const nextEmail = accountEmail ?? existing.email;
						accounts[existingIndex] = {
								...existing,
								accountId: accountId ?? existing.accountId,
								email: nextEmail,
								refreshToken: result.refresh,
								lastUsed: now,
						};
						if (oldToken !== result.refresh) {
								indexByRefreshToken.delete(oldToken);
								indexByRefreshToken.set(result.refresh, existingIndex);
						}
						if (accountId) {
								indexByAccountId.set(accountId, existingIndex);
						}
						if (oldEmail && oldEmail !== nextEmail) {
								indexByEmail.delete(oldEmail);
						}
						if (nextEmail) {
								indexByEmail.set(nextEmail, existingIndex);
						}
                }

                if (accounts.length === 0) return;

                const activeIndex = replaceAll
                        ? 0
                        : typeof stored?.activeIndex === "number" && Number.isFinite(stored.activeIndex)
                                ? stored.activeIndex
                                : 0;

				const clampedActiveIndex = Math.max(0, Math.min(activeIndex, accounts.length - 1));
				const activeIndexByFamily: Partial<Record<ModelFamily, number>> = {};
				for (const family of MODEL_FAMILIES) {
						const storedFamilyIndex = stored?.activeIndexByFamily?.[family];
						const rawFamilyIndex = replaceAll
								? 0
								: typeof storedFamilyIndex === "number" && Number.isFinite(storedFamilyIndex)
										? storedFamilyIndex
										: clampedActiveIndex;
						activeIndexByFamily[family] = Math.max(
								0,
								Math.min(Math.floor(rawFamilyIndex), accounts.length - 1),
						);
				}

				await saveAccounts({
						version: 3,
						accounts,
						activeIndex: clampedActiveIndex,
						activeIndexByFamily,
				});
        };

        const showToast = async (
                message: string,
                variant: "info" | "success" | "warning" | "error" = "success",
        ): Promise<void> => {
                try {
                        await client.tui.showToast({
                                body: {
                                        message,
                                        variant,
                                },
                        });
                } catch {
                        // Ignore when TUI is not available.
                }
        };

		const resolveActiveIndex = (
				storage: {
						activeIndex: number;
						activeIndexByFamily?: Partial<Record<ModelFamily, number>>;
						accounts: unknown[];
				},
				family: ModelFamily = "codex",
		): number => {
				const total = storage.accounts.length;
				if (total === 0) return 0;
				const rawCandidate = storage.activeIndexByFamily?.[family] ?? storage.activeIndex;
				const raw = Number.isFinite(rawCandidate) ? rawCandidate : 0;
				return Math.max(0, Math.min(raw, total - 1));
		};

	const hydrateEmails = async (
			storage: AccountStorageV3 | null,
	): Promise<AccountStorageV3 | null> => {
                if (!storage) return storage;
                const skipHydrate =
                        process.env.VITEST_WORKER_ID !== undefined ||
                        process.env.NODE_ENV === "test" ||
                        process.env.OPENCODE_SKIP_EMAIL_HYDRATE === "1";
                if (skipHydrate) return storage;

                const accountsToHydrate = storage.accounts.filter(
                        (account) => account && !account.email,
                );
                if (accountsToHydrate.length === 0) return storage;

                let changed = false;
                await Promise.all(
                        accountsToHydrate.map(async (account) => {
                                try {
                                        const refreshed = await queuedRefresh(account.refreshToken);
                                        if (refreshed.type !== "success") return;
                                        const id = extractAccountId(refreshed.access);
                                        const email = sanitizeEmail(extractAccountEmail(refreshed.access));
                                        if (id && id !== account.accountId) {
                                                account.accountId = id;
                                                changed = true;
                                        }
                                        if (email && email !== account.email) {
                                                account.email = email;
                                                changed = true;
                                        }
                                        if (refreshed.refresh && refreshed.refresh !== account.refreshToken) {
                                                account.refreshToken = refreshed.refresh;
                                                changed = true;
                                        }
                                } catch {
                                        logDebug(`[${PLUGIN_NAME}] Failed to hydrate email for account`);
                                }
                        }),
                );

                if (changed) {
                        await saveAccounts(storage);
                }
                return storage;
        };

		const getRateLimitResetTimeForFamily = (
				account: { rateLimitResetTimes?: Record<string, number | undefined> },
				now: number,
				family: ModelFamily,
		): number | null => {
				const times = account.rateLimitResetTimes;
				if (!times) return null;

				let minReset: number | null = null;
				const prefix = `${family}:`;
				for (const [key, value] of Object.entries(times)) {
						if (typeof value !== "number") continue;
						if (value <= now) continue;
						if (key !== family && !key.startsWith(prefix)) continue;
						if (minReset === null || value < minReset) {
								minReset = value;
						}
				}

				return minReset;
		};

		const formatRateLimitEntry = (
				account: { rateLimitResetTimes?: Record<string, number | undefined> },
				now: number,
				family: ModelFamily = "codex",
		): string | null => {
				const resetAt = getRateLimitResetTimeForFamily(account, now, family);
				if (typeof resetAt !== "number") return null;
				const remaining = resetAt - now;
				if (remaining <= 0) return null;
				return `resets in ${formatWaitTime(remaining)}`;
		};

        return {
                auth: {
			provider: PROVIDER_ID,
			/**
			 * Loader function that configures OAuth authentication and request handling
			 *
			 * This function:
                         * 1. Validates OAuth authentication
                         * 2. Loads multi-account pool from disk (fallback to current auth)
                         * 3. Loads user configuration from opencode.json
                         * 4. Fetches Codex system instructions from GitHub (cached)
                         * 5. Returns SDK configuration with custom fetch implementation
			 *
			 * @param getAuth - Function to retrieve current auth state
			 * @param provider - Provider configuration from opencode.json
			 * @returns SDK configuration object or empty object for non-OAuth auth
			 */
			async loader(getAuth: () => Promise<Auth>, provider: unknown) {
				const auth = await getAuth();

				// Only handle OAuth auth type, skip API key auth
				if (auth.type !== "oauth") {
					return {};
				}

                                const accountManager = await AccountManager.loadFromDisk(
                                        auth as OAuthAuthDetails,
                                );
                                cachedAccountManager = accountManager;
                                const refreshToken =
                                        auth.type === "oauth" ? auth.refresh : "";
                                const needsPersist =
                                        refreshToken &&
                                        !accountManager.hasRefreshToken(refreshToken);
                                if (needsPersist) {
                                        await accountManager.saveToDisk();
                                }

                                if (accountManager.getAccountCount() === 0) {
                                        logDebug(
                                                `[${PLUGIN_NAME}] No OAuth accounts available (run opencode auth login)`,
                                        );
                                        return {};
                                }
				// Extract user configuration (global + per-model options)
				const providerConfig = provider as
					| { options?: Record<string, unknown>; models?: UserConfig["models"] }
					| undefined;
				const userConfig: UserConfig = {
					global: providerConfig?.options || {},
					models: providerConfig?.models || {},
				};

				// Load plugin configuration and determine CODEX_MODE
				// Priority: CODEX_MODE env var > config file > default (true)
				const pluginConfig = loadPluginConfig();
				const codexMode = getCodexMode(pluginConfig);
				const tokenRefreshSkewMs = getTokenRefreshSkewMs(pluginConfig);
				const rateLimitToastDebounceMs = getRateLimitToastDebounceMs(pluginConfig);
				const retryAllAccountsRateLimited = getRetryAllAccountsRateLimited(pluginConfig);
				const retryAllAccountsMaxWaitMs = getRetryAllAccountsMaxWaitMs(pluginConfig);
				const retryAllAccountsMaxRetries = getRetryAllAccountsMaxRetries(pluginConfig);

				checkAndNotify(async (message, variant) => {
					await showToast(message, variant);
				}).catch(() => {});


				// Return SDK configuration
				return {
					apiKey: DUMMY_API_KEY,
					baseURL: CODEX_BASE_URL,
					/**
					 * Custom fetch implementation for Codex API
					 *
					 * Handles:
					 * - Token refresh when expired
					 * - URL rewriting for Codex backend
					 * - Request body transformation
					 * - OAuth header injection
					 * - SSE to JSON conversion for non-tool requests
					 * - Error handling and logging
					 *
					 * @param input - Request URL or Request object
					 * @param init - Request options
					 * @returns Response from Codex API
					 */
					async fetch(
						input: Request | string | URL,
						init?: RequestInit,
					): Promise<Response> {
                                                // Step 1: Extract and rewrite URL for Codex backend
                                                const originalUrl = extractRequestUrl(input);
                                                const url = rewriteUrlForCodex(originalUrl);

						// Step 3: Transform request body with model-specific Codex instructions
						// Instructions are fetched per model family (codex-max, codex, gpt-5.1)
						// Capture original stream value before transformation
						// generateText() sends no stream field, streamText() sends stream=true
						const originalBody = init?.body ? JSON.parse(init.body as string) : {};
						const isStreaming = originalBody.stream === true;

						const transformation = await transformRequestForCodex(
							init,
							url,
							userConfig,
							codexMode,
						);
									const requestInit = transformation?.updatedInit ?? init;
									const promptCacheKey = transformation?.body?.prompt_cache_key;
																				const model = transformation?.body.model;
																				const modelFamily = model ? getModelFamily(model) : "gpt-5.1";
																				const quotaKey = model ? `${modelFamily}:${model}` : modelFamily;

																				const abortSignal = requestInit?.signal ?? init?.signal ?? null;
									const sleep = (ms: number): Promise<void> =>
										new Promise((resolve, reject) => {
											if (abortSignal?.aborted) {
												reject(new Error("Aborted"));
												return;
											}

											const timeout = setTimeout(() => {
												cleanup();
												resolve();
											}, ms);

											const onAbort = () => {
												cleanup();
												reject(new Error("Aborted"));
											};

											const cleanup = () => {
												clearTimeout(timeout);
												abortSignal?.removeEventListener("abort", onAbort);
											};

											abortSignal?.addEventListener("abort", onAbort, { once: true });
										});

									let allRateLimitedRetries = 0;

									while (true) {
										const accountCount = accountManager.getAccountCount();
										const attempted = new Set<number>();

							while (attempted.size < Math.max(1, accountCount)) {
								const account = accountManager.getCurrentOrNextForFamilyHybrid(modelFamily, model);
								if (!account || attempted.has(account.index)) {
									break;
								}
											attempted.add(account.index);

											let accountAuth = accountManager.toAuthDetails(account) as OAuthAuthDetails;
											try {
							if (shouldRefreshToken(accountAuth, tokenRefreshSkewMs)) {
								accountAuth = (await refreshAndUpdateToken(
									accountAuth,
									client,
								)) as OAuthAuthDetails;
								accountManager.updateFromAuth(account, accountAuth);
								accountManager.saveToDiskDebounced();
							}
			} catch (err) {
				logDebug(`[${PLUGIN_NAME}] Auth refresh failed for account: ${(err as Error)?.message ?? String(err)}`);
				accountManager.markAccountCoolingDown(
								account,
								ACCOUNT_LIMITS.AUTH_FAILURE_COOLDOWN_MS,
								"auth-failure",
							);
							accountManager.saveToDiskDebounced();
							continue;
						}

						const accountId =
							account.accountId ?? extractAccountId(accountAuth.access);
						if (!accountId) {
							accountManager.markAccountCoolingDown(
								account,
								ACCOUNT_LIMITS.AUTH_FAILURE_COOLDOWN_MS,
								"auth-failure",
							);
							accountManager.saveToDiskDebounced();
							continue;
						}
											account.accountId = accountId;
											account.email =
												extractAccountEmail(accountAuth.access) ?? account.email;

											if (
												accountCount > 1 &&
												accountManager.shouldShowAccountToast(
													account.index,
													rateLimitToastDebounceMs,
												)
											) {
												const accountLabel = formatAccountLabel(account, account.index);
												await showToast(
													`Using ${accountLabel} (${account.index + 1}/${accountCount})`,
													"info",
												);
												accountManager.markToastShown(account.index);
											}

											const headers = createCodexHeaders(
												requestInit,
												accountId,
												accountAuth.access,
												{
													model,
													promptCacheKey,
												},
											);

																								while (true) {
																											const response = await fetch(url, {
																												...requestInit,
																												headers,
																											});

																											logRequest(LOG_STAGES.RESPONSE, {
																											status: response.status,
																											ok: response.ok,
																											statusText: response.statusText,
																											headers: Object.fromEntries(response.headers.entries()),
																										});

								if (!response.ok) {
									// Check for context overflow (400 "prompt too long") before other error handling
									const contextOverflowResult = await handleContextOverflow(response, model);
									if (contextOverflowResult.handled) {
										return contextOverflowResult.response;
									}

									const { response: errorResponse, rateLimit } =
										await handleErrorResponse(response);
									if (rateLimit) {
																														const { attempt, delayMs } = getRateLimitBackoff(
																															account.index,
																															quotaKey,
																															rateLimit.retryAfterMs,
																														);
																														const waitLabel = formatWaitTime(delayMs);

																														if (delayMs <= RATE_LIMIT_SHORT_RETRY_THRESHOLD_MS) {
																																if (
																																	accountManager.shouldShowAccountToast(
																																		account.index,
																																		rateLimitToastDebounceMs,
																																		)
																																) {
																																			await showToast(
																																				`Rate limited. Retrying in ${waitLabel} (attempt ${attempt})...`,
																																				"warning",
																																			);
																																			accountManager.markToastShown(account.index);
																																		}

																																	await sleep(delayMs);
																																	continue;
																																}

					accountManager.markRateLimited(
						account,
						delayMs,
						modelFamily,
						model,
					);
					accountManager.recordRateLimit(account, modelFamily, model);
					account.lastSwitchReason = "rate-limit";
					accountManager.saveToDiskDebounced();

																														if (
																															accountManager.getAccountCount() > 1 &&
																															accountManager.shouldShowAccountToast(
																																account.index,
																																rateLimitToastDebounceMs,
																																)
																														) {
																																await showToast(
																																	`Rate limited. Switching accounts (retry in ${waitLabel}).`,
																																	"warning",
																																	);
																																	accountManager.markToastShown(account.index);
																																}
																														break;
																													}
																													return errorResponse;
																											}

								resetRateLimitBackoff(account.index, quotaKey);
								accountManager.recordSuccess(account, modelFamily, model);
									return await handleSuccessResponse(response, isStreaming);
																								}
										}

										const waitMs = accountManager.getMinWaitTimeForFamily(modelFamily, model);
										const count = accountManager.getAccountCount();

										if (
											retryAllAccountsRateLimited &&
											count > 0 &&
											waitMs > 0 &&
											(retryAllAccountsMaxWaitMs === 0 ||
												waitMs <= retryAllAccountsMaxWaitMs) &&
											allRateLimitedRetries < retryAllAccountsMaxRetries
										) {
											const waitLabel = formatWaitTime(waitMs);
											await showToast(
												`All ${count} account(s) are rate-limited. Waiting ${waitLabel}...`,
												"warning",
											);
											allRateLimitedRetries++;
											await sleep(waitMs);
											continue;
										}

										const waitLabel = waitMs > 0 ? formatWaitTime(waitMs) : "a bit";
										const message =
											count === 0
												? "No OpenAI accounts configured. Run `opencode auth login`."
												: `All ${count} account(s) are rate-limited. Try again in ${waitLabel} or add another account with \`opencode auth login\`.`;
										return new Response(JSON.stringify({ error: { message } }), {
											status: 429,
											headers: {
												"content-type": "application/json; charset=utf-8",
											},
										});
									}
										},
                                };
                        },
				methods: [
					{
						label: AUTH_LABELS.OAUTH,
						type: "oauth" as const,
					/**
					 * OAuth authorization flow
					 *
					 * Steps:
					 * 1. Generate PKCE challenge and state for security
					 * 2. Start local OAuth callback server on port 1455
					 * 3. Open browser to OpenAI authorization page
					 * 4. Wait for user to complete login
					 * 5. Exchange authorization code for tokens
					 *
					 * @returns Authorization flow configuration
					 */
                                        authorize: async (inputs?: Record<string, string>) => {
                                                if (inputs) {
                                                        const accounts: TokenSuccess[] = [];
                                                        const noBrowser =
                                                                inputs.noBrowser === "true" ||
                                                                inputs["no-browser"] === "true";
                                                        const useManualMode = noBrowser;

                                                        let startFresh = true;
                                                        const existingStorage = await hydrateEmails(await loadAccounts());
                                                        if (existingStorage && existingStorage.accounts.length > 0) {
                                                                const existingAccounts = existingStorage.accounts.map(
                                                                        (account, index) => ({
                                                                                accountId: account.accountId,
                                                                                email: account.email,
                                                                                index,
                                                                        }),
                                                                );
                                                                const loginMode = await promptLoginMode(existingAccounts);
                                                                startFresh = loginMode === "fresh";

                                                                if (startFresh) {
                                                                        console.log(
                                                                                "\nStarting fresh - existing accounts will be replaced.\n",
                                                                        );
                                                                } else {
                                                                        console.log("\nAdding to existing accounts.\n");
                                                                }
                                                        }

				while (accounts.length < ACCOUNT_LIMITS.MAX_ACCOUNTS) {
					console.log(
						`\n=== OpenAI OAuth (Account ${
							accounts.length + 1
						}) ===`,
					);

					const forceNewLogin = accounts.length > 0;
					const result = await runOAuthFlow(useManualMode, forceNewLogin);

					if (result.type === "success") {
						const email = extractAccountEmail(result.access);
						const accountId = extractAccountId(result.access);
						const label = email || accountId || "Unknown account";
						console.log(`\n✓ Authenticated as: ${label}\n`);

						const isDuplicate = accounts.some(
							(acc) =>
								(accountId && extractAccountId(acc.access) === accountId) ||
								(email && extractAccountEmail(acc.access) === email),
						);

						if (isDuplicate) {
							console.warn(
								`\n⚠️  WARNING: You authenticated with an account that is already in the list (${label}).`,
							);
							console.warn(
								"This usually happens if you didn't log out or use a different browser profile.",
							);
							console.warn("The duplicate will update the existing entry.\n");
						}
					}

					if (result.type === "failed") {
                                                                        if (accounts.length === 0) {
                                                                                return {
                                                                                        url: "",
                                                                                        instructions:
                                                                                                "Authentication failed.",
                                                                                        method: "auto",
                                                                                        callback: async () => result,
                                                                                };
                                                                        }
                                                                        console.warn(
                                                                                `[${PLUGIN_NAME}] Skipping failed account ${
                                                                                        accounts.length + 1
                                                                                }`,
                                                                        );
                                                                        break;
                                                                }

                                                                accounts.push(result);
                                                                await showToast(
                                                                        `Account ${accounts.length} authenticated`,
                                                                        "success",
                                                                );

                                                                try {
                                                                        const isFirstAccount = accounts.length === 1;
                                                                        await persistAccountPool(
                                                                                [result],
                                                                                isFirstAccount && startFresh,
                                                                        );
                                                                } catch (err) {
                                                                        logDebug(`[${PLUGIN_NAME}] Failed to persist account pool: ${(err as Error)?.message ?? String(err)}`);
                                                                }

                                                                if (accounts.length >= ACCOUNT_LIMITS.MAX_ACCOUNTS) {
                                                                        break;
                                                                }

                                                                let currentAccountCount = accounts.length;
                                                                try {
                                                                        const currentStorage = await loadAccounts();
                                                                        if (currentStorage) {
                                                                                currentAccountCount = currentStorage.accounts.length;
                                                                        }
                                                                } catch (err) {
                                                                        logDebug(`[${PLUGIN_NAME}] Failed to load accounts for count: ${(err as Error)?.message ?? String(err)}`);
                                                                }

                                                                const addAnother = await promptAddAnotherAccount(
                                                                        currentAccountCount,
                                                                );
                                                                if (!addAnother) {
                                                                        break;
                                                                }
                                                        }

                                                        const primary = accounts[0];
                                                        if (!primary) {
                                                                return {
                                                                        url: "",
                                                                        instructions: "Authentication cancelled",
                                                                        method: "auto",
                                                                        callback: async () => ({
                                                                                type: "failed" as const,
                                                                        }),
                                                                };
                                                        }

                                                        let actualAccountCount = accounts.length;
                                                        try {
                                                                const finalStorage = await loadAccounts();
                                                                if (finalStorage) {
                                                                        actualAccountCount = finalStorage.accounts.length;
                                                                }
                                                        } catch (err) {
                                                                logDebug(`[${PLUGIN_NAME}] Failed to load final account count: ${(err as Error)?.message ?? String(err)}`);
                                                        }

                                                        return {
                                                                url: "",
                                                                instructions: `Multi-account setup complete (${actualAccountCount} account(s)).`,
                                                                method: "auto",
                                                                callback: async () => primary,
                                                        };
                                                }

                                                const { pkce, state, url } = await createAuthorizationFlow();
                                                let serverInfo: Awaited<ReturnType<typeof startLocalOAuthServer>> | null =
                                                        null;
                                                try {
                                                        serverInfo = await startLocalOAuthServer({ state });
                                                } catch (err) {
                                                        logDebug(`[${PLUGIN_NAME}] Failed to start OAuth server for add flow: ${(err as Error)?.message ?? String(err)}`);
                                                        serverInfo = null;
                                                }

                                                openBrowserUrl(url);

                                                if (!serverInfo || !serverInfo.ready) {
                                                        serverInfo?.close();
                                                        return buildManualOAuthFlow(pkce, url, async (tokens) => {
                                                                await persistAccountPool([tokens], false);
                                                        });
                                                }

                                                return {
                                                        url,
                                                        method: "auto" as const,
                                                        instructions: AUTH_LABELS.INSTRUCTIONS,
                                                        callback: async () => {
                                                                const result = await serverInfo.waitForCode(state);
                                                                serverInfo.close();

                                                                if (!result) {
                                                                        return { type: "failed" as const };
                                                                }

                                                                const tokens = await exchangeAuthorizationCode(
                                                                        result.code,
                                                                        pkce.verifier,
                                                                        REDIRECT_URI,
                                                                );

                                                                if (tokens?.type === "success") {
                                                                        await persistAccountPool([tokens], false);
                                                                }

                                                                return tokens?.type === "success"
                                                                        ? tokens
                                                                        : { type: "failed" as const };
                                                        },
                                                };
                                        },
					},
					{
						label: AUTH_LABELS.OAUTH_MANUAL,
						type: "oauth" as const,
                                                authorize: async () => {
                                                        const { pkce, url } = await createAuthorizationFlow();
                                                        return buildManualOAuthFlow(pkce, url, async (tokens) => {
                                                                await persistAccountPool([tokens], false);
                                                        });
                                                },
					},
					{
						label: AUTH_LABELS.API_KEY,
						type: "api" as const,
					},
			],
                },
                tool: {
                        "openai-accounts": tool({
                                description:
                                        "List all OpenAI OAuth accounts and the current active index.",
                                args: {},
                                async execute() {
                                        const storage = await loadAccounts();
                                        const storePath = getStoragePath();

                                        if (!storage || storage.accounts.length === 0) {
                                                return [
                                                        "No OpenAI accounts configured.",
                                                        "",
                                                        "Add accounts:",
                                                        "  opencode auth login",
                                                        "",
                                                        `Storage: ${storePath}`,
                                                ].join("\n");
                                        }

										const now = Date.now();
										const activeIndex = resolveActiveIndex(storage, "codex");
										const lines: string[] = [
                                                `OpenAI Accounts (${storage.accounts.length}):`,
                                                "",
                                                " #  Label                                     Status",
                                                "----------------------------------------------- ---------------------",
                                        ];

                                        storage.accounts.forEach((account, index) => {
                                                const label = formatAccountLabel(account, index);
                                                const statuses: string[] = [];
                                                const rateLimit = formatRateLimitEntry(
                                                        account,
                                                        now,
                                                );
                                                if (index === activeIndex) statuses.push("active");
                                                if (rateLimit) statuses.push("rate-limited");
                                                if (
                                                        typeof account.coolingDownUntil ===
                                                                "number" &&
                                                        account.coolingDownUntil > now
                                                ) {
                                                        statuses.push("cooldown");
                                                }
                                                const statusText = statuses.length > 0 ? statuses.join(", ") : "ok";
                                                const row = `${String(index + 1).padEnd(3)} ${label.padEnd(40)} ${statusText}`;
                                                lines.push(row);
                                        });

                                        lines.push("");
                                        lines.push(`Storage: ${storePath}`);
                                        lines.push("");
                                        lines.push("Commands:");
                                        lines.push("  - Add account: opencode auth login");
                                        lines.push("  - Switch account: openai-accounts-switch");
                                        lines.push("  - Status details: openai-accounts-status");

                                        return lines.join("\n");
                                },
                        }),
                        "openai-accounts-switch": tool({
                                description: "Switch active OpenAI account by index (1-based).",
                                args: {
                                        index: tool.schema.number().describe(
                                                "Account number to switch to (1-based, e.g., 1 for first account)",
                                        ),
                                },
                                async execute({ index }) {
                                        const storage = await loadAccounts();
                                        if (!storage || storage.accounts.length === 0) {
                                                return "No OpenAI accounts configured. Run: opencode auth login";
                                        }

                                        const targetIndex = Math.floor((index ?? 0) - 1);
                                        if (
                                                !Number.isFinite(targetIndex) ||
                                                targetIndex < 0 ||
                                                targetIndex >= storage.accounts.length
                                        ) {
                                                return `Invalid account number: ${index}\n\nValid range: 1-${storage.accounts.length}`;
                                        }

                                        const now = Date.now();
                                        const account = storage.accounts[targetIndex];
                                        if (account) {
                                                account.lastUsed = now;
                                                account.lastSwitchReason = "rotation";
                                        }

										storage.activeIndex = targetIndex;
										storage.activeIndexByFamily = storage.activeIndexByFamily ?? {};
										for (const family of MODEL_FAMILIES) {
												storage.activeIndexByFamily[family] = targetIndex;
										}
										await saveAccounts(storage);

                                        if (cachedAccountManager) {
                                                cachedAccountManager.setActiveIndex(targetIndex);
                                                await cachedAccountManager.saveToDisk();
                                        }

                                        const label = formatAccountLabel(account, targetIndex);
                                        return `Switched to account: ${label}`;
                                },
                        }),
                        "openai-accounts-status": tool({
                                description: "Show detailed status of OpenAI accounts and rate limits.",
                                args: {
                                        json: tool.schema.boolean().optional().describe("Return JSON instead of text"),
                                },
                                async execute({ json }) {
                                        const storage = await loadAccounts();
                                        if (!storage || storage.accounts.length === 0) {
                                                return "No OpenAI accounts configured. Run: opencode auth login";
                                        }

										const now = Date.now();
										const activeIndex = resolveActiveIndex(storage, "codex");

										if (json) {
                                                return JSON.stringify(
                                                        {
																total: storage.accounts.length,
																activeIndex,
																activeIndexByFamily: storage.activeIndexByFamily ?? null,
																storagePath: getStoragePath(),
																accounts: storage.accounts.map((account, index) => ({
																		index,
																		active: index === activeIndex,
																		label: formatAccountLabel(account, index),
																		accountId: account.accountId ?? null,
																		email: account.email ?? null,
																		rateLimitResetTimes: account.rateLimitResetTimes ?? null,
																		coolingDownUntil:
																				typeof account.coolingDownUntil === "number"
																						? account.coolingDownUntil
																						: null,
																		cooldownReason: account.cooldownReason ?? null,
																		lastUsed:
																				typeof account.lastUsed === "number"
																						? account.lastUsed
																						: null,
																		})),
                                                        },
                                                        null,
                                                        2,
                                                );
                                        }

                                        const lines: string[] = [
                                                `Account Status (${storage.accounts.length} total):`,
                                                "",
                                                " #  Label                                     Active  Rate Limit       Cooldown        Last Used",
                                                "----------------------------------------------- ------ ---------------- ---------------- ----------------",
                                        ];

										storage.accounts.forEach((account, index) => {
												const label = formatAccountLabel(account, index).padEnd(42);
												const active = index === activeIndex ? "Yes" : "No";
												const rateLimit = formatRateLimitEntry(account, now) ?? "None";
												const cooldown = formatCooldown(account, now) ?? "No";
												const lastUsed =
														typeof account.lastUsed === "number" && account.lastUsed > 0
																? `${formatWaitTime(now - account.lastUsed)} ago`
																: "-";

												const row = `${String(index + 1).padEnd(3)} ${label} ${active.padEnd(
														6,
												)} ${rateLimit.padEnd(16)} ${cooldown.padEnd(16)} ${lastUsed}`;
												lines.push(row);
										});

										lines.push("");
										lines.push("Active index by model family:");
										for (const family of MODEL_FAMILIES) {
												const idx = storage.activeIndexByFamily?.[family];
												const familyIndexLabel =
													typeof idx === "number" && Number.isFinite(idx) ? String(idx + 1) : "-";
												lines.push(`  ${family}: ${familyIndexLabel}`);
										}

										lines.push("");
										lines.push("Rate limits by model family (per account):");
										storage.accounts.forEach((account, index) => {
												const statuses = MODEL_FAMILIES.map((family) => {
														const resetAt = getRateLimitResetTimeForFamily(account, now, family);
														if (typeof resetAt !== "number") return `${family}=ok`;
														return `${family}=${formatWaitTime(resetAt - now)}`;
												});
												lines.push(`  Account ${index + 1}: ${statuses.join(" | ")}`);
										});

										return lines.join("\n");
                                },
                        }),
                        "openai-accounts-health": tool({
                                description: "Check health of all OpenAI accounts by validating refresh tokens.",
                                args: {},
                                async execute() {
                                        const storage = await loadAccounts();
                                        if (!storage || storage.accounts.length === 0) {
                                                return "No OpenAI accounts configured. Run: opencode auth login";
                                        }

                                        const results: string[] = [
                                                `Health Check (${storage.accounts.length} accounts):`,
                                                "",
                                        ];

                                        let healthyCount = 0;
                                        let unhealthyCount = 0;

                                        for (let i = 0; i < storage.accounts.length; i++) {
                                                const account = storage.accounts[i];
                                                if (!account) continue;

                                                const label = formatAccountLabel(account, i);
                                                try {
								const refreshResult = await queuedRefresh(account.refreshToken);
                                                        if (refreshResult.type === "success") {
                                                                results.push(`  ✓ ${label}: Healthy`);
                                                                healthyCount++;
                                                        } else {
                                                                results.push(`  ✗ ${label}: Token refresh failed`);
                                                                unhealthyCount++;
                                                        }
                                                } catch (error) {
                                                        const errorMsg = error instanceof Error ? error.message : String(error);
                                                        results.push(`  ✗ ${label}: Error - ${errorMsg.slice(0, 50)}`);
                                                        unhealthyCount++;
                                                }
                                        }

                                        results.push("");
                                        results.push(`Summary: ${healthyCount} healthy, ${unhealthyCount} unhealthy`);

                                        return results.join("\n");
                                },
                        }),

                },
        };
};

export default OpenAIAuthPlugin;
