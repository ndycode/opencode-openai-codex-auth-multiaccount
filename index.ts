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
 * @repository https://github.com/ndycode/oc-chatgpt-multi-auth

 */

import { tool } from "@opencode-ai/plugin/tool";
import type { Plugin, PluginInput } from "@opencode-ai/plugin";
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
import { promptAccountSelection, promptLoginMode } from "./lib/cli.js";
import {
	getCodexMode,
	getRateLimitToastDebounceMs,
	getRetryAllAccountsMaxRetries,
	getRetryAllAccountsMaxWaitMs,
	getRetryAllAccountsRateLimited,
	getTokenRefreshSkewMs,
	getSessionRecovery,
	getAutoResume,
	getToastDurationMs,
	getPerProjectAccounts,
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
import { initLogger, logRequest, logDebug, logInfo, logWarn } from "./lib/logger.js";
import { checkAndNotify } from "./lib/auto-update-checker.js";
import { handleContextOverflow } from "./lib/context-overflow.js";
import {
        AccountManager,
        getAccountIdCandidates,
        extractAccountEmail,
        extractAccountId,
        formatAccountLabel,
        formatCooldown,
        formatWaitTime,
        sanitizeEmail,
        shouldUpdateAccountIdFromToken,
} from "./lib/accounts.js";
import { getStoragePath, loadAccounts, saveAccounts, setStoragePath, type AccountStorageV3 } from "./lib/storage.js";
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
import { addJitter } from "./lib/rotation.js";
import { getModelFamily, MODEL_FAMILIES, type ModelFamily } from "./lib/prompts/codex.js";
import type { AccountIdSource, OAuthAuthDetails, TokenResult, UserConfig } from "./lib/types.js";
import {
	createSessionRecoveryHook,
	isRecoverableError,
	detectErrorType,
	getRecoveryToastContent,
} from "./lib/recovery.js";

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
 *   "plugin": ["oc-chatgpt-multi-auth"],

 *   "model": "openai/gpt-5-codex"
 * }
 * ```
 */
export const OpenAIOAuthPlugin: Plugin = async ({ client }: PluginInput) => {
	initLogger(client);
	let cachedAccountManager: AccountManager | null = null;

        type TokenSuccess = Extract<TokenResult, { type: "success" }>;
        type TokenSuccessWithAccount = TokenSuccess & {
                accountIdOverride?: string;
                accountIdSource?: AccountIdSource;
                accountLabel?: string;
        };

        const resolveAccountSelection = async (
                tokens: TokenSuccess,
        ): Promise<TokenSuccessWithAccount> => {
                const override = (process.env.CODEX_AUTH_ACCOUNT_ID ?? "").trim();
                if (override) {
                        const suffix = override.length > 6 ? override.slice(-6) : override;
                        logInfo(`Using account override from CODEX_AUTH_ACCOUNT_ID (id:${suffix}).`);
                        return {
                                ...tokens,
                                accountIdOverride: override,
                                accountIdSource: "manual",
                                accountLabel: `Override [id:${suffix}]`,
                        };
                }

                const candidates = getAccountIdCandidates(tokens.access, tokens.idToken);
                if (candidates.length === 0) {
                        return tokens;
                }

                if (candidates.length === 1) {
                        const candidate = candidates[0];
                        return {
                                ...tokens,
                                accountIdOverride: candidate.accountId,
                                accountIdSource: candidate.source,
                                accountLabel: candidate.label,
                        };
                }

                const defaultIndex = (() => {
                        const orgDefaultIndex = candidates.findIndex(
                                (candidate) => candidate.isDefault && candidate.source === "org",
                        );
                        if (orgDefaultIndex >= 0) return orgDefaultIndex;

                        const tokenIndex = candidates.findIndex(
                                (candidate) => candidate.source === "token",
                        );
                        if (tokenIndex >= 0) return tokenIndex;

                        return 0;
                })();

                const selected = await promptAccountSelection(candidates, {
                        defaultIndex,
                        title: "Multiple workspaces detected for this account:",
                });
                const choice = selected ?? candidates[defaultIndex];
                if (!choice) return tokens;

                return {
                        ...tokens,
                        accountIdOverride: choice.accountId,
                        accountIdSource: choice.source ?? "token",
                        accountLabel: choice.label,
                };
        };

        const buildManualOAuthFlow = (
                pkce: { verifier: string },
                url: string,
                onSuccess?: (tokens: TokenSuccessWithAccount) => Promise<void>,
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
                        if (tokens?.type === "success") {
                                const resolved = await resolveAccountSelection(tokens);
                                if (onSuccess) {
                                        await onSuccess(resolved);
                                }
                                return resolved;
                        }
                        return tokens?.type === "failed"
                                ? tokens
                                : { type: "failed" as const };
                },
        });

	const runOAuthFlow = async (
		forceNewLogin: boolean = false,
	): Promise<TokenResult> => {
		const { pkce, state, url } = await createAuthorizationFlow({ forceNewLogin });
		logInfo(`OAuth URL: ${url}`);

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
                        const message =
                                `\n[${PLUGIN_NAME}] OAuth callback server failed to start. ` +
                                `Please retry with "${AUTH_LABELS.OAUTH_MANUAL}".\n`;
				logWarn(message);
                        return { type: "failed" as const };
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
                results: TokenSuccessWithAccount[],
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
					const accountId = result.accountIdOverride ?? extractAccountId(result.access);
					const accountIdSource =
							accountId
									? result.accountIdSource ??
										(result.accountIdOverride ? "manual" : "token")
									: undefined;
					const accountLabel = result.accountLabel;
					const accountEmail = sanitizeEmail(extractAccountEmail(result.access, result.idToken));
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
                                        accountIdSource,
                                        accountLabel,
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
						const nextAccountId = accountId ?? existing.accountId;
						const nextAccountIdSource =
								accountId ? accountIdSource ?? existing.accountIdSource : existing.accountIdSource;
						const nextAccountLabel = accountLabel ?? existing.accountLabel;
						accounts[existingIndex] = {
								...existing,
								accountId: nextAccountId,
								accountIdSource: nextAccountIdSource,
								accountLabel: nextAccountLabel,
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
                options?: { title?: string; duration?: number },
        ): Promise<void> => {
                try {
                        await client.tui.showToast({
                                body: {
                                        message,
                                        variant,
                                        ...(options?.title && { title: options.title }),
                                        ...(options?.duration && { duration: options.duration }),
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
                                        const email = sanitizeEmail(extractAccountEmail(refreshed.access, refreshed.idToken));
                                        if (
                                                id &&
                                                id !== account.accountId &&
                                                shouldUpdateAccountIdFromToken(account.accountIdSource, account.accountId)
                                        ) {
                                                account.accountId = id;
                                                account.accountIdSource = "token";
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

        // Event handler for session recovery and account selection
        const eventHandler = async (input: { event: { type: string; properties?: unknown } }) => {
                const { event } = input;
                // Handle TUI account selection events
                // Accepts generic selection events with an index property
                if (
                        event.type === "account.select" ||
                        event.type === "openai.account.select"
                ) {
                        const props = event.properties as { index?: number; accountIndex?: number; provider?: string };
                        // Filter by provider if specified
                        if (props.provider && props.provider !== "openai" && props.provider !== PROVIDER_ID) {
                                return;
                        }

                        const index = props.index ?? props.accountIndex;
                        if (typeof index === "number" && cachedAccountManager) {
                                // Convert 1-based index (UI) to 0-based index (internal) if needed,
                                // or handle 0-based directly. Usually UI lists are 0-based in code but 1-based in display.
                                // AccountManager.setActiveIndex expects 0-based index.
                                // Assuming the event passes the raw index from the list.
                                const account = cachedAccountManager.setActiveIndex(index);
                                if (account) {
                                        await cachedAccountManager.saveToDisk();
                                        await showToast(`Switched to account ${index + 1}`, "info");
                                }
                        }
                }
        };

        return {
                event: eventHandler,
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

			// Only handle multi-account auth (identified by multiAccount flag)
			// If auth was created by built-in plugin, let built-in handle it
			const authWithMulti = auth as typeof auth & { multiAccount?: boolean };
			if (!authWithMulti.multiAccount) {
				logDebug(`[${PLUGIN_NAME}] Auth is not multi-account, skipping loader`);
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
				const toastDurationMs = getToastDurationMs(pluginConfig);
				const perProjectAccounts = getPerProjectAccounts(pluginConfig);

				if (perProjectAccounts) {
					setStoragePath(process.cwd());
				}

				const sessionRecoveryEnabled = getSessionRecovery(pluginConfig);
				const autoResumeEnabled = getAutoResume(pluginConfig);

				const recoveryHook = sessionRecoveryEnabled
					? createSessionRecoveryHook(
							{ client, directory: process.cwd() },
							{ sessionRecovery: true, autoResume: autoResumeEnabled }
						)
					: null;

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

					const sleepWithCountdown = async (
						totalMs: number,
						message: string,
						intervalMs: number = 5000,
					): Promise<void> => {
						const startTime = Date.now();
						const endTime = startTime + totalMs;
						
						while (Date.now() < endTime) {
							if (abortSignal?.aborted) {
								throw new Error("Aborted");
							}
							
							const remaining = Math.max(0, endTime - Date.now());
							const waitLabel = formatWaitTime(remaining);
							await showToast(
								`${message} (${waitLabel} remaining)`,
								"warning",
								{ duration: Math.min(intervalMs + 1000, toastDurationMs) },
							);
							
							const sleepTime = Math.min(intervalMs, remaining);
							if (sleepTime > 0) {
								await sleep(sleepTime);
							} else {
								break;
							}
						}
					};

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
							// Log account selection for debugging rotation
							logDebug(
								`Using account ${account.index + 1}/${accountCount}: ${account.email ?? "unknown"} for ${modelFamily}`,
							);

											let accountAuth = accountManager.toAuthDetails(account) as OAuthAuthDetails;
								try {
						if (shouldRefreshToken(accountAuth, tokenRefreshSkewMs)) {
							accountAuth = (await refreshAndUpdateToken(
								accountAuth,
								client,
							)) as OAuthAuthDetails;
							accountManager.updateFromAuth(account, accountAuth);
							accountManager.clearAuthFailures(account);
							accountManager.saveToDiskDebounced();
						}
			} catch (err) {
				logDebug(`[${PLUGIN_NAME}] Auth refresh failed for account: ${(err as Error)?.message ?? String(err)}`);
				const failures = accountManager.incrementAuthFailures(account);
				const accountLabel = formatAccountLabel(account, account.index);
				
				if (failures >= ACCOUNT_LIMITS.MAX_AUTH_FAILURES_BEFORE_REMOVAL) {
					accountManager.removeAccount(account);
					accountManager.saveToDiskDebounced();
					await showToast(
						`Removed ${accountLabel} after ${failures} consecutive auth failures. Run 'opencode auth login' to re-add.`,
						"error",
						{ duration: toastDurationMs * 2 },
					);
					continue;
				}
				
				accountManager.markAccountCoolingDown(
								account,
								ACCOUNT_LIMITS.AUTH_FAILURE_COOLDOWN_MS,
								"auth-failure",
							);
						accountManager.saveToDiskDebounced();
						continue;
					}

						const hadAccountId = !!account.accountId;
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
											if (!hadAccountId) {
												account.accountIdSource = account.accountIdSource ?? "token";
											}
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
									const contextOverflowResult = await handleContextOverflow(response, model);
									if (contextOverflowResult.handled) {
										return contextOverflowResult.response;
									}

									const { response: errorResponse, rateLimit, errorBody } =
										await handleErrorResponse(response);

							if (recoveryHook && errorBody && isRecoverableError(errorBody)) {
									const errorType = detectErrorType(errorBody);
									const toastContent = getRecoveryToastContent(errorType);
									await showToast(
										`${toastContent.title}: ${toastContent.message}`,
										"warning",
										{ duration: toastDurationMs },
									);
										logDebug(`[${PLUGIN_NAME}] Recoverable error detected: ${errorType}`);
									}

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
																										{ duration: toastDurationMs },
																									);
																																			accountManager.markToastShown(account.index);
								}

															await sleep(addJitter(delayMs, 0.2));
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
						logWarn(
							`Rate limited. Rotating account ${account.index + 1} (${account.email ?? "unknown"}).`,
						);

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
																										{ duration: toastDurationMs },
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
									const countdownMessage = `All ${count} account(s) rate-limited. Waiting`;
									await sleepWithCountdown(addJitter(waitMs, 0.2), countdownMessage);
									allRateLimitedRetries++;
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
					prompts: [
						{
							type: "select",
							key: "loginMode",
							message: "Account handling",
							options: [
								{
									label: "Add to existing accounts",
									value: "add",
									hint: "Keep current accounts",
								},
								{
									label: "Start fresh",
									value: "fresh",
									hint: "Replace existing accounts",
								},
							],
						},
						{
							type: "text",
							key: "accountCount",
							message: "How many accounts to add? (1-5)",
							placeholder: "1",
							validate: (value) => {
								const parsed = Number.parseInt(value, 10);
								if (!Number.isFinite(parsed)) return "Enter a number";
								if (parsed < 1) return "Minimum is 1";
								if (parsed > ACCOUNT_LIMITS.MAX_ACCOUNTS) return `Maximum is ${ACCOUNT_LIMITS.MAX_ACCOUNTS}`;
								return undefined;
							},
						},
					],
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
							// Always use the multi-account flow regardless of inputs
							// The inputs parameter is only used for noBrowser flag, not for flow selection
							const accounts: TokenSuccessWithAccount[] = [];
							const noBrowser =
								inputs?.noBrowser === "true" ||
								inputs?.["no-browser"] === "true";
							const useManualMode = noBrowser;
							const existingStorage = await hydrateEmails(await loadAccounts());
							const existingCount = existingStorage?.accounts.length ?? 0;

							let startFresh = false;
							if (existingCount > 0 && existingStorage) {
								if (inputs?.loginMode) {
									startFresh = inputs.loginMode === "fresh";
								} else {
									const existingAccounts = existingStorage.accounts.map(
										(account, index) => ({
											accountId: account.accountId,
											accountLabel: account.accountLabel,
											email: account.email,
											index,
										}),
									);
									const loginMode = await promptLoginMode(existingAccounts);
									startFresh = loginMode === "fresh";
								}

								if (startFresh) {
						logInfo(
							"Starting fresh - existing accounts will be replaced.",
						);
					} else {
						logInfo("Adding to existing accounts.");
					}
							}

							const requestedCount = Number.parseInt(
								inputs?.accountCount ?? "1",
								10,
							);
							const normalizedRequested = Number.isFinite(requestedCount)
								? requestedCount
								: 1;
							const availableSlots = startFresh
								? ACCOUNT_LIMITS.MAX_ACCOUNTS
								: ACCOUNT_LIMITS.MAX_ACCOUNTS - existingCount;
							const targetCount = Math.max(
								1,
								Math.min(normalizedRequested, availableSlots),
							);

							if (availableSlots <= 0) {
								return {
									url: "",
									instructions:
										"Account limit reached. Remove an account or start fresh.",
									method: "auto",
									callback: async () => ({
										type: "failed" as const,
									}),
								};
							}

					if (useManualMode) {
						const { pkce, url } = await createAuthorizationFlow();
						return buildManualOAuthFlow(pkce, url, async (tokens) => {
							try {
								await persistAccountPool([tokens], startFresh);
							} catch (err) {
								const storagePath = getStoragePath();
								logWarn(`[${PLUGIN_NAME}] Failed to persist account to disk: ${(err as Error)?.message ?? String(err)}`);
								logWarn(`Storage path: ${storagePath}`);
								await showToast(
									`Account authenticated but failed to save to disk. Storage path: ${storagePath}`,
									"warning",
									{ title: "Account Persistence Failed", duration: 10000 },
								);
							}
						});
					}

							while (accounts.length < targetCount) {
						logInfo(
							`=== OpenAI OAuth (Account ${accounts.length + 1}) ===`,
						);

								const forceNewLogin = accounts.length > 0;
								const result = await runOAuthFlow(forceNewLogin);

								let resolved: TokenSuccessWithAccount | null = null;
				if (result.type === "success") {
					resolved = await resolveAccountSelection(result);
					const email = extractAccountEmail(resolved.access, resolved.idToken);
					const accountId =
						resolved.accountIdOverride ?? extractAccountId(resolved.access);
					const label = resolved.accountLabel ?? email ?? accountId ?? "Unknown account";
						logInfo(`Authenticated as: ${label}`);

					const isDuplicate = accounts.some(
						(acc) =>
							(accountId &&
								(acc.accountIdOverride ?? extractAccountId(acc.access)) === accountId) ||
							(email && extractAccountEmail(acc.access, acc.idToken) === email),
					);

						if (isDuplicate) {
							logWarn(
								`\n⚠️  WARNING: You authenticated with an account that is already in the list (${label}).`,
							);
							logWarn(
								"This usually happens if you didn't log out or use a different browser profile.",
							);
							logWarn("The duplicate will update the existing entry.");
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
							logWarn(
								`[${PLUGIN_NAME}] Skipping failed account ${
									accounts.length + 1
								}`,
							);
                                                                        break;
                                                                }

                                                                if (!resolved) {
                                                                        continue;
                                                                }

                                                                accounts.push(resolved);
                                                                await showToast(
                                                                        `Account ${accounts.length} authenticated`,
                                                                        "success",
                                                                );

                                                                try {
                                                                        const isFirstAccount = accounts.length === 1;
                                                                        await persistAccountPool(
                                                                                [resolved],
                                                                                isFirstAccount && startFresh,
                                                                        );
                                                                } catch (err) {
                                                                        const storagePath = getStoragePath();
                                                                        logWarn(`[${PLUGIN_NAME}] Failed to persist account to disk: ${(err as Error)?.message ?? String(err)}`);
                                                                        logWarn(`Storage path: ${storagePath}`);
                                                                        await showToast(
                                                                                `Account authenticated but failed to save to disk. Storage path: ${storagePath}`,
                                                                                "warning",
                                                                                { title: "Account Persistence Failed", duration: 10000 },
                                                                        );
                                                                }

								if (accounts.length >= ACCOUNT_LIMITS.MAX_ACCOUNTS) {
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
                                        },
					},
				{
					label: AUTH_LABELS.OAUTH_MANUAL,
					type: "oauth" as const,
                                                authorize: async () => {
                                                        const { pkce, url } = await createAuthorizationFlow();
                                                        return buildManualOAuthFlow(pkce, url, async (tokens) => {
                                                                try {
                                                                        await persistAccountPool([tokens], false);
                                                                } catch (err) {
                                                                        const storagePath = getStoragePath();
                                                                        logWarn(`[${PLUGIN_NAME}] Failed to persist account to disk: ${(err as Error)?.message ?? String(err)}`);
                                                                        logWarn(`Storage path: ${storagePath}`);
                                                                        await showToast(
                                                                                `Account authenticated but failed to save to disk. Storage path: ${storagePath}`,
                                                                                "warning",
                                                                                { title: "Account Persistence Failed", duration: 10000 },
                                                                        );
                                                                }
                                                        });
                                                },
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
				args: {},
				async execute() {
					const storage = await loadAccounts();
					if (!storage || storage.accounts.length === 0) {
						return "No OpenAI accounts configured. Run: opencode auth login";
					}

					const now = Date.now();
					const activeIndex = resolveActiveIndex(storage, "codex");

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
			"openai-accounts-remove": tool({
				description: "Remove an OpenAI account by index (1-based). Use openai-accounts to list accounts first.",
				args: {
					index: tool.schema.number().describe(
						"Account number to remove (1-based, e.g., 1 for first account)",
					),
				},
				async execute({ index }) {
					const storage = await loadAccounts();
					if (!storage || storage.accounts.length === 0) {
						return "No OpenAI accounts configured. Nothing to remove.";
					}

					const targetIndex = Math.floor((index ?? 0) - 1);
					if (
						!Number.isFinite(targetIndex) ||
						targetIndex < 0 ||
						targetIndex >= storage.accounts.length
					) {
						return `Invalid account number: ${index}\n\nValid range: 1-${storage.accounts.length}\n\nUse openai-accounts to list all accounts.`;
					}

					const account = storage.accounts[targetIndex];
					if (!account) {
						return `Account ${index} not found.`;
					}

					const label = formatAccountLabel(account, targetIndex);

					storage.accounts.splice(targetIndex, 1);

					if (storage.accounts.length === 0) {
						storage.activeIndex = 0;
						storage.activeIndexByFamily = {};
					} else {
						if (storage.activeIndex >= storage.accounts.length) {
							storage.activeIndex = 0;
						} else if (storage.activeIndex > targetIndex) {
							storage.activeIndex -= 1;
						}

						if (storage.activeIndexByFamily) {
							for (const family of MODEL_FAMILIES) {
								const idx = storage.activeIndexByFamily[family];
								if (typeof idx === "number") {
									if (idx >= storage.accounts.length) {
										storage.activeIndexByFamily[family] = 0;
									} else if (idx > targetIndex) {
										storage.activeIndexByFamily[family] = idx - 1;
									}
								}
							}
						}
					}

					await saveAccounts(storage);

					if (cachedAccountManager) {
						const managedAccounts = cachedAccountManager.getAccountsSnapshot();
						const managedAccount = managedAccounts.find(
							(acc) => acc.refreshToken === account.refreshToken
						);
						if (managedAccount) {
							cachedAccountManager.removeAccount(managedAccount);
							await cachedAccountManager.saveToDisk();
						}
					}

					const remaining = storage.accounts.length;
					return [
						`Removed: ${label}`,
						"",
						remaining > 0
							? `Remaining accounts: ${remaining}`
							: "No accounts remaining. Run: opencode auth login",
					].join("\n");
				},
			}),

			"openai-accounts-refresh": tool({
				description: "Manually refresh OAuth tokens for all accounts to verify they're still valid.",
				args: {},
				async execute() {
					const storage = await loadAccounts();
					if (!storage || storage.accounts.length === 0) {
						return "No OpenAI accounts configured. Run: opencode auth login";
					}

					const results: string[] = [
						`Refreshing ${storage.accounts.length} account(s):`,
						"",
					];

					let refreshedCount = 0;
					let failedCount = 0;

					for (let i = 0; i < storage.accounts.length; i++) {
						const account = storage.accounts[i];
						if (!account) continue;
						const label = formatAccountLabel(account, i);

						try {
							const refreshResult = await queuedRefresh(account.refreshToken);
							if (refreshResult.type === "success") {
								account.refreshToken = refreshResult.refresh;
								results.push(`  ✓ ${label}: Refreshed`);
								refreshedCount++;
							} else {
								results.push(`  ✗ ${label}: Failed - ${refreshResult.message ?? refreshResult.reason}`);
								failedCount++;
							}
						} catch (error) {
							const errorMsg = error instanceof Error ? error.message : String(error);
							results.push(`  ✗ ${label}: Error - ${errorMsg.slice(0, 50)}`);
							failedCount++;
						}
					}

					await saveAccounts(storage);
					results.push("");
					results.push(`Summary: ${refreshedCount} refreshed, ${failedCount} failed`);
					return results.join("\n");
				},
			}),

		},
        };
};

export const OpenAIAuthPlugin = OpenAIOAuthPlugin;

export default OpenAIOAuthPlugin;
