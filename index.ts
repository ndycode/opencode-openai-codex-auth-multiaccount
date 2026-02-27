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
import { queuedRefresh, getRefreshQueueMetrics } from "./lib/refresh-queue.js";
import { openBrowserUrl } from "./lib/auth/browser.js";
import { startLocalOAuthServer } from "./lib/auth/server.js";
import { promptAddAnotherAccount, promptLoginMode } from "./lib/cli.js";
import {
	getCodexMode,
	getRequestTransformMode,
	getFastSession,
	getFastSessionStrategy,
	getFastSessionMaxInputItems,
	getRetryProfile,
	getRetryBudgetOverrides,
	getRateLimitToastDebounceMs,
	getRetryAllAccountsMaxRetries,
	getRetryAllAccountsMaxWaitMs,
	getRetryAllAccountsRateLimited,
	getFallbackToGpt52OnUnsupportedGpt53,
	getUnsupportedCodexPolicy,
	getUnsupportedCodexFallbackChain,
	getTokenRefreshSkewMs,
	getSessionRecovery,
	getAutoResume,
	getToastDurationMs,
	getPerProjectAccounts,
	getEmptyResponseMaxRetries,
	getEmptyResponseRetryDelayMs,
	getPidOffsetEnabled,
	getFetchTimeoutMs,
	getStreamStallTimeoutMs,
	getCodexTuiV2,
	getCodexTuiColorProfile,
	getCodexTuiGlyphMode,
	getBeginnerSafeMode,
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
import {
	initLogger,
	logRequest,
	logDebug,
	logInfo,
	logWarn,
	logError,
	setCorrelationId,
	clearCorrelationId,
} from "./lib/logger.js";
import { checkAndNotify } from "./lib/auto-update-checker.js";
import { handleContextOverflow } from "./lib/context-overflow.js";
import {
	AccountManager,
	type AccountSelectionExplainability,
        getAccountIdCandidates,
        extractAccountEmail,
        extractAccountId,
        formatAccountLabel,
        formatCooldown,
        formatWaitTime,
        sanitizeEmail,
        selectBestAccountCandidate,
        shouldUpdateAccountIdFromToken,
        resolveRequestAccountId,
        parseRateLimitReason,
	lookupCodexCliTokensByEmail,
} from "./lib/accounts.js";
import {
	getStoragePath,
	loadAccounts,
	saveAccounts,
	withAccountStorageTransaction,
	clearAccounts,
	setStoragePath,
	exportAccounts,
	importAccounts,
	previewImportAccounts,
	createTimestampedBackupPath,
	loadFlaggedAccounts,
	saveFlaggedAccounts,
	clearFlaggedAccounts,
	StorageError,
	formatStorageErrorHint,
	type AccountStorageV3,
	type FlaggedAccountMetadataV1,
} from "./lib/storage.js";
import {
	createCodexHeaders,
	extractRequestUrl,
        handleErrorResponse,
        handleSuccessResponse,
	getUnsupportedCodexModelInfo,
	resolveUnsupportedCodexFallbackModel,
        refreshAndUpdateToken,
        rewriteUrlForCodex,
	shouldRefreshToken,
	transformRequestForCodex,
} from "./lib/request/fetch-helpers.js";
import { applyFastSessionDefaults } from "./lib/request/request-transformer.js";
import {
	getRateLimitBackoff,
	RATE_LIMIT_SHORT_RETRY_THRESHOLD_MS,
	resetRateLimitBackoff,
} from "./lib/request/rate-limit-backoff.js";
import { isEmptyResponse } from "./lib/request/response-handler.js";
import {
	RetryBudgetTracker,
	resolveRetryBudgetLimits,
	type RetryBudgetClass,
	type RetryBudgetLimits,
} from "./lib/request/retry-budget.js";
import { addJitter } from "./lib/rotation.js";
import { buildTableHeader, buildTableRow, type TableOptions } from "./lib/table-formatter.js";
import { setUiRuntimeOptions, type UiRuntimeOptions } from "./lib/ui/runtime.js";
import { paintUiText, formatUiBadge, formatUiHeader, formatUiItem, formatUiKeyValue, formatUiSection } from "./lib/ui/format.js";
import {
	buildBeginnerChecklist,
	buildBeginnerDoctorFindings,
	recommendBeginnerNextAction,
	summarizeBeginnerAccounts,
	type BeginnerAccountSnapshot,
	type BeginnerDiagnosticSeverity,
	type BeginnerRuntimeSnapshot,
} from "./lib/ui/beginner.js";
import {
	getModelFamily,
	getCodexInstructions,
	MODEL_FAMILIES,
	prewarmCodexInstructions,
	type ModelFamily,
} from "./lib/prompts/codex.js";
import { prewarmOpenCodeCodexPrompt } from "./lib/prompts/opencode-codex.js";
import type {
	AccountIdSource,
	OAuthAuthDetails,
	RequestBody,
	TokenResult,
	UserConfig,
} from "./lib/types.js";
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
// eslint-disable-next-line @typescript-eslint/require-await
export const OpenAIOAuthPlugin: Plugin = async ({ client }: PluginInput) => {
	initLogger(client);
	let cachedAccountManager: AccountManager | null = null;
	let accountManagerPromise: Promise<AccountManager> | null = null;
	let loaderMutex: Promise<void> | null = null;
	let startupPrewarmTriggered = false;
	let startupPreflightShown = false;
	let beginnerSafeModeEnabled = false;
	const MIN_BACKOFF_MS = 100;

	type SelectionSnapshot = {
		timestamp: number;
		family: ModelFamily;
		model: string | null;
		selectedAccountIndex: number | null;
		quotaKey: string;
		explainability: AccountSelectionExplainability[];
	};

	const createRetryBudgetUsage = (): Record<RetryBudgetClass, number> => ({
		authRefresh: 0,
		network: 0,
		server: 0,
		rateLimitShort: 0,
		rateLimitGlobal: 0,
		emptyResponse: 0,
	});

	type RuntimeMetrics = {
		startedAt: number;
		totalRequests: number;
		successfulRequests: number;
		failedRequests: number;
		rateLimitedResponses: number;
		serverErrors: number;
		networkErrors: number;
		authRefreshFailures: number;
		emptyResponseRetries: number;
		accountRotations: number;
		cumulativeLatencyMs: number;
		retryBudgetExhaustions: number;
		retryBudgetUsage: Record<RetryBudgetClass, number>;
		retryBudgetLimits: RetryBudgetLimits;
		retryProfile: string;
		lastRetryBudgetExhaustedClass: RetryBudgetClass | null;
		lastRetryBudgetReason: string | null;
		lastRequestAt: number | null;
		lastError: string | null;
		lastErrorCategory: string | null;
		lastSelectedAccountIndex: number | null;
		lastQuotaKey: string | null;
		lastSelectionSnapshot: SelectionSnapshot | null;
	};

	const runtimeMetrics: RuntimeMetrics = {
		startedAt: Date.now(),
		totalRequests: 0,
		successfulRequests: 0,
		failedRequests: 0,
		rateLimitedResponses: 0,
		serverErrors: 0,
		networkErrors: 0,
		authRefreshFailures: 0,
		emptyResponseRetries: 0,
		accountRotations: 0,
		cumulativeLatencyMs: 0,
		retryBudgetExhaustions: 0,
		retryBudgetUsage: createRetryBudgetUsage(),
		retryBudgetLimits: resolveRetryBudgetLimits("balanced"),
		retryProfile: "balanced",
		lastRetryBudgetExhaustedClass: null,
		lastRetryBudgetReason: null,
		lastRequestAt: null,
		lastError: null,
		lastErrorCategory: null,
		lastSelectedAccountIndex: null,
		lastQuotaKey: null,
		lastSelectionSnapshot: null,
	};

		type TokenSuccess = Extract<TokenResult, { type: "success" }>;
		type TokenSuccessWithAccount = TokenSuccess & {
				accountIdOverride?: string;
				organizationIdOverride?: string;
				accountIdSource?: AccountIdSource;
				accountLabel?: string;
		};

		type AccountSelectionResult = {
				primary: TokenSuccessWithAccount;
				variantsForPersistence: TokenSuccessWithAccount[];
		};

		const createSelectionVariant = (
				tokens: TokenSuccess,
				candidate: {
					accountId: string;
					organizationId?: string;
					source?: AccountIdSource;
					label?: string;
				},
		): TokenSuccessWithAccount => ({
				...tokens,
				accountIdOverride: candidate.accountId,
				organizationIdOverride: candidate.organizationId,
				accountIdSource: candidate.source,
				accountLabel: candidate.label,
		});

		const resolveAccountSelection = (
				tokens: TokenSuccess,
		): AccountSelectionResult => {
				const override = (process.env.CODEX_AUTH_ACCOUNT_ID ?? "").trim();
				if (override) {
						const suffix = override.length > 6 ? override.slice(-6) : override;
						logInfo(`Using account override from CODEX_AUTH_ACCOUNT_ID (id:${suffix}).`);
						const primary = {
								...tokens,
								accountIdOverride: override,
								accountIdSource: "manual" as const,
								accountLabel: `Override [id:${suffix}]`,
						};
						return {
								primary,
								variantsForPersistence: [primary],
						};
				}

				const candidates = getAccountIdCandidates(tokens.access, tokens.idToken);
				if (candidates.length === 0) {
						return {
								primary: tokens,
								variantsForPersistence: [tokens],
						};
				}

				// Auto-select the best workspace candidate without prompting.
				// This honors org/default/id-token signals and avoids forcing personal token IDs.
				const choice = selectBestAccountCandidate(candidates);
				if (!choice) {
						return {
								primary: tokens,
								variantsForPersistence: [tokens],
						};
				}

				const primary = createSelectionVariant(tokens, {
						accountId: choice.accountId,
						organizationId: choice.organizationId,
						source: choice.source ?? "token",
						label: choice.label,
				});

				const variantsForPersistence: TokenSuccessWithAccount[] = [primary];
				for (const candidate of candidates) {
						if (
							candidate.accountId === primary.accountIdOverride &&
							(candidate.organizationId ?? "") === (primary.organizationIdOverride ?? "")
						) {
							continue;
						}
						variantsForPersistence.push(
								createSelectionVariant(tokens, {
										accountId: candidate.accountId,
										organizationId: candidate.organizationId,
										source: candidate.source,
										label: candidate.label,
								}),
						);
				}

				return {
						primary,
						variantsForPersistence,
				};
		};

		const buildManualOAuthFlow = (
				pkce: { verifier: string },
				url: string,
				expectedState: string,
				onSuccess?: (selection: AccountSelectionResult) => Promise<void>,
		) => ({
                url,
                method: "code" as const,
                instructions: AUTH_LABELS.INSTRUCTIONS_MANUAL,
                validate: (input: string): string | undefined => {
                        const parsed = parseAuthorizationInput(input);
                        if (!parsed.code) {
                                return "No authorization code found. Paste the full callback URL (e.g., http://localhost:1455/auth/callback?code=...)";
                        }
                        if (!parsed.state) {
                                return "Missing OAuth state. Paste the full callback URL including both code and state parameters.";
                        }
                        if (parsed.state !== expectedState) {
                                return "OAuth state mismatch. Restart login and paste the callback URL generated for this login attempt.";
                        }
                        return undefined;
                },
                callback: async (input: string) => {
                        const parsed = parseAuthorizationInput(input);
                        if (!parsed.code || !parsed.state) {
                                return {
                                        type: "failed" as const,
                                        reason: "invalid_response" as const,
                                        message: "Missing authorization code or OAuth state",
                                };
                        }
                        if (parsed.state !== expectedState) {
                                return {
                                        type: "failed" as const,
                                        reason: "invalid_response" as const,
                                        message: "OAuth state mismatch. Restart login and try again.",
                                };
                        }
						const tokens = await exchangeAuthorizationCode(
								parsed.code,
								pkce.verifier,
								REDIRECT_URI,
						);
						if (tokens?.type === "success") {
								const resolved = resolveAccountSelection(tokens);
								if (onSuccess) {
										await onSuccess(resolved);
								}
								return resolved.primary;
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
				await withAccountStorageTransaction(async (loadedStorage, persist) => {
					const now = Date.now();
					const stored = replaceAll ? null : loadedStorage;
			let accounts = stored?.accounts ? [...stored.accounts] : [];

					const pushIndex = (
						map: Map<string, number[]>,
						key: string,
						index: number,
					): void => {
						const existing = map.get(key);
						if (existing) {
							existing.push(index);
							return;
						}
						map.set(key, [index]);
					};

			const asUniqueIndex = (indices: number[] | undefined): number | undefined => {
				if (!indices || indices.length !== 1) return undefined;
				const [onlyIndex] = indices;
				return typeof onlyIndex === "number" ? onlyIndex : undefined;
			};

			const pickNewestAccountIndex = (existingIndex: number, candidateIndex: number): number => {
				const existing = accounts[existingIndex];
				const candidate = accounts[candidateIndex];
				if (!existing) return candidateIndex;
				if (!candidate) return existingIndex;
				const existingLastUsed = existing.lastUsed ?? 0;
				const candidateLastUsed = candidate.lastUsed ?? 0;
				if (candidateLastUsed > existingLastUsed) return candidateIndex;
				if (candidateLastUsed < existingLastUsed) return existingIndex;
				const existingAddedAt = existing.addedAt ?? 0;
				const candidateAddedAt = candidate.addedAt ?? 0;
				return candidateAddedAt >= existingAddedAt ? candidateIndex : existingIndex;
			};

			const mergeAccountRecords = (targetIndex: number, sourceIndex: number): void => {
				const target = accounts[targetIndex];
				const source = accounts[sourceIndex];
				if (!target || !source) return;
				const targetLastUsed = target.lastUsed ?? 0;
				const sourceLastUsed = source.lastUsed ?? 0;
				const targetAddedAt = target.addedAt ?? 0;
				const sourceAddedAt = source.addedAt ?? 0;
				const sourceIsNewer =
					sourceLastUsed > targetLastUsed ||
					(sourceLastUsed === targetLastUsed && sourceAddedAt > targetAddedAt);
				const newer = sourceIsNewer ? source : target;
				const older = sourceIsNewer ? target : source;
				const mergedRateLimitResetTimes: Record<string, number> = {};
				const rateLimitResetKeys = new Set([
					...Object.keys(older.rateLimitResetTimes ?? {}),
					...Object.keys(newer.rateLimitResetTimes ?? {}),
				]);
				for (const key of rateLimitResetKeys) {
					const olderRaw = older.rateLimitResetTimes?.[key];
					const newerRaw = newer.rateLimitResetTimes?.[key];
					const olderValue =
						typeof olderRaw === "number" && Number.isFinite(olderRaw) ? olderRaw : 0;
					const newerValue =
						typeof newerRaw === "number" && Number.isFinite(newerRaw) ? newerRaw : 0;
					const resolved = Math.max(olderValue, newerValue);
					if (resolved > 0) {
						mergedRateLimitResetTimes[key] = resolved;
					}
				}
				const mergedEnabled =
					target.enabled === false || source.enabled === false
						? false
						: target.enabled ?? source.enabled;
				const targetCoolingDownUntil =
					typeof target.coolingDownUntil === "number" && Number.isFinite(target.coolingDownUntil)
						? target.coolingDownUntil
						: 0;
				const sourceCoolingDownUntil =
					typeof source.coolingDownUntil === "number" && Number.isFinite(source.coolingDownUntil)
						? source.coolingDownUntil
						: 0;
				const mergedCoolingDownUntilValue = Math.max(
					targetCoolingDownUntil,
					sourceCoolingDownUntil,
				);
				const mergedCoolingDownUntil =
					mergedCoolingDownUntilValue > 0 ? mergedCoolingDownUntilValue : undefined;
				const mergedCooldownReason = (() => {
					if (mergedCoolingDownUntilValue <= 0) {
						return target.cooldownReason ?? source.cooldownReason;
					}
					if (sourceCoolingDownUntil > targetCoolingDownUntil) {
						return source.cooldownReason ?? target.cooldownReason;
					}
					if (targetCoolingDownUntil > sourceCoolingDownUntil) {
						return target.cooldownReason ?? source.cooldownReason;
					}
					return source.cooldownReason ?? target.cooldownReason;
				})();
				accounts[targetIndex] = {
					...target,
					accountId: target.accountId ?? source.accountId,
					organizationId: target.organizationId ?? source.organizationId,
					accountIdSource: target.accountIdSource ?? source.accountIdSource,
					accountLabel: target.accountLabel ?? source.accountLabel,
					email: target.email ?? source.email,
					refreshToken: newer.refreshToken || older.refreshToken,
					accessToken: newer.accessToken || older.accessToken,
					expiresAt: newer.expiresAt ?? older.expiresAt,
					enabled: mergedEnabled,
					addedAt: Math.max(target.addedAt ?? 0, source.addedAt ?? 0),
					lastUsed: Math.max(target.lastUsed ?? 0, source.lastUsed ?? 0),
					lastSwitchReason: target.lastSwitchReason ?? source.lastSwitchReason,
					rateLimitResetTimes: mergedRateLimitResetTimes,
					coolingDownUntil: mergedCoolingDownUntil,
					cooldownReason: mergedCooldownReason,
				};
			};

			const normalizeStoredAccountId = (
				account: { accountId?: string } | undefined,
			): string | undefined => {
				const accountId = account?.accountId?.trim();
				return accountId && accountId.length > 0 ? accountId : undefined;
			};

			const hasDistinctNonEmptyAccountIds = (
				left: { accountId?: string } | undefined,
				right: { accountId?: string } | undefined,
			): boolean => {
				const leftId = normalizeStoredAccountId(left);
				const rightId = normalizeStoredAccountId(right);
				return !!leftId && !!rightId && leftId !== rightId;
			};

			const canCollapseWithCandidateAccountId = (
				existing: { accountId?: string } | undefined,
				candidateAccountId: string | undefined,
			): boolean => {
				const existingAccountId = normalizeStoredAccountId(existing);
				const normalizedCandidate = candidateAccountId?.trim() || undefined;
				if (!existingAccountId || !normalizedCandidate) {
					return true;
				}
				return existingAccountId === normalizedCandidate;
			};


					type IdentityIndexes = {
						byOrganizationId: Map<string, number>;
						byAccountIdNoOrg: Map<string, number>;
						byRefreshTokenNoOrg: Map<string, number[]>;
						byEmailNoOrg: Map<string, number>;
						byAccountIdOrgScoped: Map<string, number[]>;
						byRefreshTokenOrgScoped: Map<string, number[]>;
						byRefreshTokenGlobal: Map<string, number[]>;
					};

					const resolveNoOrgRefreshMatch = (
						indexes: IdentityIndexes,
						refreshToken: string,
						candidateAccountId: string | undefined,
					): number | undefined => {
						const candidateId = candidateAccountId?.trim() || undefined;
						const matches = indexes.byRefreshTokenNoOrg.get(refreshToken);
						if (!matches || matches.length === 0) return undefined;
						let newestNoAccountId: number | undefined;
						let newestExactAccountId: number | undefined;

						for (const index of matches) {
							const existing = accounts[index];
							const existingAccountId = normalizeStoredAccountId(existing);
							if (!existingAccountId) {
								newestNoAccountId =
									typeof newestNoAccountId === "number"
										? pickNewestAccountIndex(newestNoAccountId, index)
										: index;
								continue;
							}
							if (candidateId && existingAccountId === candidateId) {
								newestExactAccountId =
									typeof newestExactAccountId === "number"
										? pickNewestAccountIndex(newestExactAccountId, index)
										: index;
							}
						}

						return newestExactAccountId ?? newestNoAccountId;
					};

					const resolveUniqueOrgScopedMatch = (
						indexes: IdentityIndexes,
						accountId: string | undefined,
						refreshToken: string,
					): number | undefined => {
						const byAccountId = accountId
							? asUniqueIndex(indexes.byAccountIdOrgScoped.get(accountId))
							: undefined;
						if (byAccountId !== undefined) return byAccountId;

						// Refresh-token-only fallback is allowed only when accountId is absent.
						// This avoids collapsing distinct workspace variants that share refresh token.
						if (accountId) return undefined;

						return asUniqueIndex(indexes.byRefreshTokenOrgScoped.get(refreshToken));
					};

					const buildIdentityIndexes = (): IdentityIndexes => {
						const byOrganizationId = new Map<string, number>();
						const byAccountIdNoOrg = new Map<string, number>();
						const byRefreshTokenNoOrg = new Map<string, number[]>();
						const byEmailNoOrg = new Map<string, number>();
						const byAccountIdOrgScoped = new Map<string, number[]>();
						const byRefreshTokenOrgScoped = new Map<string, number[]>();
						const byRefreshTokenGlobal = new Map<string, number[]>();

						for (let i = 0; i < accounts.length; i += 1) {
							const account = accounts[i];
							if (!account) continue;

							const organizationId = account.organizationId?.trim();
							const accountId = account.accountId?.trim();
							const refreshToken = account.refreshToken?.trim();
							const email = account.email?.trim();

							// Track all refresh-token matches. Callers can require uniqueness
							// so org variants that share a token do not collapse accidentally.
							if (refreshToken) {
								pushIndex(byRefreshTokenGlobal, refreshToken, i);
							}

							if (organizationId) {
								byOrganizationId.set(organizationId, i);
								if (accountId) {
									pushIndex(byAccountIdOrgScoped, accountId, i);
								}
								if (refreshToken) {
									pushIndex(byRefreshTokenOrgScoped, refreshToken, i);
								}
								continue;
							}

							if (accountId) {
								byAccountIdNoOrg.set(accountId, i);
							}
							if (refreshToken) {
								pushIndex(byRefreshTokenNoOrg, refreshToken, i);
							}
							if (email) {
								byEmailNoOrg.set(email, i);
							}
						}

						return {
							byOrganizationId,
							byAccountIdNoOrg,
							byRefreshTokenNoOrg,
							byEmailNoOrg,
							byAccountIdOrgScoped,
							byRefreshTokenOrgScoped,
							byRefreshTokenGlobal,
						};
					};

					let identityIndexes = buildIdentityIndexes();

					for (const result of results) {
						const accountId = result.accountIdOverride ?? extractAccountId(result.access);
						const normalizedAccountId = accountId?.trim() || undefined;
						const organizationId = result.organizationIdOverride?.trim() || undefined;
						const accountIdSource =
							normalizedAccountId
								? result.accountIdSource ??
									(result.accountIdOverride ? "manual" : "token")
								: undefined;
						const accountLabel = result.accountLabel;
						const accountEmail = sanitizeEmail(extractAccountEmail(result.access, result.idToken));

						const existingIndex = (() => {
							if (organizationId) {
								return identityIndexes.byOrganizationId.get(organizationId);
							}
							if (normalizedAccountId) {
								const byAccountId = identityIndexes.byAccountIdNoOrg.get(normalizedAccountId);
								if (byAccountId !== undefined) {
									return byAccountId;
								}
							}

							const byRefreshToken = resolveNoOrgRefreshMatch(
								identityIndexes,
								result.refresh,
								normalizedAccountId,
							);
							if (byRefreshToken !== undefined) {
								return byRefreshToken;
							}

						if (accountEmail && !normalizedAccountId) {
							const byEmail = identityIndexes.byEmailNoOrg.get(accountEmail);
							if (byEmail !== undefined) {
								return byEmail;
							}
						}

							const orgScoped = resolveUniqueOrgScopedMatch(
								identityIndexes,
								normalizedAccountId,
								result.refresh,
							);
							if (orgScoped !== undefined) return orgScoped;

						// Absolute last resort: only collapse when refresh token maps to a
						// single compatible account. Avoids merging distinct workspace variants.
						const globalRefreshMatch = asUniqueIndex(
							identityIndexes.byRefreshTokenGlobal.get(result.refresh),
						);
						if (globalRefreshMatch === undefined) {
							return undefined;
						}
						const existing = accounts[globalRefreshMatch];
						if (!canCollapseWithCandidateAccountId(existing, normalizedAccountId)) {
							return undefined;
						}
						return globalRefreshMatch;
					})();

						if (existingIndex === undefined) {
							accounts.push({
								accountId: normalizedAccountId,
								organizationId,
								accountIdSource,
								accountLabel,
								email: accountEmail,
								refreshToken: result.refresh,
								accessToken: result.access,
								expiresAt: result.expires,
								addedAt: now,
								lastUsed: now,
							});
							identityIndexes = buildIdentityIndexes();
							continue;
						}

						const existing = accounts[existingIndex];
						if (!existing) continue;

						const nextEmail = accountEmail ?? existing.email;
						const nextOrganizationId = organizationId ?? existing.organizationId;
						const preserveOrgIdentity =
							typeof existing.organizationId === "string" &&
							existing.organizationId.trim().length > 0 &&
							!organizationId;
						const nextAccountId = preserveOrgIdentity
							? existing.accountId ?? normalizedAccountId
							: normalizedAccountId ?? existing.accountId;
						const nextAccountIdSource = preserveOrgIdentity
							? existing.accountIdSource ?? accountIdSource
							: normalizedAccountId
								? accountIdSource ?? existing.accountIdSource
								: existing.accountIdSource;
						const nextAccountLabel = preserveOrgIdentity
							? existing.accountLabel ?? accountLabel
							: accountLabel ?? existing.accountLabel;
						accounts[existingIndex] = {
							...existing,
							accountId: nextAccountId,
							organizationId: nextOrganizationId,
							accountIdSource: nextAccountIdSource,
							accountLabel: nextAccountLabel,
							email: nextEmail,
							refreshToken: result.refresh,
							accessToken: result.access,
							expiresAt: result.expires,
							lastUsed: now,
						};
						identityIndexes = buildIdentityIndexes();
					}

			const pruneRefreshTokenCollisions = (): void => {
				const indicesToRemove = new Set<number>();
				const refreshMap = new Map<
					string,
					{
						byOrg: Map<string, number>;
						preferredOrgIndex?: number;
						fallbackNoAccountIdIndex?: number;
						fallbackByAccountId: Map<string, number>;
					}
				>();

				const pickPreferredOrgIndex = (
					existingIndex: number | undefined,
					candidateIndex: number,
				): number => {
					if (existingIndex === undefined) return candidateIndex;
					return pickNewestAccountIndex(existingIndex, candidateIndex);
				};

				const collapseFallbackIntoPreferredOrg = (entry: {
					byOrg: Map<string, number>;
					preferredOrgIndex?: number;
					fallbackNoAccountIdIndex?: number;
					fallbackByAccountId: Map<string, number>;
				}): void => {
					if (entry.preferredOrgIndex === undefined) {
						return;
					}

					const preferredOrgIndex = entry.preferredOrgIndex;
					const collapseFallbackIndex = (fallbackIndex: number): boolean => {
						if (preferredOrgIndex === fallbackIndex) return true;
						const target = accounts[preferredOrgIndex];
						const source = accounts[fallbackIndex];
						if (!target || !source) return true;
						const targetAccountId = normalizeStoredAccountId(target);
						const sourceAccountId = normalizeStoredAccountId(source);
						if (!targetAccountId && sourceAccountId) {
							return false;
						}
						if (hasDistinctNonEmptyAccountIds(target, source)) {
							return false;
						}
						mergeAccountRecords(preferredOrgIndex, fallbackIndex);
						indicesToRemove.add(fallbackIndex);
						return true;
					};

					if (typeof entry.fallbackNoAccountIdIndex === "number") {
						if (collapseFallbackIndex(entry.fallbackNoAccountIdIndex)) {
							entry.fallbackNoAccountIdIndex = undefined;
						}
					}

					for (const [accountId, fallbackIndex] of entry.fallbackByAccountId) {
						if (collapseFallbackIndex(fallbackIndex)) {
							entry.fallbackByAccountId.delete(accountId);
						}
					}
				};

				for (let i = 0; i < accounts.length; i += 1) {
					const account = accounts[i];
					if (!account) continue;
					const refreshToken = account.refreshToken?.trim();
					if (!refreshToken) continue;
					const orgKey = account.organizationId?.trim() ?? "";
					let entry = refreshMap.get(refreshToken);
					if (!entry) {
						entry = {
							byOrg: new Map<string, number>(),
							preferredOrgIndex: undefined,
							fallbackNoAccountIdIndex: undefined,
							fallbackByAccountId: new Map<string, number>(),
						};
						refreshMap.set(refreshToken, entry);
					}

					if (orgKey) {
						const existingIndex = entry.byOrg.get(orgKey);
						if (existingIndex !== undefined) {
							const newestIndex = pickNewestAccountIndex(existingIndex, i);
							const obsoleteIndex = newestIndex === existingIndex ? i : existingIndex;
							mergeAccountRecords(newestIndex, obsoleteIndex);
							indicesToRemove.add(obsoleteIndex);
							entry.byOrg.set(orgKey, newestIndex);
							entry.preferredOrgIndex = pickPreferredOrgIndex(entry.preferredOrgIndex, newestIndex);
							collapseFallbackIntoPreferredOrg(entry);
							continue;
						}
						entry.byOrg.set(orgKey, i);
						entry.preferredOrgIndex = pickPreferredOrgIndex(entry.preferredOrgIndex, i);
						collapseFallbackIntoPreferredOrg(entry);
						continue;
					}

					const fallbackAccountId = normalizeStoredAccountId(account);
					if (fallbackAccountId) {
						const existingFallback = entry.fallbackByAccountId.get(fallbackAccountId);
						if (typeof existingFallback === "number") {
							const newestIndex = pickNewestAccountIndex(existingFallback, i);
							const obsoleteIndex = newestIndex === existingFallback ? i : existingFallback;
							mergeAccountRecords(newestIndex, obsoleteIndex);
							indicesToRemove.add(obsoleteIndex);
							entry.fallbackByAccountId.set(fallbackAccountId, newestIndex);
							collapseFallbackIntoPreferredOrg(entry);
							continue;
						}
						entry.fallbackByAccountId.set(fallbackAccountId, i);
						collapseFallbackIntoPreferredOrg(entry);
						continue;
					}

					const existingFallback = entry.fallbackNoAccountIdIndex;
					if (typeof existingFallback === "number") {
						const newestIndex = pickNewestAccountIndex(existingFallback, i);
						const obsoleteIndex = newestIndex === existingFallback ? i : existingFallback;
						mergeAccountRecords(newestIndex, obsoleteIndex);
						indicesToRemove.add(obsoleteIndex);
						entry.fallbackNoAccountIdIndex = newestIndex;
						collapseFallbackIntoPreferredOrg(entry);
						continue;
					}
					entry.fallbackNoAccountIdIndex = i;
					collapseFallbackIntoPreferredOrg(entry);
				}

			if (indicesToRemove.size > 0) {
				accounts = accounts.filter((_, index) => !indicesToRemove.has(index));
			}
		};

			const collectIdentityKeys = (
				account: { organizationId?: string; accountId?: string; refreshToken?: string } | undefined,
			): string[] => {
				const keys: string[] = [];
				const organizationId = account?.organizationId?.trim();
				if (organizationId) keys.push(`org:${organizationId}`);
				const accountId = account?.accountId?.trim();
				if (accountId) keys.push(`account:${accountId}`);
				const refreshToken = account?.refreshToken?.trim();
				if (refreshToken) keys.push(`refresh:${refreshToken}`);
				return keys;
			};

			const getStoredAccountAtIndex = (rawIndex: unknown) => {
				const storedAccounts = stored?.accounts;
				if (!storedAccounts) return undefined;
				if (typeof rawIndex !== "number" || !Number.isFinite(rawIndex)) return undefined;
				const candidate = Math.floor(rawIndex);
				if (candidate < 0 || candidate >= storedAccounts.length) return undefined;
				return storedAccounts[candidate];
			};

			const storedActiveKeys = replaceAll
				? []
				: collectIdentityKeys(getStoredAccountAtIndex(stored?.activeIndex));
			const storedActiveKeysByFamily: Partial<Record<ModelFamily, string[]>> = {};
			if (!replaceAll) {
				for (const family of MODEL_FAMILIES) {
					const familyKeys = collectIdentityKeys(
						getStoredAccountAtIndex(stored?.activeIndexByFamily?.[family]),
					);
					if (familyKeys.length > 0) {
						storedActiveKeysByFamily[family] = familyKeys;
					}
				}
			}

			pruneRefreshTokenCollisions();

			if (accounts.length === 0) return;

			const resolveIndexByIdentityKeys = (identityKeys: string[] | undefined): number | undefined => {
				if (!identityKeys || identityKeys.length === 0) return undefined;
				for (const identityKey of identityKeys) {
					const index = accounts.findIndex(
						(account) => collectIdentityKeys(account).includes(identityKey),
					);
					if (index >= 0) {
						return index;
					}
				}
				return undefined;
			};

			const fallbackActiveIndex = replaceAll
				? 0
				: typeof stored?.activeIndex === "number" && Number.isFinite(stored.activeIndex)
					? stored.activeIndex
					: 0;
			const remappedActiveIndex = replaceAll
				? undefined
				: resolveIndexByIdentityKeys(storedActiveKeys);
			const activeIndex = remappedActiveIndex ?? fallbackActiveIndex;

			const clampedActiveIndex = Math.max(0, Math.min(Math.floor(activeIndex), accounts.length - 1));
			const activeIndexByFamily: Partial<Record<ModelFamily, number>> = {};
			const familiesToPersist = replaceAll
				? []
				: MODEL_FAMILIES.filter((family) => {
					const storedFamilyIndex = stored?.activeIndexByFamily?.[family];
					return typeof storedFamilyIndex === "number" && Number.isFinite(storedFamilyIndex);
				});
			for (const family of familiesToPersist) {
				const storedFamilyIndex = stored?.activeIndexByFamily?.[family];
				const remappedFamilyIndex = replaceAll
					? undefined
					: resolveIndexByIdentityKeys(storedActiveKeysByFamily[family]);
				const rawFamilyIndex = replaceAll
					? 0
					: typeof remappedFamilyIndex === "number"
						? remappedFamilyIndex
						: typeof storedFamilyIndex === "number" && Number.isFinite(storedFamilyIndex)
							? storedFamilyIndex
							: clampedActiveIndex;
				activeIndexByFamily[family] = Math.max(
					0,
					Math.min(Math.floor(rawFamilyIndex), accounts.length - 1),
				);
			}

					await persist({
						version: 3,
						accounts,
						activeIndex: clampedActiveIndex,
						activeIndexByFamily,
					});
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

                const accountsCopy = storage.accounts.map((account) =>
                        account ? { ...account } : account,
                );
                const accountsToHydrate = accountsCopy.filter(
                        (account) => account && !account.email,
                );
                if (accountsToHydrate.length === 0) return storage;

                let changed = false;
                // process in chunks of 3 to avoid auth0 rate limits (429) on startup
                const chunkSize = 3;
                for (let i = 0; i < accountsToHydrate.length; i += chunkSize) {
                        const chunk = accountsToHydrate.slice(i, i + chunkSize);
                        await Promise.all(
                                chunk.map(async (account) => {
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
					if (refreshed.access && refreshed.access !== account.accessToken) {
						account.accessToken = refreshed.access;
						changed = true;
					}
					if (typeof refreshed.expires === "number" && refreshed.expires !== account.expiresAt) {
						account.expiresAt = refreshed.expires;
						changed = true;
					}
                                        if (refreshed.refresh && refreshed.refresh !== account.refreshToken) {
                                                account.refreshToken = refreshed.refresh;
                                                changed = true;
                                        }
				} catch {
					logWarn(`[${PLUGIN_NAME}] Failed to hydrate email for account`);
				}
                        })
                );
                }

                if (changed) {
                        storage.accounts = accountsCopy;
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

		const applyUiRuntimeFromConfig = (
			pluginConfig: ReturnType<typeof loadPluginConfig>,
		): UiRuntimeOptions => {
			return setUiRuntimeOptions({
				v2Enabled: getCodexTuiV2(pluginConfig),
				colorProfile: getCodexTuiColorProfile(pluginConfig),
				glyphMode: getCodexTuiGlyphMode(pluginConfig),
			});
		};

		const resolveUiRuntime = (): UiRuntimeOptions => {
			return applyUiRuntimeFromConfig(loadPluginConfig());
		};

		const getStatusMarker = (
			ui: UiRuntimeOptions,
			status: "ok" | "warning" | "error",
		): string => {
			if (!ui.v2Enabled) {
				if (status === "ok") return "✓";
				if (status === "warning") return "!";
				return "✗";
			}
			if (status === "ok") return ui.theme.glyphs.check;
			if (status === "warning") return "!";
			return ui.theme.glyphs.cross;
		};

		const formatAccountIdForDisplay = (accountId: string | undefined): string | null => {
			const normalized = accountId?.trim();
			if (!normalized) return null;
			if (normalized.length <= 14) return normalized;
			return `${normalized.slice(0, 8)}...${normalized.slice(-6)}`;
		};

		const formatCommandAccountLabel = (
			account: {
				email?: string;
				accountId?: string;
				accountLabel?: string;
				accountTags?: string[];
				accountNote?: string;
			} | undefined,
			index: number,
		): string => {
			const email = account?.email?.trim();
			const workspace = account?.accountLabel?.trim();
			const accountId = formatAccountIdForDisplay(account?.accountId);
			const tags =
				Array.isArray(account?.accountTags)
					? account.accountTags
							.filter((tag): tag is string => typeof tag === "string")
							.map((tag) => tag.trim().toLowerCase())
							.filter((tag) => tag.length > 0)
					: [];
			const details: string[] = [];
			if (email) details.push(email);
			if (workspace) details.push(`workspace:${workspace}`);
			if (accountId) details.push(`id:${accountId}`);
			if (tags.length > 0) details.push(`tags:${tags.join(",")}`);

			if (details.length === 0) {
				return `Account ${index + 1}`;
			}

			return `Account ${index + 1} (${details.join(", ")})`;
		};

		const normalizeAccountTags = (raw: string): string[] => {
			return Array.from(
				new Set(
					raw
						.split(",")
						.map((entry) => entry.trim().toLowerCase())
						.filter((entry) => entry.length > 0),
				),
			);
		};

		const supportsInteractiveMenus = (): boolean => {
			if (!process.stdin.isTTY || !process.stdout.isTTY) return false;
			if (process.env.OPENCODE_TUI === "1") return false;
			if (process.env.OPENCODE_DESKTOP === "1") return false;
			if (process.env.TERM_PROGRAM === "opencode") return false;
			return true;
		};

		const promptAccountIndexSelection = async (
			ui: UiRuntimeOptions,
			storage: AccountStorageV3,
			title: string,
		): Promise<number | null> => {
			if (!supportsInteractiveMenus()) return null;
			try {
				const { select } = await import("./lib/ui/select.js");
				const selected = await select<number>(
					storage.accounts.map((account, index) => ({
						label: formatCommandAccountLabel(account, index),
						value: index,
					})),
					{
						message: title,
						subtitle: "Select account index",
						help: "Up/Down select | Enter confirm | Esc cancel",
						clearScreen: true,
						variant: ui.v2Enabled ? "codex" : "legacy",
						theme: ui.theme,
					},
				);
				return typeof selected === "number" ? selected : null;
			} catch {
				return null;
			}
		};

		const toBeginnerAccountSnapshots = (
			storage: AccountStorageV3,
			activeIndex: number,
			now: number,
		): BeginnerAccountSnapshot[] => {
			return storage.accounts.map((account, index) => ({
				index,
				label: formatCommandAccountLabel(account, index),
				accountLabel: account.accountLabel,
				enabled: account.enabled !== false,
				isActive: index === activeIndex,
				rateLimitedUntil: getRateLimitResetTimeForFamily(account, now, "codex"),
				coolingDownUntil:
					typeof account.coolingDownUntil === "number"
						? account.coolingDownUntil
						: null,
			}));
		};

		const getBeginnerRuntimeSnapshot = (): BeginnerRuntimeSnapshot => ({
			totalRequests: runtimeMetrics.totalRequests,
			failedRequests: runtimeMetrics.failedRequests,
			rateLimitedResponses: runtimeMetrics.rateLimitedResponses,
			authRefreshFailures: runtimeMetrics.authRefreshFailures,
			serverErrors: runtimeMetrics.serverErrors,
			networkErrors: runtimeMetrics.networkErrors,
			lastErrorCategory: runtimeMetrics.lastErrorCategory,
		});

		const formatDoctorSeverity = (
			ui: UiRuntimeOptions,
			severity: BeginnerDiagnosticSeverity,
		): string => {
			if (severity === "ok") return formatUiBadge(ui, "ok", "success");
			if (severity === "warning") return formatUiBadge(ui, "warning", "warning");
			return formatUiBadge(ui, "error", "danger");
		};

		const formatDoctorSeverityText = (
			severity: BeginnerDiagnosticSeverity,
		): string => {
			if (severity === "ok") return "[ok]";
			if (severity === "warning") return "[warning]";
			return "[error]";
		};

		type SetupWizardChoice =
			| "checklist"
			| "next"
			| "add-account"
			| "health"
			| "switch"
			| "label"
			| "doctor"
			| "dashboard"
			| "metrics"
			| "backup"
			| "safe-mode"
			| "help"
			| "exit";

		const buildSetupChecklistState = async () => {
			const storage = await loadAccounts();
			const now = Date.now();
			const activeIndex =
				storage && storage.accounts.length > 0
					? resolveActiveIndex(storage, "codex")
					: 0;
			const snapshots = storage
				? toBeginnerAccountSnapshots(storage, activeIndex, now)
				: [];
			const runtime = getBeginnerRuntimeSnapshot();
			const checklist = buildBeginnerChecklist(snapshots, now);
			const summary = summarizeBeginnerAccounts(snapshots, now);
			const nextAction = recommendBeginnerNextAction({
				accounts: snapshots,
				now,
				runtime,
			});

			return {
				now,
				storage,
				activeIndex,
				snapshots,
				runtime,
				checklist,
				summary,
				nextAction,
			};
		};

		const renderSetupChecklistOutput = (
			ui: UiRuntimeOptions,
			state: Awaited<ReturnType<typeof buildSetupChecklistState>>,
		): string => {
			if (ui.v2Enabled) {
				const lines: string[] = [
					...formatUiHeader(ui, "Setup checklist"),
					formatUiKeyValue(ui, "Accounts", String(state.summary.total)),
					formatUiKeyValue(
						ui,
						"Healthy",
						String(state.summary.healthy),
						state.summary.healthy > 0 ? "success" : "warning",
					),
					formatUiKeyValue(
						ui,
						"Blocked",
						String(state.summary.blocked),
						state.summary.blocked > 0 ? "warning" : "muted",
					),
					"",
				];
				for (const item of state.checklist) {
					const marker = item.done
						? getStatusMarker(ui, "ok")
						: getStatusMarker(ui, "warning");
					lines.push(
						formatUiItem(
							ui,
							`${marker} ${item.label} - ${item.detail}`,
							item.done ? "success" : "warning",
						),
					);
					if (item.command) {
						lines.push(`  ${formatUiKeyValue(ui, "command", item.command, "muted")}`);
					}
				}
				lines.push("");
				lines.push(...formatUiSection(ui, "Recommended next step"));
				lines.push(formatUiItem(ui, state.nextAction, "accent"));
				lines.push(formatUiItem(ui, "Guided wizard: codex-setup --wizard", "muted"));
				return lines.join("\n");
			}

			const lines: string[] = [
				"Setup Checklist:",
				`Accounts: ${state.summary.total}`,
				`Healthy accounts: ${state.summary.healthy}`,
				`Blocked accounts: ${state.summary.blocked}`,
				"",
			];
			for (const item of state.checklist) {
				const marker = item.done ? "[x]" : "[ ]";
				lines.push(`${marker} ${item.label} - ${item.detail}`);
				if (item.command) lines.push(`    command: ${item.command}`);
			}
			lines.push("");
			lines.push(`Recommended next step: ${state.nextAction}`);
			lines.push("Guided wizard: codex-setup --wizard");
			return lines.join("\n");
		};

		const runSetupWizard = async (
			ui: UiRuntimeOptions,
			state: Awaited<ReturnType<typeof buildSetupChecklistState>>,
		): Promise<string> => {
			if (!supportsInteractiveMenus()) {
				return [
					ui.v2Enabled
						? formatUiItem(
								ui,
								"Interactive wizard mode is unavailable in this session.",
								"warning",
						  )
						: "Interactive wizard mode is unavailable in this session.",
					ui.v2Enabled
						? formatUiItem(ui, "Showing checklist view instead.", "muted")
						: "Showing checklist view instead.",
					"",
					renderSetupChecklistOutput(ui, state),
				].join("\n");
			}

			try {
				const { select } = await import("./lib/ui/select.js");
				const labels: Record<Exclude<SetupWizardChoice, "exit">, string> = {
					checklist: "Show setup checklist",
					next: "Show best next action",
					"add-account": "Add account now",
					health: "Run health check",
					switch: "Switch active account",
					label: "Set account label",
					doctor: "Run doctor diagnostics",
					dashboard: "Open live dashboard",
					metrics: "Open runtime metrics",
					backup: "Backup accounts",
					"safe-mode": "Enable beginner safe mode",
					help: "Open command help",
				};
				const commandMap: Record<Exclude<SetupWizardChoice, "checklist" | "next" | "exit">, string> = {
					"add-account": "opencode auth login",
					health: "codex-health",
					switch: "codex-switch index=2",
					label: "codex-label index=2 label=\"Work\"",
					doctor: "codex-doctor",
					dashboard: "codex-dashboard",
					metrics: "codex-metrics",
					backup: "codex-export <path>",
					"safe-mode": "set CODEX_AUTH_BEGINNER_SAFE_MODE=1",
					help: "codex-help",
				};

				const choice = await select<SetupWizardChoice>(
					[
						{ label: "Setup wizard", value: "exit", kind: "heading" },
						{ label: labels.checklist, value: "checklist", color: "cyan" },
						{ label: labels.next, value: "next", color: "green" },
						{ label: labels["add-account"], value: "add-account", color: "cyan" },
						{ label: labels.health, value: "health", color: "cyan" },
						{ label: labels.switch, value: "switch", color: "cyan" },
						{ label: labels.label, value: "label", color: "cyan" },
						{ label: labels.doctor, value: "doctor", color: "yellow" },
						{ label: labels.dashboard, value: "dashboard", color: "cyan" },
						{ label: labels.metrics, value: "metrics", color: "cyan" },
						{ label: labels.backup, value: "backup", color: "yellow" },
						{ label: labels["safe-mode"], value: "safe-mode", color: "yellow" },
						{ label: labels.help, value: "help", color: "cyan" },
						{ label: "", value: "exit", separator: true },
						{ label: "Exit wizard", value: "exit", color: "red" },
					],
					{
						message: "Beginner setup wizard",
						subtitle: `Accounts: ${state.summary.total} | Healthy: ${state.summary.healthy} | Blocked: ${state.summary.blocked}`,
						help: "Up/Down select | Enter confirm | Esc exit",
						clearScreen: true,
						variant: ui.v2Enabled ? "codex" : "legacy",
						theme: ui.theme,
					},
				);

				if (!choice || choice === "exit") {
					return ui.v2Enabled
						? [
								...formatUiHeader(ui, "Setup wizard"),
								"",
								formatUiItem(ui, "Wizard closed.", "muted"),
								formatUiItem(ui, `Next: ${state.nextAction}`, "accent"),
						  ].join("\n")
						: `Setup wizard closed.\n\nNext: ${state.nextAction}`;
				}

				if (choice === "checklist") {
					return renderSetupChecklistOutput(ui, state);
				}
				if (choice === "next") {
					return ui.v2Enabled
						? [
								...formatUiHeader(ui, "Setup wizard"),
								"",
								formatUiItem(ui, "Best next action", "accent"),
								formatUiItem(ui, state.nextAction, "success"),
						  ].join("\n")
						: `Best next action:\n${state.nextAction}`;
				}

				const command = commandMap[choice];
				const selectedLabel = labels[choice];
				if (ui.v2Enabled) {
					return [
						...formatUiHeader(ui, "Setup wizard"),
						"",
						formatUiItem(ui, `Selected: ${selectedLabel}`, "accent"),
						formatUiItem(ui, `Run: ${command}`, "success"),
						formatUiItem(ui, "Run codex-setup --wizard again to choose another step.", "muted"),
					].join("\n");
				}
				return [
					"Setup wizard:",
					`Selected: ${selectedLabel}`,
					`Run: ${command}`,
					"",
					"Run codex-setup --wizard again to choose another step.",
				].join("\n");
			} catch (error) {
				const reason = error instanceof Error ? error.message : String(error);
				return [
					ui.v2Enabled
						? formatUiItem(ui, `Wizard failed to open: ${reason}`, "warning")
						: `Wizard failed to open: ${reason}`,
					ui.v2Enabled
						? formatUiItem(ui, "Showing checklist view instead.", "muted")
						: "Showing checklist view instead.",
					"",
					renderSetupChecklistOutput(ui, state),
				].join("\n");
			}
		};

		const runStartupPreflight = async (): Promise<void> => {
			if (startupPreflightShown) return;
			startupPreflightShown = true;
			try {
				const state = await buildSetupChecklistState();
				const message =
					`Codex preflight: healthy ${state.summary.healthy}/${state.summary.total}, ` +
					`blocked ${state.summary.blocked}, rate-limited ${state.summary.rateLimited}. ` +
					`Next: ${state.nextAction}`;
				await showToast(message, state.summary.healthy > 0 ? "info" : "warning");
				logInfo(message);
			} catch (error) {
				logDebug(
					`[${PLUGIN_NAME}] Startup preflight skipped: ${
						error instanceof Error ? error.message : String(error)
					}`,
				);
			}
		};

		const invalidateAccountManagerCache = (): void => {
			cachedAccountManager = null;
			accountManagerPromise = null;
		};

        // Event handler for session recovery and account selection
        const eventHandler = async (input: { event: { type: string; properties?: unknown } }) => {
          try {
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
                        if (typeof index === "number") {
                                const storage = await loadAccounts();
                                if (!storage || index < 0 || index >= storage.accounts.length) {
                                        return;
                                }

                                const now = Date.now();
                                const account = storage.accounts[index];
                                if (account) {
                                        account.lastUsed = now;
                                        account.lastSwitchReason = "rotation";
                                }
                                storage.activeIndex = index;
                                storage.activeIndexByFamily = storage.activeIndexByFamily ?? {};
                                for (const family of MODEL_FAMILIES) {
                                        storage.activeIndexByFamily[family] = index;
                                }

                                await saveAccounts(storage);

                                // Reload manager from disk so we don't overwrite newer rotated
                                // refresh tokens with stale in-memory state.
                                if (cachedAccountManager) {
                                        const reloadedManager = await AccountManager.loadFromDisk();
                                        cachedAccountManager = reloadedManager;
                                        accountManagerPromise = Promise.resolve(reloadedManager);
                                }

                                await showToast(`Switched to account ${index + 1}`, "info");
                        }
                }
          } catch (error) {
                logDebug(`[${PLUGIN_NAME}] Event handler error: ${error instanceof Error ? error.message : String(error)}`);
          }
        };

		// Initialize runtime UI settings once on plugin load; auth/tools refresh this dynamically.
		resolveUiRuntime();

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
				const pluginConfig = loadPluginConfig();
				applyUiRuntimeFromConfig(pluginConfig);
				const perProjectAccounts = getPerProjectAccounts(pluginConfig);
				setStoragePath(perProjectAccounts ? process.cwd() : null);
				const authFallback = auth.type === "oauth" ? (auth as OAuthAuthDetails) : undefined;

				// Prefer multi-account auth metadata when available, but still handle
				// plain OAuth credentials (for OpenCode versions that inject internal
				// Codex auth first and omit the multiAccount marker).
				const authWithMulti = authFallback as (OAuthAuthDetails & { multiAccount?: boolean }) | undefined;
				if (authWithMulti && !authWithMulti.multiAccount) {
					logDebug(
						`[${PLUGIN_NAME}] Auth is missing multiAccount marker; continuing with single-account compatibility mode`,
					);
				}
				if (!authFallback) {
					logDebug(
						`[${PLUGIN_NAME}] Host auth is ${auth.type}; attempting stored Codex account compatibility mode`,
					);
				}

				// Acquire mutex for thread-safe initialization
				// Use while loop to handle multiple concurrent waiters correctly
				while (loaderMutex) {
					await loaderMutex;
				}

				let resolveMutex: (() => void) | undefined;
				loaderMutex = new Promise<void>((resolve) => {
					resolveMutex = resolve;
				});
				try {
					if (!accountManagerPromise) {
						accountManagerPromise = AccountManager.loadFromDisk(authFallback);
					}
					let accountManager = await accountManagerPromise;
					cachedAccountManager = accountManager;
					const refreshToken = authFallback?.refresh ?? "";
					const needsPersist =
						refreshToken &&
						!accountManager.hasRefreshToken(refreshToken);
					if (needsPersist) {
						await accountManager.saveToDisk();
					}

					if (accountManager.getAccountCount() === 0) {
						logDebug(
							`[${PLUGIN_NAME}] No Codex accounts available (run opencode auth login)`,
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
				const codexMode = getCodexMode(pluginConfig);
				const requestTransformMode = getRequestTransformMode(pluginConfig);
				const useLegacyRequestTransform = requestTransformMode === "legacy";
				const fastSessionEnabled = getFastSession(pluginConfig);
				const fastSessionStrategy = getFastSessionStrategy(pluginConfig);
				const fastSessionMaxInputItems = getFastSessionMaxInputItems(pluginConfig);
				const beginnerSafeMode = getBeginnerSafeMode(pluginConfig);
				beginnerSafeModeEnabled = beginnerSafeMode;
				const retryProfile = beginnerSafeMode
					? "conservative"
					: getRetryProfile(pluginConfig);
				const retryBudgetOverrides = beginnerSafeMode
					? {}
					: getRetryBudgetOverrides(pluginConfig);
				const retryBudgetLimits = resolveRetryBudgetLimits(
					retryProfile,
					retryBudgetOverrides,
				);
				runtimeMetrics.retryProfile = retryProfile;
				runtimeMetrics.retryBudgetLimits = { ...retryBudgetLimits };
				const tokenRefreshSkewMs = getTokenRefreshSkewMs(pluginConfig);
				const rateLimitToastDebounceMs = getRateLimitToastDebounceMs(pluginConfig);
				const retryAllAccountsRateLimited = beginnerSafeMode
					? false
					: getRetryAllAccountsRateLimited(pluginConfig);
				const retryAllAccountsMaxWaitMs = getRetryAllAccountsMaxWaitMs(pluginConfig);
				const retryAllAccountsMaxRetries = beginnerSafeMode
					? Math.min(1, getRetryAllAccountsMaxRetries(pluginConfig))
					: getRetryAllAccountsMaxRetries(pluginConfig);
				const unsupportedCodexPolicy = getUnsupportedCodexPolicy(pluginConfig);
				const fallbackOnUnsupportedCodexModel = unsupportedCodexPolicy === "fallback";
				const fallbackToGpt52OnUnsupportedGpt53 =
					getFallbackToGpt52OnUnsupportedGpt53(pluginConfig);
				const unsupportedCodexFallbackChain =
					getUnsupportedCodexFallbackChain(pluginConfig);
				const toastDurationMs = getToastDurationMs(pluginConfig);
				const fetchTimeoutMs = getFetchTimeoutMs(pluginConfig);
				const streamStallTimeoutMs = getStreamStallTimeoutMs(pluginConfig);

				const sessionRecoveryEnabled = getSessionRecovery(pluginConfig);
				const autoResumeEnabled = getAutoResume(pluginConfig);
				const emptyResponseMaxRetries = getEmptyResponseMaxRetries(pluginConfig);
				const emptyResponseRetryDelayMs = getEmptyResponseRetryDelayMs(pluginConfig);
				const pidOffsetEnabled = getPidOffsetEnabled(pluginConfig);
				const effectiveUserConfig = fastSessionEnabled
					? applyFastSessionDefaults(userConfig)
					: userConfig;
				if (fastSessionEnabled) {
					logDebug("Fast session mode enabled", {
						reasoningEffort: "none/low",
						reasoningSummary: "auto",
						textVerbosity: "low",
						fastSessionStrategy,
						fastSessionMaxInputItems,
					});
				}
				if (beginnerSafeMode) {
					logInfo("Beginner safe mode enabled", {
						retryProfile,
						retryAllAccountsRateLimited,
						retryAllAccountsMaxRetries,
					});
				}

				const prewarmEnabled =
					process.env.CODEX_AUTH_PREWARM !== "0" &&
					process.env.VITEST !== "true" &&
					process.env.NODE_ENV !== "test";

				if (!startupPrewarmTriggered && prewarmEnabled && useLegacyRequestTransform) {
					startupPrewarmTriggered = true;
					const configuredModels = Object.keys(userConfig.models ?? {});
					prewarmCodexInstructions(configuredModels);
					if (codexMode) {
						prewarmOpenCodeCodexPrompt();
					}
				}

				const recoveryHook = sessionRecoveryEnabled
					? createSessionRecoveryHook(
							{ client, directory: process.cwd() },
							{ sessionRecovery: true, autoResume: autoResumeEnabled }
						)
					: null;

			checkAndNotify(async (message, variant) => {
				await showToast(message, variant);
			}).catch((err) => {
				logDebug(`Update check failed: ${err instanceof Error ? err.message : String(err)}`);
			});
			await runStartupPreflight();


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
						try {
							if (cachedAccountManager && cachedAccountManager !== accountManager) {
								accountManager = cachedAccountManager;
							}

                                                // Step 1: Extract and rewrite URL for Codex backend
                                                const originalUrl = extractRequestUrl(input);
                                                const url = rewriteUrlForCodex(originalUrl);

							// Step 3: Transform request body with model-specific Codex instructions
							// Instructions are fetched per model family (codex-max, codex, gpt-5.1)
							// Capture original stream value before transformation
							// generateText() sends no stream field, streamText() sends stream=true
								const normalizeRequestInit = async (
									requestInput: Request | string | URL,
									requestInit: RequestInit | undefined,
								): Promise<RequestInit | undefined> => {
									if (requestInit) return requestInit;
									if (!(requestInput instanceof Request)) return requestInit;

									const method = requestInput.method || "GET";
									const normalized: RequestInit = {
										method,
										headers: new Headers(requestInput.headers),
									};

									if (method !== "GET" && method !== "HEAD") {
										try {
											const bodyText = await requestInput.clone().text();
											if (bodyText) {
												normalized.body = bodyText;
											}
										} catch {
											// Body may be unreadable; proceed without it.
										}
									}

									return normalized;
								};

								const parseRequestBodyFromInit = async (
									body: unknown,
								): Promise<Record<string, unknown>> => {
									if (!body) return {};

									try {
										if (typeof body === "string") {
											return JSON.parse(body) as Record<string, unknown>;
										}

										if (body instanceof Uint8Array) {
											return JSON.parse(new TextDecoder().decode(body)) as Record<string, unknown>;
										}

										if (body instanceof ArrayBuffer) {
											return JSON.parse(new TextDecoder().decode(new Uint8Array(body))) as Record<string, unknown>;
										}

										if (ArrayBuffer.isView(body)) {
											const view = new Uint8Array(
												body.buffer,
												body.byteOffset,
												body.byteLength,
											);
											return JSON.parse(new TextDecoder().decode(view)) as Record<string, unknown>;
										}

										if (typeof Blob !== "undefined" && body instanceof Blob) {
											return JSON.parse(await body.text()) as Record<string, unknown>;
										}
									} catch {
										logWarn("Failed to parse request body, using empty object");
									}

									return {};
								};

								const baseInit = await normalizeRequestInit(input, init);
								const originalBody = await parseRequestBodyFromInit(baseInit?.body);
								const isStreaming = originalBody.stream === true;
								const parsedBody =
									Object.keys(originalBody).length > 0 ? originalBody : undefined;

								const transformation = await transformRequestForCodex(
									baseInit,
									url,
									effectiveUserConfig,
									codexMode,
									parsedBody,
									{
									fastSession: fastSessionEnabled,
									fastSessionStrategy,
									fastSessionMaxInputItems,
									requestTransformMode,
								},
							);
										let requestInit = transformation?.updatedInit ?? baseInit;
										let transformedBody: RequestBody | undefined = transformation?.body;
										const promptCacheKey = transformedBody?.prompt_cache_key;
										let model = transformedBody?.model;
										let modelFamily = model ? getModelFamily(model) : "gpt-5.1";
										let quotaKey = model ? `${modelFamily}:${model}` : modelFamily;
						const threadIdCandidate =
							(process.env.CODEX_THREAD_ID ?? promptCacheKey ?? "")
								.toString()
								.trim() || undefined;
							const requestCorrelationId = setCorrelationId(
								threadIdCandidate ? `${threadIdCandidate}:${Date.now()}` : undefined,
							);
							runtimeMetrics.lastRequestAt = Date.now();
							const retryBudget = new RetryBudgetTracker(retryBudgetLimits);
							const consumeRetryBudget = (
								bucket: RetryBudgetClass,
								reason: string,
							): boolean => {
								if (retryBudget.consume(bucket)) {
									runtimeMetrics.retryBudgetUsage[bucket] += 1;
									return true;
								}
								runtimeMetrics.retryBudgetExhaustions += 1;
								runtimeMetrics.lastRetryBudgetExhaustedClass = bucket;
								runtimeMetrics.lastRetryBudgetReason = reason;
								runtimeMetrics.lastErrorCategory = "retry-budget";
								runtimeMetrics.lastError = `Retry budget exhausted (${bucket}): ${reason}`;
								logWarn(`Retry budget exhausted for ${bucket}`, {
									reason,
									profile: retryProfile,
									limits: retryBudget.getLimits(),
									usage: retryBudget.getUsage(),
								});
								return false;
							};

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
							let emptyResponseRetries = 0;
							const attemptedUnsupportedFallbackModels = new Set<string>();
							if (model) {
								attemptedUnsupportedFallbackModels.add(model);
							}

							while (true) {
										const accountCount = accountManager.getAccountCount();
										const attempted = new Set<number>();
										let restartAccountTraversalWithFallback = false;

while (attempted.size < Math.max(1, accountCount)) {
				const selectionExplainability = accountManager.getSelectionExplainability(
					modelFamily,
					model,
					Date.now(),
				);
				runtimeMetrics.lastSelectionSnapshot = {
					timestamp: Date.now(),
					family: modelFamily,
					model: model ?? null,
					selectedAccountIndex: null,
					quotaKey,
					explainability: selectionExplainability,
				};
				const account = accountManager.getCurrentOrNextForFamilyHybrid(modelFamily, model, { pidOffsetEnabled });
				if (!account || attempted.has(account.index)) {
					break;
				}
							attempted.add(account.index);
							runtimeMetrics.lastSelectedAccountIndex = account.index;
							runtimeMetrics.lastQuotaKey = quotaKey;
							if (runtimeMetrics.lastSelectionSnapshot) {
								runtimeMetrics.lastSelectionSnapshot = {
									...runtimeMetrics.lastSelectionSnapshot,
									selectedAccountIndex: account.index,
								};
							}
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
				if (
					!consumeRetryBudget(
						"authRefresh",
						`Auth refresh failed for account ${account.index + 1}`,
					)
				) {
					return new Response(
						JSON.stringify({
							error: {
								message:
									"Auth refresh retry budget exhausted for this request. Try again or switch accounts.",
							},
						}),
						{
							status: 503,
							headers: {
								"content-type": "application/json; charset=utf-8",
							},
						},
					);
				}
				runtimeMetrics.authRefreshFailures++;
				runtimeMetrics.failedRequests++;
				runtimeMetrics.accountRotations++;
				runtimeMetrics.lastError = (err as Error)?.message ?? String(err);
				runtimeMetrics.lastErrorCategory = "auth-refresh";
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
					const tokenAccountId = extractAccountId(accountAuth.access);
					const accountId = resolveRequestAccountId(
						account.accountId,
						account.accountIdSource,
						tokenAccountId,
					);
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
											if (!hadAccountId && tokenAccountId && accountId === tokenAccountId) {
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

								// Consume a token before making the request for proactive rate limiting
								const tokenConsumed = accountManager.consumeToken(account, modelFamily, model);
								if (!tokenConsumed) {
									accountManager.recordRateLimit(account, modelFamily, model);
									runtimeMetrics.accountRotations++;
									runtimeMetrics.lastError =
										`Local token bucket depleted for account ${account.index + 1} (${modelFamily}${model ? `:${model}` : ""})`;
									runtimeMetrics.lastErrorCategory = "rate-limit-local";
									logWarn(
										`Skipping account ${account.index + 1}: local token bucket depleted for ${modelFamily}${model ? `:${model}` : ""}`,
									);
									break;
								}

							while (true) {
								let response: Response;
								const fetchStart = performance.now();

								// Merge user AbortSignal with timeout (Node 18 compatible - no AbortSignal.any)
								const fetchController = new AbortController();
								const requestTimeoutMs = fetchTimeoutMs;
								const fetchTimeoutId = setTimeout(
									() => fetchController.abort(new Error("Request timeout")),
									requestTimeoutMs,
								);

								const onUserAbort = abortSignal
									? () => fetchController.abort(abortSignal.reason ?? new Error("Aborted by user"))
									: null;

								if (abortSignal?.aborted) {
									clearTimeout(fetchTimeoutId);
									fetchController.abort(abortSignal.reason ?? new Error("Aborted by user"));
								} else if (abortSignal && onUserAbort) {
									abortSignal.addEventListener("abort", onUserAbort, { once: true });
								}

								try {
								runtimeMetrics.totalRequests++;
								response = await fetch(url, {
									...requestInit,
									headers,
									signal: fetchController.signal,
								});
				} catch (networkError) {
								const errorMsg = networkError instanceof Error ? networkError.message : String(networkError);
								logWarn(`Network error for account ${account.index + 1}: ${errorMsg}`);
								if (
									!consumeRetryBudget(
										"network",
										`Network error on account ${account.index + 1}: ${errorMsg}`,
									)
								) {
									accountManager.refundToken(account, modelFamily, model);
									return new Response(
										JSON.stringify({
											error: {
												message:
													"Network retry budget exhausted for this request. Try again in a moment.",
											},
										}),
										{
											status: 503,
											headers: {
												"content-type": "application/json; charset=utf-8",
											},
										},
									);
								}
								runtimeMetrics.failedRequests++;
								runtimeMetrics.networkErrors++;
								runtimeMetrics.accountRotations++;
								runtimeMetrics.lastError = errorMsg;
								runtimeMetrics.lastErrorCategory = "network";
								accountManager.refundToken(account, modelFamily, model);
								accountManager.recordFailure(account, modelFamily, model);
								break;
								} finally {
									clearTimeout(fetchTimeoutId);
									if (abortSignal && onUserAbort) {
										abortSignal.removeEventListener("abort", onUserAbort);
									}
								}
											const fetchLatencyMs = Math.round(performance.now() - fetchStart);

											logRequest(LOG_STAGES.RESPONSE, {
												status: response.status,
												ok: response.ok,
												statusText: response.statusText,
												latencyMs: fetchLatencyMs,
												headers: Object.fromEntries(response.headers.entries()),
											});

								if (!response.ok) {
									const contextOverflowResult = await handleContextOverflow(response, model);
									if (contextOverflowResult.handled) {
										return contextOverflowResult.response;
									}

									const { response: errorResponse, rateLimit, errorBody } =
										await handleErrorResponse(response, {
											requestCorrelationId,
											threadId: threadIdCandidate,
										});

			const unsupportedModelInfo = getUnsupportedCodexModelInfo(errorBody);
			const hasRemainingAccounts = attempted.size < Math.max(1, accountCount);

			// Entitlements can differ by account/workspace, so try remaining
			// accounts before degrading the model via fallback.
			if (unsupportedModelInfo.isUnsupported && hasRemainingAccounts) {
				const blockedModel =
					unsupportedModelInfo.unsupportedModel ?? model ?? "requested model";
				accountManager.refundToken(account, modelFamily, model);
				accountManager.recordFailure(account, modelFamily, model);
				account.lastSwitchReason = "rotation";
				runtimeMetrics.lastError = `Unsupported model on account ${account.index + 1}: ${blockedModel}`;
				runtimeMetrics.lastErrorCategory = "unsupported-model";
				logWarn(
					`Model ${blockedModel} is unsupported for account ${account.index + 1}. Trying next account/workspace before fallback.`,
					{
						unsupportedCodexPolicy,
						requestedModel: blockedModel,
						effectiveModel: blockedModel,
						fallbackApplied: false,
						fallbackReason: "unsupported-model-entitlement",
					},
				);
				break;
			}

			const fallbackModel = resolveUnsupportedCodexFallbackModel({
				requestedModel: model,
				errorBody,
				attemptedModels: attemptedUnsupportedFallbackModels,
				fallbackOnUnsupportedCodexModel,
				fallbackToGpt52OnUnsupportedGpt53,
				customChain: unsupportedCodexFallbackChain,
			});

			if (fallbackModel) {
				const previousModel = model ?? "gpt-5-codex";
				const previousModelFamily = modelFamily;
				attemptedUnsupportedFallbackModels.add(previousModel);
				attemptedUnsupportedFallbackModels.add(fallbackModel);
				accountManager.refundToken(account, previousModelFamily, previousModel);

				model = fallbackModel;
				modelFamily = getModelFamily(model);
				quotaKey = `${modelFamily}:${model}`;

				if (transformedBody && typeof transformedBody === "object") {
					transformedBody = { ...transformedBody, model };
				} else {
					let fallbackBody: Record<string, unknown> = { model };
					if (requestInit?.body && typeof requestInit.body === "string") {
						try {
							const parsed = JSON.parse(requestInit.body) as Record<string, unknown>;
							fallbackBody = { ...parsed, model };
						} catch {
							// Keep minimal fallback body if parsing fails.
						}
					}
					transformedBody = fallbackBody as RequestBody;
				}

				requestInit = {
					...(requestInit ?? {}),
					body: JSON.stringify(transformedBody),
				};
				runtimeMetrics.lastError = `Model fallback: ${previousModel} -> ${model}`;
				runtimeMetrics.lastErrorCategory = "model-fallback";
				logWarn(
					`Model ${previousModel} is unsupported for this ChatGPT account. Falling back to ${model}.`,
					{
						unsupportedCodexPolicy,
						requestedModel: previousModel,
						effectiveModel: model,
						fallbackApplied: true,
						fallbackReason: "unsupported-model-entitlement",
					},
				);
				await showToast(
					`Model ${previousModel} is not available for this account. Retrying with ${model}.`,
					"warning",
					{ duration: toastDurationMs },
				);
				restartAccountTraversalWithFallback = true;
				break;
			}

			if (unsupportedModelInfo.isUnsupported && !fallbackOnUnsupportedCodexModel) {
				const blockedModel =
					unsupportedModelInfo.unsupportedModel ?? model ?? "requested model";
				runtimeMetrics.lastError = `Unsupported model (strict): ${blockedModel}`;
				runtimeMetrics.lastErrorCategory = "unsupported-model";
				logWarn(
					`Model ${blockedModel} is unsupported for this ChatGPT account. Strict policy blocks automatic fallback.`,
					{
						unsupportedCodexPolicy,
						requestedModel: blockedModel,
						effectiveModel: blockedModel,
						fallbackApplied: false,
						fallbackReason: "unsupported-model-entitlement",
					},
				);
				await showToast(
					`Model ${blockedModel} is not available for this account. Strict policy blocked automatic fallback.`,
					"warning",
					{ duration: toastDurationMs },
				);
			}

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

					// Handle 5xx server errors by rotating to another account
					if (response.status >= 500 && response.status < 600) {
						logWarn(`Server error ${response.status} for account ${account.index + 1}. Rotating to next account.`);
						runtimeMetrics.failedRequests++;
						runtimeMetrics.serverErrors++;
						runtimeMetrics.accountRotations++;
						runtimeMetrics.lastError = `HTTP ${response.status}`;
						runtimeMetrics.lastErrorCategory = "server";
						accountManager.refundToken(account, modelFamily, model);
						accountManager.recordFailure(account, modelFamily, model);
						if (
							!consumeRetryBudget(
								"server",
								`Server error ${response.status} on account ${account.index + 1}`,
							)
						) {
							return errorResponse;
						}
						break;
					}

					if (rateLimit) {
																														runtimeMetrics.rateLimitedResponses++;
																														const { attempt, delayMs } = getRateLimitBackoff(
																															account.index,
																															quotaKey,
																															rateLimit.retryAfterMs,
																														);
																														const waitLabel = formatWaitTime(delayMs);

																														if (
																															delayMs <= RATE_LIMIT_SHORT_RETRY_THRESHOLD_MS &&
																															consumeRetryBudget(
																																"rateLimitShort",
																																`Short 429 retry for account ${account.index + 1} after ${delayMs}ms`,
																															)
																														) {
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

															await sleep(addJitter(Math.max(MIN_BACKOFF_MS, delayMs), 0.2));
															continue;
																																}

				accountManager.markRateLimitedWithReason(
					account,
					delayMs,
					modelFamily,
					parseRateLimitReason(rateLimit.code),
					model,
				);
				accountManager.recordRateLimit(account, modelFamily, model);
				account.lastSwitchReason = "rate-limit";
				runtimeMetrics.accountRotations++;
				runtimeMetrics.lastErrorCategory = "rate-limit";
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
																													runtimeMetrics.failedRequests++;
																													runtimeMetrics.lastError = `HTTP ${response.status}`;
																													runtimeMetrics.lastErrorCategory = "http";
																													return errorResponse;
																											}

					resetRateLimitBackoff(account.index, quotaKey);
					runtimeMetrics.cumulativeLatencyMs += fetchLatencyMs;
					const successResponse = await handleSuccessResponse(response, isStreaming, {
						streamStallTimeoutMs,
					});

					if (!successResponse.ok) {
						runtimeMetrics.failedRequests++;
						runtimeMetrics.lastError = `HTTP ${successResponse.status}`;
						runtimeMetrics.lastErrorCategory = "http";
						return successResponse;
					}

					if (!isStreaming && emptyResponseMaxRetries > 0) {
						const clonedResponse = successResponse.clone();
						try {
							const bodyText = await clonedResponse.text();
							const parsedBody = bodyText ? JSON.parse(bodyText) as unknown : null;
							if (isEmptyResponse(parsedBody)) {
								if (
									emptyResponseRetries < emptyResponseMaxRetries &&
									consumeRetryBudget(
										"emptyResponse",
										`Empty response retry ${emptyResponseRetries + 1}/${emptyResponseMaxRetries}`,
									)
								) {
									emptyResponseRetries++;
									runtimeMetrics.emptyResponseRetries++;
									logWarn(`Empty response received (attempt ${emptyResponseRetries}/${emptyResponseMaxRetries}). Retrying...`);
									await showToast(
										`Empty response. Retrying (${emptyResponseRetries}/${emptyResponseMaxRetries})...`,
										"warning",
										{ duration: toastDurationMs },
									);
									accountManager.refundToken(account, modelFamily, model);
									accountManager.recordFailure(account, modelFamily, model);
									await sleep(addJitter(emptyResponseRetryDelayMs, 0.2));
									break;
								}
								logWarn(`Empty response after ${emptyResponseMaxRetries} retries. Returning as-is.`);
							}
						} catch {
							// Intentionally empty: non-JSON response bodies should be returned as-is
						}
					}

					accountManager.recordSuccess(account, modelFamily, model);
					runtimeMetrics.successfulRequests++;
					runtimeMetrics.lastError = null;
					runtimeMetrics.lastErrorCategory = null;
						return successResponse;
																								}
										if (restartAccountTraversalWithFallback) {
											break;
										}
										}

										if (restartAccountTraversalWithFallback) {
											continue;
										}

										const waitMs = accountManager.getMinWaitTimeForFamily(modelFamily, model);
										const count = accountManager.getAccountCount();

								if (
									retryAllAccountsRateLimited &&
									count > 0 &&
									waitMs > 0 &&
									(retryAllAccountsMaxWaitMs === 0 ||
										waitMs <= retryAllAccountsMaxWaitMs) &&
									allRateLimitedRetries < retryAllAccountsMaxRetries &&
									consumeRetryBudget(
										"rateLimitGlobal",
										`All accounts rate-limited wait ${waitMs}ms`,
									)
								) {
									const countdownMessage = `All ${count} account(s) rate-limited. Waiting`;
									await sleepWithCountdown(addJitter(waitMs, 0.2), countdownMessage);
									allRateLimitedRetries++;
									continue;
								}

								const waitLabel = waitMs > 0 ? formatWaitTime(waitMs) : "a bit";
								const message =
									count === 0
										? "No Codex accounts configured. Run `opencode auth login`."
										: waitMs > 0
											? `All ${count} account(s) are rate-limited. Try again in ${waitLabel} or add another account with \`opencode auth login\`.`
											: `All ${count} account(s) failed (server errors or auth issues). Check account health with \`codex-health\`.`;
								runtimeMetrics.failedRequests++;
								runtimeMetrics.lastError = message;
								runtimeMetrics.lastErrorCategory = waitMs > 0 ? "rate-limit" : "account-failure";
								return new Response(JSON.stringify({ error: { message } }), {
									status: waitMs > 0 ? 429 : 503,
											headers: {
												"content-type": "application/json; charset=utf-8",
											},
										});
									}
						} finally {
							clearCorrelationId();
						}
										},
                                };
				} finally {
					resolveMutex?.();
					loaderMutex = null;
				}
                        },
				methods: [
					{
						label: AUTH_LABELS.OAUTH,
						type: "oauth" as const,
						authorize: async (inputs?: Record<string, string>) => {
							const authPluginConfig = loadPluginConfig();
							applyUiRuntimeFromConfig(authPluginConfig);
							const authPerProjectAccounts = getPerProjectAccounts(authPluginConfig);
							setStoragePath(authPerProjectAccounts ? process.cwd() : null);

							const accounts: TokenSuccessWithAccount[] = [];
							const noBrowser =
								inputs?.noBrowser === "true" ||
								inputs?.["no-browser"] === "true";
							const useManualMode = noBrowser;
							const explicitLoginMode =
								inputs?.loginMode === "fresh" || inputs?.loginMode === "add"
									? inputs.loginMode
									: null;

							let startFresh = explicitLoginMode === "fresh";
							let refreshAccountIndex: number | undefined;

							const clampActiveIndices = (storage: AccountStorageV3): void => {
								const count = storage.accounts.length;
								if (count === 0) {
									storage.activeIndex = 0;
									storage.activeIndexByFamily = {};
									return;
								}
								storage.activeIndex = Math.max(0, Math.min(storage.activeIndex, count - 1));
								storage.activeIndexByFamily = storage.activeIndexByFamily ?? {};
								for (const family of MODEL_FAMILIES) {
									const raw = storage.activeIndexByFamily[family];
									const candidate =
										typeof raw === "number" && Number.isFinite(raw) ? raw : storage.activeIndex;
									storage.activeIndexByFamily[family] = Math.max(0, Math.min(candidate, count - 1));
								}
							};

							const isFlaggableFailure = (failure: Extract<TokenResult, { type: "failed" }>): boolean => {
								if (failure.reason === "missing_refresh") return true;
								if (failure.statusCode === 401) return true;
								if (failure.statusCode !== 400) return false;
								const message = (failure.message ?? "").toLowerCase();
								return (
									message.includes("invalid_grant") ||
									message.includes("invalid refresh") ||
									message.includes("token has been revoked")
								);
							};

							type CodexQuotaWindow = {
								usedPercent?: number;
								windowMinutes?: number;
								resetAtMs?: number;
							};

							type CodexQuotaSnapshot = {
								status: number;
								planType?: string;
								activeLimit?: number;
								primary: CodexQuotaWindow;
								secondary: CodexQuotaWindow;
							};

							const parseFiniteNumberHeader = (headers: Headers, name: string): number | undefined => {
								const raw = headers.get(name);
								if (!raw) return undefined;
								const parsed = Number(raw);
								return Number.isFinite(parsed) ? parsed : undefined;
							};

							const parseFiniteIntHeader = (headers: Headers, name: string): number | undefined => {
								const raw = headers.get(name);
								if (!raw) return undefined;
								const parsed = Number.parseInt(raw, 10);
								return Number.isFinite(parsed) ? parsed : undefined;
							};

							const parseResetAtMs = (headers: Headers, prefix: string): number | undefined => {
								const resetAfterSeconds = parseFiniteIntHeader(
									headers,
									`${prefix}-reset-after-seconds`,
								);
								if (
									typeof resetAfterSeconds === "number" &&
									Number.isFinite(resetAfterSeconds) &&
									resetAfterSeconds > 0
								) {
									return Date.now() + resetAfterSeconds * 1000;
								}

								const resetAtRaw = headers.get(`${prefix}-reset-at`);
								if (!resetAtRaw) return undefined;

								const trimmed = resetAtRaw.trim();
								if (/^\d+$/.test(trimmed)) {
									const parsedNumber = Number.parseInt(trimmed, 10);
									if (Number.isFinite(parsedNumber) && parsedNumber > 0) {
										// Upstream sometimes returns seconds since epoch.
										return parsedNumber < 10_000_000_000 ? parsedNumber * 1000 : parsedNumber;
									}
								}

								const parsedDate = Date.parse(trimmed);
								return Number.isFinite(parsedDate) ? parsedDate : undefined;
							};

							const hasCodexQuotaHeaders = (headers: Headers): boolean => {
								const keys = [
									"x-codex-primary-used-percent",
									"x-codex-primary-window-minutes",
									"x-codex-primary-reset-at",
									"x-codex-primary-reset-after-seconds",
									"x-codex-secondary-used-percent",
									"x-codex-secondary-window-minutes",
									"x-codex-secondary-reset-at",
									"x-codex-secondary-reset-after-seconds",
								];
								return keys.some((key) => headers.get(key) !== null);
							};

							const parseCodexQuotaSnapshot = (headers: Headers, status: number): CodexQuotaSnapshot | null => {
								if (!hasCodexQuotaHeaders(headers)) return null;

								const primaryPrefix = "x-codex-primary";
								const secondaryPrefix = "x-codex-secondary";
								const primary: CodexQuotaWindow = {
									usedPercent: parseFiniteNumberHeader(headers, `${primaryPrefix}-used-percent`),
									windowMinutes: parseFiniteIntHeader(headers, `${primaryPrefix}-window-minutes`),
									resetAtMs: parseResetAtMs(headers, primaryPrefix),
								};
								const secondary: CodexQuotaWindow = {
									usedPercent: parseFiniteNumberHeader(headers, `${secondaryPrefix}-used-percent`),
									windowMinutes: parseFiniteIntHeader(headers, `${secondaryPrefix}-window-minutes`),
									resetAtMs: parseResetAtMs(headers, secondaryPrefix),
								};

								const planTypeRaw = headers.get("x-codex-plan-type");
								const planType = planTypeRaw && planTypeRaw.trim() ? planTypeRaw.trim() : undefined;
								const activeLimit = parseFiniteIntHeader(headers, "x-codex-active-limit");

								return { status, planType, activeLimit, primary, secondary };
							};

							const formatQuotaWindowLabel = (windowMinutes: number | undefined): string => {
								if (!windowMinutes || !Number.isFinite(windowMinutes) || windowMinutes <= 0) {
									return "quota";
								}
								if (windowMinutes % 1440 === 0) return `${windowMinutes / 1440}d`;
								if (windowMinutes % 60 === 0) return `${windowMinutes / 60}h`;
								return `${windowMinutes}m`;
							};

							const formatResetAt = (resetAtMs: number | undefined): string | undefined => {
								if (!resetAtMs || !Number.isFinite(resetAtMs) || resetAtMs <= 0) return undefined;
								const date = new Date(resetAtMs);
								if (!Number.isFinite(date.getTime())) return undefined;

								const now = new Date();
								const sameDay =
									now.getFullYear() === date.getFullYear() &&
									now.getMonth() === date.getMonth() &&
									now.getDate() === date.getDate();

								const time = date.toLocaleTimeString(undefined, {
									hour: "2-digit",
									minute: "2-digit",
									hour12: false,
								});

								if (sameDay) return time;
								const day = date.toLocaleDateString(undefined, { month: "short", day: "2-digit" });
								return `${time} on ${day}`;
							};

							const formatCodexQuotaLine = (snapshot: CodexQuotaSnapshot): string => {
								const summarizeWindow = (label: string, window: CodexQuotaWindow): string => {
									const used = window.usedPercent;
									const left =
										typeof used === "number" && Number.isFinite(used)
											? Math.max(0, Math.min(100, Math.round(100 - used)))
											: undefined;
									const reset = formatResetAt(window.resetAtMs);
									let summary = label;
									if (left !== undefined) summary = `${summary} ${left}% left`;
									if (reset) summary = `${summary} (resets ${reset})`;
									return summary;
								};

								const primaryLabel = formatQuotaWindowLabel(snapshot.primary.windowMinutes);
								const secondaryLabel = formatQuotaWindowLabel(snapshot.secondary.windowMinutes);
								const parts = [
									summarizeWindow(primaryLabel, snapshot.primary),
									summarizeWindow(secondaryLabel, snapshot.secondary),
								];
								if (snapshot.planType) parts.push(`plan:${snapshot.planType}`);
								if (typeof snapshot.activeLimit === "number" && Number.isFinite(snapshot.activeLimit)) {
									parts.push(`active:${snapshot.activeLimit}`);
								}
								if (snapshot.status === 429) parts.push("rate-limited");
								return parts.join(", ");
							};

							const fetchCodexQuotaSnapshot = async (params: {
								accountId: string;
								accessToken: string;
							}): Promise<CodexQuotaSnapshot> => {
								const QUOTA_PROBE_MODELS = ["gpt-5-codex", "gpt-5.3-codex", "gpt-5.2-codex"];
								let lastError: Error | null = null;

								for (const model of QUOTA_PROBE_MODELS) {
									try {
										const instructions = await getCodexInstructions(model);
										const probeBody: RequestBody = {
											model,
											stream: true,
											store: false,
											include: ["reasoning.encrypted_content"],
											instructions,
											input: [
												{
													type: "message",
													role: "user",
													content: [{ type: "input_text", text: "quota ping" }],
												},
											],
											reasoning: { effort: "none", summary: "auto" },
											text: { verbosity: "low" },
										};

										const headers = createCodexHeaders(undefined, params.accountId, params.accessToken, {
											model,
										});
								headers.set("content-type", "application/json");

										const controller = new AbortController();
										const timeout = setTimeout(() => controller.abort(), 15_000);
										let response: Response;
										try {
											response = await fetch(`${CODEX_BASE_URL}/codex/responses`, {
												method: "POST",
												headers,
												body: JSON.stringify(probeBody),
												signal: controller.signal,
											});
										} finally {
											clearTimeout(timeout);
										}

										const snapshot = parseCodexQuotaSnapshot(response.headers, response.status);
										if (snapshot) {
											// We only need headers; cancel the SSE stream immediately.
											try {
												await response.body?.cancel();
											} catch {
												// Ignore cancellation failures.
											}
											return snapshot;
										}

										if (!response.ok) {
											const bodyText = await response.text().catch(() => "");
											let errorBody: unknown = undefined;
											try {
												errorBody = bodyText ? (JSON.parse(bodyText) as unknown) : undefined;
											} catch {
												errorBody = { error: { message: bodyText } };
											}

											const unsupportedInfo = getUnsupportedCodexModelInfo(errorBody);
											if (unsupportedInfo.isUnsupported) {
												lastError = new Error(
													unsupportedInfo.message ?? `Model '${model}' unsupported for this account`,
												);
												continue;
											}

											const message =
												(typeof (errorBody as { error?: { message?: unknown } })?.error?.message === "string"
													? (errorBody as { error?: { message?: string } }).error?.message
													: bodyText) || `HTTP ${response.status}`;
											throw new Error(message);
										}

										lastError = new Error("Codex response did not include quota headers");
									} catch (error) {
										lastError = error instanceof Error ? error : new Error(String(error));
									}
								}

								throw lastError ?? new Error("Failed to fetch quotas");
							};

							const runAccountCheck = async (deepProbe: boolean): Promise<void> => {
								const loadedStorage = await hydrateEmails(await loadAccounts());
								const workingStorage = loadedStorage
									? {
										...loadedStorage,
										accounts: loadedStorage.accounts.map((account) => ({ ...account })),
										activeIndexByFamily: loadedStorage.activeIndexByFamily
											? { ...loadedStorage.activeIndexByFamily }
											: {},
									}
									: { version: 3 as const, accounts: [], activeIndex: 0, activeIndexByFamily: {} };

								if (workingStorage.accounts.length === 0) {
									console.log("\nNo accounts to check.\n");
									return;
								}

								const flaggedStorage = await loadFlaggedAccounts();
								let storageChanged = false;
								let flaggedChanged = false;
								const removeFromActive = new Set<string>();
								const total = workingStorage.accounts.length;
								let ok = 0;
								let disabled = 0;
								let errors = 0;

								console.log(
									`\nChecking ${deepProbe ? "full account health" : "quotas"} for all accounts...\n`,
								);

								for (let i = 0; i < total; i += 1) {
									const account = workingStorage.accounts[i];
									if (!account) continue;
									const label = account.email ?? account.accountLabel ?? `Account ${i + 1}`;
									if (account.enabled === false) {
										disabled += 1;
										console.log(`[${i + 1}/${total}] ${label}: DISABLED`);
										continue;
									}

									try {
										// If we already have a valid cached access token, don't force-refresh.
										// This avoids flagging accounts where the refresh token has been burned
										// but the access token is still valid (same behavior as Codex CLI).
										const nowMs = Date.now();
										let accessToken: string | null = null;
										let tokenAccountId: string | undefined = undefined;
										let authDetail = "OK";
										if (
											account.accessToken &&
											(typeof account.expiresAt !== "number" ||
												!Number.isFinite(account.expiresAt) ||
												account.expiresAt > nowMs)
										) {
											accessToken = account.accessToken;
											authDetail = "OK (cached access)";

											tokenAccountId = extractAccountId(account.accessToken);
											if (
												tokenAccountId &&
												shouldUpdateAccountIdFromToken(account.accountIdSource, account.accountId) &&
												tokenAccountId !== account.accountId
											) {
												account.accountId = tokenAccountId;
												account.accountIdSource = "token";
												storageChanged = true;
											}

										}

										// If Codex CLI has a valid cached access token for this email, use it
										// instead of forcing a refresh.
										if (!accessToken) {
											const cached = await lookupCodexCliTokensByEmail(account.email);
											if (
												cached &&
												(typeof cached.expiresAt !== "number" ||
													!Number.isFinite(cached.expiresAt) ||
													cached.expiresAt > nowMs)
											) {
												accessToken = cached.accessToken;
												authDetail = "OK (Codex CLI cache)";

												if (cached.refreshToken && cached.refreshToken !== account.refreshToken) {
													account.refreshToken = cached.refreshToken;
													storageChanged = true;
												}
												if (cached.accessToken && cached.accessToken !== account.accessToken) {
													account.accessToken = cached.accessToken;
													storageChanged = true;
												}
												if (cached.expiresAt !== account.expiresAt) {
													account.expiresAt = cached.expiresAt;
													storageChanged = true;
												}

												const hydratedEmail = sanitizeEmail(
													extractAccountEmail(cached.accessToken),
												);
												if (hydratedEmail && hydratedEmail !== account.email) {
													account.email = hydratedEmail;
													storageChanged = true;
												}

												tokenAccountId = extractAccountId(cached.accessToken);
												if (
													tokenAccountId &&
													shouldUpdateAccountIdFromToken(account.accountIdSource, account.accountId) &&
													tokenAccountId !== account.accountId
												) {
													account.accountId = tokenAccountId;
													account.accountIdSource = "token";
													storageChanged = true;
												}
											}
										}

										if (!accessToken) {
											const refreshResult = await queuedRefresh(account.refreshToken);
											if (refreshResult.type !== "success") {
												errors += 1;
												const message =
													refreshResult.message ?? refreshResult.reason ?? "refresh failed";
												console.log(`[${i + 1}/${total}] ${label}: ERROR (${message})`);
												if (deepProbe && isFlaggableFailure(refreshResult)) {
													const existingIndex = flaggedStorage.accounts.findIndex(
														(flagged) => flagged.refreshToken === account.refreshToken,
													);
													const flaggedRecord: FlaggedAccountMetadataV1 = {
														...account,
														flaggedAt: Date.now(),
														flaggedReason: "token-invalid",
														lastError: message,
													};
													if (existingIndex >= 0) {
														flaggedStorage.accounts[existingIndex] = flaggedRecord;
													} else {
														flaggedStorage.accounts.push(flaggedRecord);
													}
													removeFromActive.add(account.refreshToken);
													flaggedChanged = true;
												}
												continue;
											}

											accessToken = refreshResult.access;
											authDetail = "OK";
											if (refreshResult.refresh !== account.refreshToken) {
												account.refreshToken = refreshResult.refresh;
												storageChanged = true;
											}
											if (refreshResult.access && refreshResult.access !== account.accessToken) {
												account.accessToken = refreshResult.access;
												storageChanged = true;
											}
											if (
												typeof refreshResult.expires === "number" &&
												refreshResult.expires !== account.expiresAt
											) {
												account.expiresAt = refreshResult.expires;
												storageChanged = true;
											}
											const hydratedEmail = sanitizeEmail(
												extractAccountEmail(refreshResult.access, refreshResult.idToken),
											);
											if (hydratedEmail && hydratedEmail !== account.email) {
												account.email = hydratedEmail;
												storageChanged = true;
											}
											tokenAccountId = extractAccountId(refreshResult.access);
											if (
												tokenAccountId &&
												shouldUpdateAccountIdFromToken(account.accountIdSource, account.accountId) &&
												tokenAccountId !== account.accountId
											) {
												account.accountId = tokenAccountId;
												account.accountIdSource = "token";
												storageChanged = true;
											}
										}

										if (!accessToken) {
											throw new Error("Missing access token after refresh");
										}

										if (deepProbe) {
											ok += 1;
											const detail =
												tokenAccountId
													? `${authDetail} (id:${tokenAccountId.slice(-6)})`
													: authDetail;
											console.log(`[${i + 1}/${total}] ${label}: ${detail}`);
											continue;
										}

										try {
											const requestAccountId =
												resolveRequestAccountId(
													account.accountId,
													account.accountIdSource,
													tokenAccountId,
												) ??
												tokenAccountId ??
												account.accountId;

											if (!requestAccountId) {
												throw new Error("Missing accountId for quota probe");
											}

											const snapshot = await fetchCodexQuotaSnapshot({
												accountId: requestAccountId,
												accessToken,
											});
											ok += 1;
											console.log(
												`[${i + 1}/${total}] ${label}: ${formatCodexQuotaLine(snapshot)}`,
											);
										} catch (error) {
											errors += 1;
											const message = error instanceof Error ? error.message : String(error);
											console.log(
												`[${i + 1}/${total}] ${label}: ERROR (${message.slice(0, 160)})`,
											);
										}
									} catch (error) {
										errors += 1;
										const message = error instanceof Error ? error.message : String(error);
										console.log(`[${i + 1}/${total}] ${label}: ERROR (${message.slice(0, 120)})`);
									}
								}

								if (removeFromActive.size > 0) {
									workingStorage.accounts = workingStorage.accounts.filter(
										(account) => !removeFromActive.has(account.refreshToken),
									);
									clampActiveIndices(workingStorage);
									storageChanged = true;
								}

								if (storageChanged) {
									await saveAccounts(workingStorage);
									invalidateAccountManagerCache();
								}
								if (flaggedChanged) {
									await saveFlaggedAccounts(flaggedStorage);
								}

								console.log("");
								console.log(`Results: ${ok} ok, ${errors} error, ${disabled} disabled`);
								if (removeFromActive.size > 0) {
									console.log(
										`Moved ${removeFromActive.size} account(s) to flagged pool (invalid refresh token).`,
									);
								}
								console.log("");
							};

							const verifyFlaggedAccounts = async (): Promise<void> => {
								const flaggedStorage = await loadFlaggedAccounts();
								if (flaggedStorage.accounts.length === 0) {
									console.log("\nNo flagged accounts to verify.\n");
									return;
								}

								console.log("\nVerifying flagged accounts...\n");
								const remaining: FlaggedAccountMetadataV1[] = [];
								const restored: TokenSuccessWithAccount[] = [];

								for (let i = 0; i < flaggedStorage.accounts.length; i += 1) {
									const flagged = flaggedStorage.accounts[i];
									if (!flagged) continue;
									const label = flagged.email ?? flagged.accountLabel ?? `Flagged ${i + 1}`;
									try {
										const cached = await lookupCodexCliTokensByEmail(flagged.email);
										const now = Date.now();
										if (
											cached &&
											typeof cached.expiresAt === "number" &&
											Number.isFinite(cached.expiresAt) &&
											cached.expiresAt > now
										) {
											const refreshToken =
												typeof cached.refreshToken === "string" && cached.refreshToken.trim()
													? cached.refreshToken.trim()
													: flagged.refreshToken;
											const resolved = resolveAccountSelection({
												type: "success",
												access: cached.accessToken,
												refresh: refreshToken,
												expires: cached.expiresAt,
											multiAccount: true,
										});
										if (!resolved.primary.accountIdOverride && flagged.accountId) {
											resolved.primary.accountIdOverride = flagged.accountId;
											resolved.primary.accountIdSource = flagged.accountIdSource ?? "manual";
											resolved.variantsForPersistence = [resolved.primary];
										}
										if (!resolved.primary.organizationIdOverride && flagged.organizationId) {
											resolved.primary.organizationIdOverride = flagged.organizationId;
										}
										if (!resolved.primary.accountLabel && flagged.accountLabel) {
											resolved.primary.accountLabel = flagged.accountLabel;
										}
										restored.push(...resolved.variantsForPersistence);
										console.log(
												`[${i + 1}/${flaggedStorage.accounts.length}] ${label}: RESTORED (Codex CLI cache)`,
										);
											continue;
										}

										const refreshResult = await queuedRefresh(flagged.refreshToken);
										if (refreshResult.type !== "success") {
											console.log(
												`[${i + 1}/${flaggedStorage.accounts.length}] ${label}: STILL FLAGGED (${refreshResult.message ?? refreshResult.reason ?? "refresh failed"})`,
											);
											remaining.push(flagged);
											continue;
										}

									const resolved = resolveAccountSelection(refreshResult);
									if (!resolved.primary.accountIdOverride && flagged.accountId) {
										resolved.primary.accountIdOverride = flagged.accountId;
										resolved.primary.accountIdSource = flagged.accountIdSource ?? "manual";
										resolved.variantsForPersistence = [resolved.primary];
									}
									if (!resolved.primary.organizationIdOverride && flagged.organizationId) {
										resolved.primary.organizationIdOverride = flagged.organizationId;
									}
									if (!resolved.primary.accountLabel && flagged.accountLabel) {
										resolved.primary.accountLabel = flagged.accountLabel;
									}
									restored.push(...resolved.variantsForPersistence);
									console.log(`[${i + 1}/${flaggedStorage.accounts.length}] ${label}: RESTORED`);
									} catch (error) {
										const message = error instanceof Error ? error.message : String(error);
										console.log(
											`[${i + 1}/${flaggedStorage.accounts.length}] ${label}: ERROR (${message.slice(0, 120)})`,
										);
										remaining.push({
											...flagged,
											lastError: message,
										});
									}
								}

								if (restored.length > 0) {
									await persistAccountPool(restored, false);
									invalidateAccountManagerCache();
								}

								await saveFlaggedAccounts({
									version: 1,
									accounts: remaining,
								});

								console.log("");
								console.log(`Results: ${restored.length} restored, ${remaining.length} still flagged`);
								console.log("");
							};

							if (!explicitLoginMode) {
								while (true) {
									const loadedStorage = await hydrateEmails(await loadAccounts());
									const workingStorage = loadedStorage
										? {
											...loadedStorage,
											accounts: loadedStorage.accounts.map((account) => ({ ...account })),
											activeIndexByFamily: loadedStorage.activeIndexByFamily
												? { ...loadedStorage.activeIndexByFamily }
												: {},
										}
										: { version: 3 as const, accounts: [], activeIndex: 0, activeIndexByFamily: {} };
									const flaggedStorage = await loadFlaggedAccounts();

									if (workingStorage.accounts.length === 0 && flaggedStorage.accounts.length === 0) {
										break;
									}

									const now = Date.now();
									const activeIndex = resolveActiveIndex(workingStorage, "codex");
									const existingAccounts = workingStorage.accounts.map((account, index) => {
										let status: "active" | "ok" | "rate-limited" | "cooldown" | "disabled";
										if (account.enabled === false) {
											status = "disabled";
										} else if (
											typeof account.coolingDownUntil === "number" &&
											account.coolingDownUntil > now
										) {
											status = "cooldown";
										} else if (formatRateLimitEntry(account, now)) {
											status = "rate-limited";
										} else if (index === activeIndex) {
											status = "active";
										} else {
											status = "ok";
										}
										return {
											accountId: account.accountId,
											accountLabel: account.accountLabel,
											email: account.email,
											index,
											addedAt: account.addedAt,
											lastUsed: account.lastUsed,
											status,
											isCurrentAccount: index === activeIndex,
											enabled: account.enabled !== false,
										};
									});

									const menuResult = await promptLoginMode(existingAccounts, {
										flaggedCount: flaggedStorage.accounts.length,
									});

									if (menuResult.mode === "cancel") {
										return {
											url: "",
											instructions: "Authentication cancelled",
											method: "auto",
											callback: () =>
												Promise.resolve({
													type: "failed" as const,
												}),
										};
									}

									if (menuResult.mode === "check") {
										await runAccountCheck(false);
										continue;
									}
									if (menuResult.mode === "deep-check") {
										await runAccountCheck(true);
										continue;
									}
									if (menuResult.mode === "verify-flagged") {
										await verifyFlaggedAccounts();
										continue;
									}

									if (menuResult.mode === "manage") {
										if (typeof menuResult.deleteAccountIndex === "number") {
											const target = workingStorage.accounts[menuResult.deleteAccountIndex];
											if (target) {
												workingStorage.accounts.splice(menuResult.deleteAccountIndex, 1);
												clampActiveIndices(workingStorage);
												await saveAccounts(workingStorage);
												await saveFlaggedAccounts({
													version: 1,
													accounts: flaggedStorage.accounts.filter(
														(flagged) => flagged.refreshToken !== target.refreshToken,
													),
												});
												invalidateAccountManagerCache();
												console.log(`\nDeleted ${target.email ?? `Account ${menuResult.deleteAccountIndex + 1}`}.\n`);
											}
											continue;
										}

										if (typeof menuResult.toggleAccountIndex === "number") {
											const target = workingStorage.accounts[menuResult.toggleAccountIndex];
											if (target) {
												target.enabled = target.enabled === false ? true : false;
												await saveAccounts(workingStorage);
												invalidateAccountManagerCache();
												console.log(
													`\n${target.email ?? `Account ${menuResult.toggleAccountIndex + 1}`} ${target.enabled === false ? "disabled" : "enabled"}.\n`,
												);
											}
											continue;
										}

										if (typeof menuResult.refreshAccountIndex === "number") {
											refreshAccountIndex = menuResult.refreshAccountIndex;
											startFresh = false;
											break;
										}

										continue;
									}

									if (menuResult.mode === "fresh") {
										startFresh = true;
										if (menuResult.deleteAll) {
											await clearAccounts();
											await clearFlaggedAccounts();
											invalidateAccountManagerCache();
											console.log("\nDeleted all accounts. Starting fresh.\n");
										}
										break;
									}

									startFresh = false;
									break;
								}
							}

							const latestStorage = await loadAccounts();
							const existingCount = latestStorage?.accounts.length ?? 0;
							const requestedCount = Number.parseInt(inputs?.accountCount ?? "1", 10);
							const normalizedRequested = Number.isFinite(requestedCount) ? requestedCount : 1;
							const availableSlots =
								refreshAccountIndex !== undefined
									? 1
									: startFresh
										? ACCOUNT_LIMITS.MAX_ACCOUNTS
										: ACCOUNT_LIMITS.MAX_ACCOUNTS - existingCount;

							if (availableSlots <= 0) {
								return {
									url: "",
									instructions: "Account limit reached. Remove an account or start fresh.",
									method: "auto",
									callback: () =>
										Promise.resolve({
											type: "failed" as const,
										}),
								};
							}

							let targetCount = Math.max(1, Math.min(normalizedRequested, availableSlots));
							if (refreshAccountIndex !== undefined) {
								targetCount = 1;
							}
							if (useManualMode) {
								targetCount = 1;
							}

							if (useManualMode) {
								const { pkce, state, url } = await createAuthorizationFlow();
								return buildManualOAuthFlow(pkce, url, state, async (selection) => {
									try {
										await persistAccountPool(selection.variantsForPersistence, startFresh);
										invalidateAccountManagerCache();
									} catch (err) {
										const storagePath = getStoragePath();
										const errorCode = (err as NodeJS.ErrnoException)?.code || "UNKNOWN";
										const hint =
											err instanceof StorageError
												? err.hint
												: formatStorageErrorHint(err, storagePath);
										logError(
											`[${PLUGIN_NAME}] Failed to persist account: [${errorCode}] ${(err as Error)?.message ?? String(err)}`,
										);
										await showToast(hint, "error", {
											title: "Account Persistence Failed",
											duration: 10000,
										});
									}
								});
							}

							const explicitCountProvided =
								typeof inputs?.accountCount === "string" && inputs.accountCount.trim().length > 0;

							while (accounts.length < targetCount) {
								logInfo(`=== OpenAI OAuth (Account ${accounts.length + 1}) ===`);
								const forceNewLogin = accounts.length > 0 || refreshAccountIndex !== undefined;
								const result = await runOAuthFlow(forceNewLogin);

								let resolved: TokenSuccessWithAccount | null = null;
								let variantsForPersistence: TokenSuccessWithAccount[] = [];
								if (result.type === "success") {
									const selection = resolveAccountSelection(result);
									resolved = selection.primary;
									variantsForPersistence = selection.variantsForPersistence;
									const email = extractAccountEmail(resolved.access, resolved.idToken);
									const accountId = resolved.accountIdOverride ?? extractAccountId(resolved.access);
									const label = resolved.accountLabel ?? email ?? accountId ?? "Unknown account";
									logInfo(`Authenticated as: ${label}`);

									const isDuplicate = accounts.some(
										(account) =>
											(accountId &&
												(account.accountIdOverride ?? extractAccountId(account.access)) === accountId) ||
											(email && extractAccountEmail(account.access, account.idToken) === email),
									);

									if (isDuplicate) {
										logWarn(`WARNING: duplicate account login detected (${label}). Existing entry will be updated.`);
									}
								}

								if (result.type === "failed") {
									if (accounts.length === 0) {
										return {
											url: "",
											instructions: "Authentication failed.",
											method: "auto",
											callback: () => Promise.resolve(result),
										};
									}
									logWarn(`[${PLUGIN_NAME}] Skipping failed account ${accounts.length + 1}`);
									break;
								}

								if (!resolved) {
									continue;
								}

								accounts.push(resolved);
								await showToast(`Account ${accounts.length} authenticated`, "success");

								try {
									const isFirstAccount = accounts.length === 1;
									const entriesToPersist =
										variantsForPersistence.length > 0 ? variantsForPersistence : [resolved];
									await persistAccountPool(entriesToPersist, isFirstAccount && startFresh);
									invalidateAccountManagerCache();
								} catch (err) {
									const storagePath = getStoragePath();
									const errorCode = (err as NodeJS.ErrnoException)?.code || "UNKNOWN";
									const hint =
										err instanceof StorageError
											? err.hint
											: formatStorageErrorHint(err, storagePath);
									logError(
										`[${PLUGIN_NAME}] Failed to persist account: [${errorCode}] ${(err as Error)?.message ?? String(err)}`,
									);
									await showToast(hint, "error", {
										title: "Account Persistence Failed",
										duration: 10000,
									});
								}

								if (accounts.length >= ACCOUNT_LIMITS.MAX_ACCOUNTS) {
									break;
								}

								if (
									!explicitCountProvided &&
									refreshAccountIndex === undefined &&
									accounts.length < availableSlots &&
									accounts.length >= targetCount
								) {
									const addMore = await promptAddAnotherAccount(accounts.length);
									if (addMore) {
										targetCount = Math.min(targetCount + 1, availableSlots);
										continue;
									}
									break;
								}
							}

							const primary = accounts[0];
							if (!primary) {
								return {
									url: "",
									instructions: "Authentication cancelled",
									method: "auto",
									callback: () =>
										Promise.resolve({
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
								logWarn(
									`[${PLUGIN_NAME}] Failed to load final account count: ${(err as Error)?.message ?? String(err)}`,
								);
							}

							return {
								url: "",
								instructions: `Multi-account setup complete (${actualAccountCount} account(s)).`,
								method: "auto",
								callback: () => Promise.resolve(primary),
							};
						},
					},

				{
					label: AUTH_LABELS.OAUTH_MANUAL,
					type: "oauth" as const,
					authorize: async () => {
                                                        // Initialize storage path for manual OAuth flow
                                                        // Must happen BEFORE persistAccountPool to ensure correct storage location
                                                        const manualPluginConfig = loadPluginConfig();
							applyUiRuntimeFromConfig(manualPluginConfig);
                                                        const manualPerProjectAccounts = getPerProjectAccounts(manualPluginConfig);
							setStoragePath(manualPerProjectAccounts ? process.cwd() : null);

												const { pkce, state, url } = await createAuthorizationFlow();
												return buildManualOAuthFlow(pkce, url, state, async (selection) => {
														try {
																await persistAccountPool(selection.variantsForPersistence, false);
														} catch (err) {
                                                                        const storagePath = getStoragePath();
                                                                        const errorCode = (err as NodeJS.ErrnoException)?.code || "UNKNOWN";
                                                                        const hint = err instanceof StorageError ? err.hint : formatStorageErrorHint(err, storagePath);
                                                                        logError(`[${PLUGIN_NAME}] Failed to persist account: [${errorCode}] ${(err as Error)?.message ?? String(err)}`);
                                                                        await showToast(
                                                                                hint,
                                                                                "error",
                                                                                { title: "Account Persistence Failed", duration: 10000 },
                                                                        );
                                                                }
                                                        });
                                                },
                                        },
                        ],
                },
                tool: {
                        "codex-list": tool({
                                description:
                                        "List all Codex OAuth accounts and the current active index.",
                                args: {
					tag: tool.schema
						.string()
						.optional()
						.describe("Optional tag filter (e.g., work, personal, team-a)."),
				},
                                async execute({ tag }: { tag?: string } = {}) {
					const ui = resolveUiRuntime();
                                        const storage = await loadAccounts();
                                        const storePath = getStoragePath();
					const normalizedTag = tag?.trim().toLowerCase() ?? "";

                                        if (!storage || storage.accounts.length === 0) {
						if (ui.v2Enabled) {
							return [
								...formatUiHeader(ui, "Codex accounts"),
								"",
								formatUiItem(ui, "No accounts configured.", "warning"),
								formatUiItem(ui, "Run: opencode auth login", "accent"),
								formatUiItem(ui, "Setup checklist: codex-setup"),
								formatUiItem(ui, "Command guide: codex-help"),
								formatUiKeyValue(ui, "Storage", storePath, "muted"),
							].join("\n");
						}
                                                return [
                                                        "No Codex accounts configured.",
                                                        "",
                                                        "Add accounts:",
                                                        "  opencode auth login",
							"  codex-setup",
							"  codex-help",
                                                        "",
                                                        `Storage: ${storePath}`,
                                                ].join("\n");
                                        }

					const now = Date.now();
					const activeIndex = resolveActiveIndex(storage, "codex");
					const filteredEntries = storage.accounts
						.map((account, index) => ({ account, index }))
						.filter(({ account }) => {
							if (!normalizedTag) return true;
							const tags = Array.isArray(account.accountTags)
								? account.accountTags.map((entry) => entry.trim().toLowerCase())
								: [];
							return tags.includes(normalizedTag);
						});
					if (normalizedTag && filteredEntries.length === 0) {
						if (ui.v2Enabled) {
							return [
								...formatUiHeader(ui, "Codex accounts"),
								"",
								formatUiItem(ui, `No accounts found for tag: ${normalizedTag}`, "warning"),
								formatUiItem(ui, "Use codex-tag index=2 tags=\"work,team-a\" to add tags.", "accent"),
							].join("\n");
						}
						return `No accounts found for tag: ${normalizedTag}\n\nUse codex-tag index=2 tags="work,team-a" to add tags.`;
					}
					if (ui.v2Enabled) {
						const lines: string[] = [
							...formatUiHeader(ui, "Codex accounts"),
							formatUiKeyValue(ui, "Total", String(filteredEntries.length)),
							normalizedTag
								? formatUiKeyValue(ui, "Filter tag", normalizedTag, "accent")
								: formatUiKeyValue(ui, "Filter tag", "none", "muted"),
							formatUiKeyValue(ui, "Storage", storePath, "muted"),
							"",
							...formatUiSection(ui, "Accounts"),
						];

						filteredEntries.forEach(({ account, index }) => {
							const label = formatCommandAccountLabel(account, index);
							const badges: string[] = [];
							if (index === activeIndex) badges.push(formatUiBadge(ui, "current", "accent"));
							if (account.enabled === false) badges.push(formatUiBadge(ui, "disabled", "danger"));
							const rateLimit = formatRateLimitEntry(account, now);
							if (rateLimit) badges.push(formatUiBadge(ui, "rate-limited", "warning"));
							if (
								typeof account.coolingDownUntil === "number" &&
								account.coolingDownUntil > now
							) {
								badges.push(formatUiBadge(ui, "cooldown", "warning"));
							}
							if (badges.length === 0) {
								badges.push(formatUiBadge(ui, "ok", "success"));
							}

							lines.push(formatUiItem(ui, `${label} ${badges.join(" ")}`.trim()));
							if (rateLimit) {
								lines.push(`  ${paintUiText(ui, `rate limit: ${rateLimit}`, "muted")}`);
							}
						});

						lines.push("");
						lines.push(...formatUiSection(ui, "Commands"));
						lines.push(formatUiItem(ui, "Add account: opencode auth login", "accent"));
						lines.push(formatUiItem(ui, "Switch account: codex-switch index=2"));
						lines.push(formatUiItem(ui, "Detailed status: codex-status"));
						lines.push(formatUiItem(ui, "Live dashboard: codex-dashboard"));
						lines.push(formatUiItem(ui, "Runtime metrics: codex-metrics"));
						lines.push(formatUiItem(ui, "Set account tags: codex-tag index=2 tags=\"work,team-a\""));
						lines.push(formatUiItem(ui, "Set account note: codex-note index=2 note=\"weekday primary\""));
						lines.push(formatUiItem(ui, "Doctor checks: codex-doctor"));
						lines.push(formatUiItem(ui, "Onboarding checklist: codex-setup"));
						lines.push(formatUiItem(ui, "Guided setup wizard: codex-setup --wizard"));
						lines.push(formatUiItem(ui, "Best next action: codex-next"));
						lines.push(formatUiItem(ui, "Rename account label: codex-label index=2 label=\"Work\""));
						lines.push(formatUiItem(ui, "Command guide: codex-help"));
						return lines.join("\n");
					}
					
					const listTableOptions: TableOptions = {
						columns: [
							{ header: "#", width: 3 },
							{ header: "Label", width: 42 },
							{ header: "Status", width: 20 },
						],
					};
					
					const lines: string[] = [
						`Codex Accounts (${filteredEntries.length}):`,
						"",
						...buildTableHeader(listTableOptions),
					];

						filteredEntries.forEach(({ account, index }) => {
							const label = formatCommandAccountLabel(account, index);
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
                                                lines.push(buildTableRow([String(index + 1), label, statusText], listTableOptions));
                                        });

					lines.push("");
                                        lines.push(`Storage: ${storePath}`);
					if (normalizedTag) {
						lines.push(`Filter tag: ${normalizedTag}`);
					}
                                        lines.push("");
                                        lines.push("Commands:");
                                        lines.push("  - Add account: opencode auth login");
                                        lines.push("  - Switch account: codex-switch");
                                        lines.push("  - Status details: codex-status");
                                        lines.push("  - Live dashboard: codex-dashboard");
                                        lines.push("  - Runtime metrics: codex-metrics");
					lines.push("  - Set account tags: codex-tag");
					lines.push("  - Set account note: codex-note");
                                        lines.push("  - Doctor checks: codex-doctor");
                                        lines.push("  - Setup checklist: codex-setup");
                                        lines.push("  - Guided setup wizard: codex-setup --wizard");
                                        lines.push("  - Best next action: codex-next");
                                        lines.push("  - Rename account label: codex-label");
                                        lines.push("  - Command guide: codex-help");

                                        return lines.join("\n");
                                },
                        }),
                        "codex-switch": tool({
                                description: "Switch active Codex account by index (1-based) or interactive picker when index is omitted.",
                                args: {
                                        index: tool.schema.number().optional().describe(
                                                "Account number to switch to (1-based, e.g., 1 for first account)",
                                        ),
                                },
                                async execute({ index }: { index?: number } = {}) {
					const ui = resolveUiRuntime();
                                        const storage = await loadAccounts();
                                        if (!storage || storage.accounts.length === 0) {
						if (ui.v2Enabled) {
							return [
								...formatUiHeader(ui, "Switch account"),
								"",
								formatUiItem(ui, "No accounts configured.", "warning"),
								formatUiItem(ui, "Run: opencode auth login", "accent"),
							].join("\n");
						}
                                                return "No Codex accounts configured. Run: opencode auth login";
                                        }

					let resolvedIndex = index;
					if (resolvedIndex === undefined) {
						const selectedIndex = await promptAccountIndexSelection(
							ui,
							storage,
							"Switch account",
						);
						if (selectedIndex === null) {
							if (supportsInteractiveMenus()) {
								if (ui.v2Enabled) {
									return [
										...formatUiHeader(ui, "Switch account"),
										"",
										formatUiItem(ui, "No account selected.", "warning"),
										formatUiItem(ui, "Run again and pick an account, or pass codex-switch index=2.", "muted"),
									].join("\n");
								}
								return "No account selected.";
							}
							if (ui.v2Enabled) {
								return [
									...formatUiHeader(ui, "Switch account"),
									"",
									formatUiItem(ui, "Missing account number.", "warning"),
									formatUiItem(ui, "Use: codex-switch index=2", "accent"),
								].join("\n");
							}
							return "Missing account number. Use: codex-switch index=2";
						}
						resolvedIndex = selectedIndex + 1;
					}

                                        const targetIndex = Math.floor((resolvedIndex ?? 0) - 1);
                                        if (
                                                !Number.isFinite(targetIndex) ||
                                                targetIndex < 0 ||
                                                targetIndex >= storage.accounts.length
                                        ) {
						if (ui.v2Enabled) {
							return [
								...formatUiHeader(ui, "Switch account"),
								"",
								formatUiItem(ui, `Invalid account number: ${resolvedIndex}`, "danger"),
								formatUiKeyValue(ui, "Valid range", `1-${storage.accounts.length}`, "muted"),
							].join("\n");
						}
                                                return `Invalid account number: ${resolvedIndex}\n\nValid range: 1-${storage.accounts.length}`;
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
					try {
						await saveAccounts(storage);
					} catch (saveError) {
						logWarn("Failed to save account switch", { error: String(saveError) });
						const label = formatCommandAccountLabel(account, targetIndex);
						if (ui.v2Enabled) {
							return [
								...formatUiHeader(ui, "Switch account"),
								"",
								formatUiItem(ui, `Switched to ${label}`, "warning"),
								formatUiItem(ui, "Failed to persist change. It may be lost on restart.", "danger"),
							].join("\n");
						}
						return `Switched to ${label} but failed to persist. Changes may be lost on restart.`;
					}

                                        if (cachedAccountManager) {
						const reloadedManager = await AccountManager.loadFromDisk();
						cachedAccountManager = reloadedManager;
						accountManagerPromise = Promise.resolve(reloadedManager);
                                        }

					const label = formatCommandAccountLabel(account, targetIndex);
					if (ui.v2Enabled) {
						return [
							...formatUiHeader(ui, "Switch account"),
							"",
							formatUiItem(ui, `${getStatusMarker(ui, "ok")} Switched to ${label}`, "success"),
						].join("\n");
					}
                                        return `Switched to account: ${label}`;
                                },
                        }),
			"codex-status": tool({
				description: "Show detailed status of Codex accounts and rate limits.",
				args: {},
				async execute() {
					const ui = resolveUiRuntime();
					const storage = await loadAccounts();
					if (!storage || storage.accounts.length === 0) {
						if (ui.v2Enabled) {
							return [
								...formatUiHeader(ui, "Account status"),
								"",
								formatUiItem(ui, "No accounts configured.", "warning"),
								formatUiItem(ui, "Run: opencode auth login", "accent"),
							].join("\n");
						}
						return "No Codex accounts configured. Run: opencode auth login";
					}

				const now = Date.now();
				const activeIndex = resolveActiveIndex(storage, "codex");
				const explainabilityFamily =
					runtimeMetrics.lastSelectionSnapshot?.family ?? "codex";
				const explainabilityModel =
					runtimeMetrics.lastSelectionSnapshot?.model ?? undefined;
				const managerForExplainability =
					cachedAccountManager ?? (await AccountManager.loadFromDisk());
				const explainability = managerForExplainability.getSelectionExplainability(
					explainabilityFamily,
					explainabilityModel,
					now,
				);
				const explainabilityByIndex = new Map(
					explainability.map((entry) => [entry.index, entry]),
				);
				if (ui.v2Enabled) {
					const lines: string[] = [
						...formatUiHeader(ui, "Account status"),
						formatUiKeyValue(ui, "Total", String(storage.accounts.length)),
						formatUiKeyValue(
							ui,
							"Selection view",
							explainabilityModel
								? `${explainabilityFamily}:${explainabilityModel}`
								: explainabilityFamily,
							"muted",
						),
						"",
						...formatUiSection(ui, "Accounts"),
					];

					storage.accounts.forEach((account, index) => {
						const label = formatCommandAccountLabel(account, index);
						const badges: string[] = [];
						if (index === activeIndex) badges.push(formatUiBadge(ui, "active", "accent"));
						if (account.enabled === false) badges.push(formatUiBadge(ui, "disabled", "danger"));
						const rateLimit = formatRateLimitEntry(account, now) ?? "none";
						const cooldown = formatCooldown(account, now) ?? "none";
						if (rateLimit !== "none") badges.push(formatUiBadge(ui, "rate-limited", "warning"));
						if (cooldown !== "none") badges.push(formatUiBadge(ui, "cooldown", "warning"));
						if (badges.length === 0) badges.push(formatUiBadge(ui, "ok", "success"));

						lines.push(formatUiItem(ui, `${label} ${badges.join(" ")}`.trim()));
						lines.push(`  ${formatUiKeyValue(ui, "rate limit", rateLimit, rateLimit === "none" ? "muted" : "warning")}`);
						lines.push(`  ${formatUiKeyValue(ui, "cooldown", cooldown, cooldown === "none" ? "muted" : "warning")}`);
					});

					lines.push("");
					lines.push(...formatUiSection(ui, "Active index by model family"));
					for (const family of MODEL_FAMILIES) {
						const idx = storage.activeIndexByFamily?.[family];
						const familyIndexLabel =
							typeof idx === "number" && Number.isFinite(idx) ? String(idx + 1) : "-";
						lines.push(formatUiItem(ui, `${family}: ${familyIndexLabel}`));
					}

					lines.push("");
					lines.push(...formatUiSection(ui, "Rate limits by model family (per account)"));
					storage.accounts.forEach((account, index) => {
						const statuses = MODEL_FAMILIES.map((family) => {
							const resetAt = getRateLimitResetTimeForFamily(account, now, family);
							if (typeof resetAt !== "number") return `${family}=ok`;
							return `${family}=${formatWaitTime(resetAt - now)}`;
						});
						lines.push(formatUiItem(ui, `Account ${index + 1}: ${statuses.join(" | ")}`));
					});

					lines.push("");
					lines.push(...formatUiSection(ui, "Selection explainability"));
					for (const entry of explainability) {
						const state = entry.eligible ? "eligible" : "blocked";
						const reasons = entry.reasons.join(", ");
						lines.push(
							formatUiItem(
								ui,
								`Account ${entry.index + 1}: ${state} | health=${Math.round(entry.healthScore)} | tokens=${entry.tokensAvailable.toFixed(1)} | ${reasons}`,
							),
						);
					}

					const nextAction = recommendBeginnerNextAction({
						accounts: toBeginnerAccountSnapshots(storage, activeIndex, now),
						now,
						runtime: getBeginnerRuntimeSnapshot(),
					});
					lines.push("");
					lines.push(...formatUiSection(ui, "Recommended next step"));
					lines.push(formatUiItem(ui, nextAction, "accent"));

					return lines.join("\n");
				}

				const statusTableOptions: TableOptions = {
					columns: [
						{ header: "#", width: 3 },
						{ header: "Label", width: 42 },
						{ header: "Active", width: 6 },
						{ header: "Rate Limit", width: 16 },
						{ header: "Cooldown", width: 16 },
						{ header: "Last Used", width: 16 },
					],
				};

                                        const lines: string[] = [
                                                `Account Status (${storage.accounts.length} total):`,
                                                "",
                                                ...buildTableHeader(statusTableOptions),
                                        ];

								storage.accounts.forEach((account, index) => {
										const label = formatCommandAccountLabel(account, index);
										const active = index === activeIndex ? "Yes" : "No";
										const rateLimit = formatRateLimitEntry(account, now) ?? "None";
										const cooldown = formatCooldown(account, now) ?? "No";
										const lastUsed =
												typeof account.lastUsed === "number" && account.lastUsed > 0
														? `${formatWaitTime(now - account.lastUsed)} ago`
														: "-";

										lines.push(buildTableRow([String(index + 1), label, active, rateLimit, cooldown, lastUsed], statusTableOptions));
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

										lines.push("");
										lines.push(
											`Selection explainability (${explainabilityModel ? `${explainabilityFamily}:${explainabilityModel}` : explainabilityFamily}):`,
										);
										for (const [index] of storage.accounts.entries()) {
											const details = explainabilityByIndex.get(index);
											if (!details) continue;
											const state = details.eligible ? "eligible" : "blocked";
											lines.push(
												`  Account ${index + 1}: ${state} | health=${Math.round(details.healthScore)} | tokens=${details.tokensAvailable.toFixed(1)} | ${details.reasons.join(", ")}`,
											);
										}

										lines.push("");
										lines.push(
											`Recommended next step: ${recommendBeginnerNextAction({
												accounts: toBeginnerAccountSnapshots(storage, activeIndex, now),
												now,
												runtime: getBeginnerRuntimeSnapshot(),
											})}`,
										);

										return lines.join("\n");
                                },
                        }),
			"codex-metrics": tool({
				description: "Show runtime request metrics for this plugin process.",
				args: {},
				execute() {
					const ui = resolveUiRuntime();
					const now = Date.now();
					const uptimeMs = Math.max(0, now - runtimeMetrics.startedAt);
					const total = runtimeMetrics.totalRequests;
					const successful = runtimeMetrics.successfulRequests;
					const refreshMetrics = getRefreshQueueMetrics();
					const successRate = total > 0 ? ((successful / total) * 100).toFixed(1) : "0.0";
					const avgLatencyMs =
						successful > 0
							? Math.round(runtimeMetrics.cumulativeLatencyMs / successful)
							: 0;
					const lastRequest =
						runtimeMetrics.lastRequestAt !== null
							? `${formatWaitTime(now - runtimeMetrics.lastRequestAt)} ago`
							: "never";

						const lines = [
							"Codex Plugin Metrics:",
						"",
						`Uptime: ${formatWaitTime(uptimeMs)}`,
						`Total upstream requests: ${total}`,
							`Successful responses: ${successful}`,
							`Failed responses: ${runtimeMetrics.failedRequests}`,
						`Success rate: ${successRate}%`,
						`Average successful latency: ${avgLatencyMs}ms`,
						`Rate-limited responses: ${runtimeMetrics.rateLimitedResponses}`,
						`Server errors (5xx): ${runtimeMetrics.serverErrors}`,
						`Network errors: ${runtimeMetrics.networkErrors}`,
						`Auth refresh failures: ${runtimeMetrics.authRefreshFailures}`,
						`Account rotations: ${runtimeMetrics.accountRotations}`,
						`Empty-response retries: ${runtimeMetrics.emptyResponseRetries}`,
						`Retry profile: ${runtimeMetrics.retryProfile}`,
						`Beginner safe mode: ${beginnerSafeModeEnabled ? "on" : "off"}`,
						`Retry budget exhaustions: ${runtimeMetrics.retryBudgetExhaustions}`,
						`Retry budget usage (auth/network/server/short/global/empty): ` +
							`${runtimeMetrics.retryBudgetUsage.authRefresh}/` +
							`${runtimeMetrics.retryBudgetUsage.network}/` +
							`${runtimeMetrics.retryBudgetUsage.server}/` +
							`${runtimeMetrics.retryBudgetUsage.rateLimitShort}/` +
							`${runtimeMetrics.retryBudgetUsage.rateLimitGlobal}/` +
							`${runtimeMetrics.retryBudgetUsage.emptyResponse}`,
						`Refresh queue (started/success/failed/pending): ` +
							`${refreshMetrics.started}/` +
							`${refreshMetrics.succeeded}/` +
							`${refreshMetrics.failed}/` +
							`${refreshMetrics.pending}`,
						`Last upstream request: ${lastRequest}`,
					];

					if (runtimeMetrics.lastError) {
						lines.push(`Last error: ${runtimeMetrics.lastError}`);
					}
					if (runtimeMetrics.lastErrorCategory) {
						lines.push(`Last error category: ${runtimeMetrics.lastErrorCategory}`);
					}
					if (runtimeMetrics.lastSelectedAccountIndex !== null) {
						lines.push(`Last selected account: ${runtimeMetrics.lastSelectedAccountIndex + 1}`);
					}
					if (runtimeMetrics.lastQuotaKey) {
						lines.push(`Last quota key: ${runtimeMetrics.lastQuotaKey}`);
					}
					if (runtimeMetrics.lastRetryBudgetExhaustedClass) {
						lines.push(
							`Last budget exhaustion: ${runtimeMetrics.lastRetryBudgetExhaustedClass}` +
								(runtimeMetrics.lastRetryBudgetReason
									? ` (${runtimeMetrics.lastRetryBudgetReason})`
									: ""),
						);
					}

					if (ui.v2Enabled) {
						const styled: string[] = [
							...formatUiHeader(ui, "Codex plugin metrics"),
							formatUiKeyValue(ui, "Uptime", formatWaitTime(uptimeMs)),
							formatUiKeyValue(ui, "Total upstream requests", String(total)),
							formatUiKeyValue(ui, "Successful responses", String(successful), "success"),
							formatUiKeyValue(ui, "Failed responses", String(runtimeMetrics.failedRequests), "danger"),
							formatUiKeyValue(ui, "Success rate", `${successRate}%`, "accent"),
							formatUiKeyValue(ui, "Average successful latency", `${avgLatencyMs}ms`),
							formatUiKeyValue(ui, "Rate-limited responses", String(runtimeMetrics.rateLimitedResponses), "warning"),
							formatUiKeyValue(ui, "Server errors (5xx)", String(runtimeMetrics.serverErrors), "danger"),
							formatUiKeyValue(ui, "Network errors", String(runtimeMetrics.networkErrors), "danger"),
							formatUiKeyValue(ui, "Auth refresh failures", String(runtimeMetrics.authRefreshFailures), "warning"),
							formatUiKeyValue(ui, "Account rotations", String(runtimeMetrics.accountRotations), "accent"),
							formatUiKeyValue(ui, "Empty-response retries", String(runtimeMetrics.emptyResponseRetries), "warning"),
							formatUiKeyValue(ui, "Retry profile", runtimeMetrics.retryProfile, "muted"),
							formatUiKeyValue(ui, "Beginner safe mode", beginnerSafeModeEnabled ? "on" : "off", beginnerSafeModeEnabled ? "accent" : "muted"),
							formatUiKeyValue(ui, "Retry budget exhaustions", String(runtimeMetrics.retryBudgetExhaustions), "warning"),
							formatUiKeyValue(
								ui,
								"Retry budget usage",
								`A${runtimeMetrics.retryBudgetUsage.authRefresh} N${runtimeMetrics.retryBudgetUsage.network} S${runtimeMetrics.retryBudgetUsage.server} RS${runtimeMetrics.retryBudgetUsage.rateLimitShort} RG${runtimeMetrics.retryBudgetUsage.rateLimitGlobal} E${runtimeMetrics.retryBudgetUsage.emptyResponse}`,
								"muted",
							),
							formatUiKeyValue(
								ui,
								"Retry budget limits",
								`A${runtimeMetrics.retryBudgetLimits.authRefresh} N${runtimeMetrics.retryBudgetLimits.network} S${runtimeMetrics.retryBudgetLimits.server} RS${runtimeMetrics.retryBudgetLimits.rateLimitShort} RG${runtimeMetrics.retryBudgetLimits.rateLimitGlobal} E${runtimeMetrics.retryBudgetLimits.emptyResponse}`,
								"muted",
							),
							formatUiKeyValue(
								ui,
								"Refresh queue",
								`started=${refreshMetrics.started} dedup=${refreshMetrics.deduplicated} reuse=${refreshMetrics.rotationReused} success=${refreshMetrics.succeeded} failed=${refreshMetrics.failed} pending=${refreshMetrics.pending}`,
								"muted",
							),
							formatUiKeyValue(ui, "Last upstream request", lastRequest, "muted"),
						];
						if (runtimeMetrics.lastError) {
							styled.push(formatUiKeyValue(ui, "Last error", runtimeMetrics.lastError, "danger"));
						}
						if (runtimeMetrics.lastErrorCategory) {
							styled.push(
								formatUiKeyValue(ui, "Last error category", runtimeMetrics.lastErrorCategory, "warning"),
							);
						}
						if (runtimeMetrics.lastSelectedAccountIndex !== null) {
							styled.push(
								formatUiKeyValue(
									ui,
									"Last selected account",
									String(runtimeMetrics.lastSelectedAccountIndex + 1),
									"accent",
								),
							);
						}
						if (runtimeMetrics.lastQuotaKey) {
							styled.push(formatUiKeyValue(ui, "Last quota key", runtimeMetrics.lastQuotaKey, "muted"));
						}
						if (runtimeMetrics.lastRetryBudgetExhaustedClass) {
							styled.push(
								formatUiKeyValue(
									ui,
									"Last budget exhaustion",
									runtimeMetrics.lastRetryBudgetReason
										? `${runtimeMetrics.lastRetryBudgetExhaustedClass} (${runtimeMetrics.lastRetryBudgetReason})`
										: runtimeMetrics.lastRetryBudgetExhaustedClass,
									"warning",
								),
							);
						}
						return Promise.resolve(styled.join("\n"));
					}

					return Promise.resolve(lines.join("\n"));
				},
			}),
			"codex-help": tool({
				description: "Beginner-friendly command guide with quickstart and troubleshooting flows.",
				args: {
					topic: tool.schema
						.string()
						.optional()
						.describe("Optional topic: setup, switch, health, backup, dashboard, metrics."),
				},
				async execute({ topic }) {
					const ui = resolveUiRuntime();
					await Promise.resolve();
					const normalizedTopic = (topic ?? "").trim().toLowerCase();
					const sections: Array<{ key: string; title: string; lines: string[] }> = [
						{
							key: "setup",
							title: "Quickstart",
							lines: [
								"1) Add account: opencode auth login",
								"2) Verify account health: codex-health",
								"3) View account list: codex-list",
								"4) Run checklist: codex-setup",
								"5) Use guided wizard: codex-setup --wizard",
								"6) Start requests and monitor: codex-dashboard",
							],
						},
						{
							key: "switch",
							title: "Daily account operations",
							lines: [
								"List accounts: codex-list",
								"Switch active account: codex-switch index=2",
								"Show detailed status: codex-status",
								"Set account label: codex-label index=2 label=\"Work\"",
								"Set account tags: codex-tag index=2 tags=\"work,team-a\"",
								"Set account note: codex-note index=2 note=\"weekday primary\"",
								"Filter by tag: codex-list tag=\"work\"",
								"Remove account: codex-remove index=2",
							],
						},
						{
							key: "health",
							title: "Health and recovery",
							lines: [
								"Verify token health: codex-health",
								"Refresh all tokens: codex-refresh",
								"Run diagnostics: codex-doctor",
								"Run diagnostics with fixes: codex-doctor --fix",
								"Show best next action: codex-next",
								"Run guided wizard: codex-setup --wizard",
							],
						},
						{
							key: "dashboard",
							title: "Monitoring",
							lines: [
								"Live dashboard: codex-dashboard",
								"Runtime metrics: codex-metrics",
								"Per-account status detail: codex-status",
							],
						},
						{
							key: "backup",
							title: "Backup and migration",
							lines: [
								"Export accounts: codex-export <path>",
								"Auto backup export: codex-export",
								"Import preview: codex-import <path> --dryRun",
								"Import apply: codex-import <path>",
								"Setup checklist: codex-setup",
							],
						},
					];

					const visibleSections =
						normalizedTopic.length === 0
							? sections
							: sections.filter((section) => section.key.includes(normalizedTopic));
					if (visibleSections.length === 0) {
						const available = sections.map((section) => section.key).join(", ");
						if (ui.v2Enabled) {
							return [
								...formatUiHeader(ui, "Codex help"),
								"",
								formatUiItem(ui, `Unknown topic: ${normalizedTopic}`, "warning"),
								formatUiItem(ui, `Available topics: ${available}`, "muted"),
							].join("\n");
						}
						return `Unknown topic: ${normalizedTopic}\n\nAvailable topics: ${available}`;
					}

					if (ui.v2Enabled) {
						const lines: string[] = [...formatUiHeader(ui, "Codex help"), ""];
						for (const section of visibleSections) {
							lines.push(...formatUiSection(ui, section.title));
							for (const line of section.lines) {
								lines.push(formatUiItem(ui, line));
							}
							lines.push("");
						}
						lines.push(...formatUiSection(ui, "Tips"));
						lines.push(formatUiItem(ui, "Run codex-setup after adding accounts."));
						lines.push(formatUiItem(ui, "Use codex-setup --wizard for menu-driven onboarding."));
						lines.push(formatUiItem(ui, "Use codex-doctor when request failures increase."));
						return lines.join("\n").trimEnd();
					}

					const lines: string[] = ["Codex Help:", ""];
					for (const section of visibleSections) {
						lines.push(`${section.title}:`);
						for (const line of section.lines) {
							lines.push(`  - ${line}`);
						}
						lines.push("");
					}
					lines.push("Tips:");
					lines.push("  - Run codex-setup after adding accounts.");
					lines.push("  - Use codex-setup --wizard for menu-driven onboarding.");
					lines.push("  - Use codex-doctor when request failures increase.");
					return lines.join("\n");
				},
			}),
			"codex-setup": tool({
				description: "Beginner checklist for first-time setup and account readiness.",
				args: {
					wizard: tool.schema
						.boolean()
						.optional()
						.describe("Launch menu-driven setup wizard when terminal supports it."),
				},
				async execute({ wizard }: { wizard?: boolean } = {}) {
					const ui = resolveUiRuntime();
					const state = await buildSetupChecklistState();
					if (wizard) {
						return runSetupWizard(ui, state);
					}
					return renderSetupChecklistOutput(ui, state);
				},
			}),
			"codex-doctor": tool({
				description: "Run beginner-friendly diagnostics with clear fixes.",
				args: {
					deep: tool.schema
						.boolean()
						.optional()
						.describe("Include technical snapshot details (default: false)."),
					fix: tool.schema
						.boolean()
						.optional()
						.describe("Apply safe automated fixes (refresh tokens and switch to healthiest eligible account)."),
				},
				async execute({ deep, fix }: { deep?: boolean; fix?: boolean } = {}) {
					const ui = resolveUiRuntime();
					const storage = await loadAccounts();
					const now = Date.now();
					const activeIndex =
						storage && storage.accounts.length > 0
							? resolveActiveIndex(storage, "codex")
							: 0;
					const snapshots = storage
						? toBeginnerAccountSnapshots(storage, activeIndex, now)
						: [];
					const runtime = getBeginnerRuntimeSnapshot();
					const summary = summarizeBeginnerAccounts(snapshots, now);
					const findings = buildBeginnerDoctorFindings({
						accounts: snapshots,
						now,
						runtime,
					});
					const nextAction = recommendBeginnerNextAction({ accounts: snapshots, now, runtime });
					const appliedFixes: string[] = [];
					const fixErrors: string[] = [];

					if (fix && storage && storage.accounts.length > 0) {
						let changedByRefresh = false;
						let refreshedCount = 0;
						for (const account of storage.accounts) {
							try {
								const refreshResult = await queuedRefresh(account.refreshToken);
								if (refreshResult.type === "success") {
									account.refreshToken = refreshResult.refresh;
									account.accessToken = refreshResult.access;
									account.expiresAt = refreshResult.expires;
									changedByRefresh = true;
									refreshedCount += 1;
								}
							} catch (error) {
								fixErrors.push(
									error instanceof Error ? error.message : String(error),
								);
							}
						}
						if (changedByRefresh) {
							try {
								await saveAccounts(storage);
								appliedFixes.push(`Refreshed ${refreshedCount} account token(s).`);
							} catch (error) {
								fixErrors.push(
									`Failed to persist refresh updates: ${
										error instanceof Error ? error.message : String(error)
									}`,
								);
							}
						}

						try {
							const managerForFix = await AccountManager.loadFromDisk();
							const explainability = managerForFix.getSelectionExplainability("codex", undefined, Date.now());
							const eligible = explainability
								.filter((entry) => entry.eligible)
								.sort((a, b) => {
									if (b.healthScore !== a.healthScore) return b.healthScore - a.healthScore;
									return b.tokensAvailable - a.tokensAvailable;
								});
							const best = eligible[0];
							if (best) {
								const currentActive = resolveActiveIndex(storage, "codex");
								if (best.index !== currentActive) {
									storage.activeIndex = best.index;
									storage.activeIndexByFamily = storage.activeIndexByFamily ?? {};
									for (const family of MODEL_FAMILIES) {
										storage.activeIndexByFamily[family] = best.index;
									}
									await saveAccounts(storage);
									appliedFixes.push(`Switched active account to ${best.index + 1} (best eligible).`);
								}
							} else {
								appliedFixes.push("No eligible account available for auto-switch.");
							}
						} catch (error) {
							fixErrors.push(
								`Auto-switch evaluation failed: ${
									error instanceof Error ? error.message : String(error)
								}`,
							);
						}

						if (cachedAccountManager) {
							const reloadedManager = await AccountManager.loadFromDisk();
							cachedAccountManager = reloadedManager;
							accountManagerPromise = Promise.resolve(reloadedManager);
						}
					}

					if (ui.v2Enabled) {
						const lines: string[] = [
							...formatUiHeader(ui, "Codex doctor"),
							formatUiKeyValue(ui, "Accounts", String(summary.total)),
							formatUiKeyValue(ui, "Healthy", String(summary.healthy), summary.healthy > 0 ? "success" : "warning"),
							formatUiKeyValue(ui, "Blocked", String(summary.blocked), summary.blocked > 0 ? "warning" : "muted"),
							formatUiKeyValue(ui, "Failure rate", runtime.totalRequests > 0 ? `${Math.round((runtime.failedRequests / runtime.totalRequests) * 100)}%` : "0%"),
							"",
							...formatUiSection(ui, "Findings"),
						];

						for (const finding of findings) {
							const tone =
								finding.severity === "ok"
									? "success"
									: finding.severity === "warning"
										? "warning"
										: "danger";
							lines.push(
								formatUiItem(
									ui,
									`${formatDoctorSeverity(ui, finding.severity)} ${finding.summary}`,
									tone,
								),
							);
							lines.push(`  ${formatUiKeyValue(ui, "fix", finding.action, "muted")}`);
						}

						lines.push("");
						lines.push(...formatUiSection(ui, "Recommended next step"));
						lines.push(formatUiItem(ui, nextAction, "accent"));
						if (fix) {
							lines.push("");
							lines.push(...formatUiSection(ui, "Auto-fix"));
							if (appliedFixes.length === 0) {
								lines.push(formatUiItem(ui, "No safe fixes were applied.", "muted"));
							} else {
								for (const entry of appliedFixes) {
									lines.push(formatUiItem(ui, entry, "success"));
								}
							}
							for (const error of fixErrors) {
								lines.push(formatUiItem(ui, error, "warning"));
							}
						}

						if (deep) {
							lines.push("");
							lines.push(...formatUiSection(ui, "Technical snapshot"));
							lines.push(formatUiKeyValue(ui, "Storage", getStoragePath(), "muted"));
							lines.push(
								formatUiKeyValue(
									ui,
									"Runtime failures",
									`failed=${runtime.failedRequests}, rateLimited=${runtime.rateLimitedResponses}, authRefreshFailed=${runtime.authRefreshFailures}, server=${runtime.serverErrors}, network=${runtime.networkErrors}`,
									"muted",
								),
							);
						}

						return lines.join("\n");
					}

					const lines: string[] = [
						"Codex Doctor:",
						`Accounts: ${summary.total} (healthy=${summary.healthy}, blocked=${summary.blocked})`,
						`Failure rate: ${runtime.totalRequests > 0 ? Math.round((runtime.failedRequests / runtime.totalRequests) * 100) : 0}%`,
						"",
						"Findings:",
					];
					for (const finding of findings) {
						lines.push(`  ${formatDoctorSeverityText(finding.severity)} ${finding.summary}`);
						lines.push(`      fix: ${finding.action}`);
					}
					lines.push("");
					lines.push(`Recommended next step: ${nextAction}`);
					if (fix) {
						lines.push("");
						lines.push("Auto-fix:");
						if (appliedFixes.length === 0) {
							lines.push("  - No safe fixes were applied.");
						} else {
							for (const entry of appliedFixes) {
								lines.push(`  - ${entry}`);
							}
						}
						for (const error of fixErrors) {
							lines.push(`  - warning: ${error}`);
						}
					}
					if (deep) {
						lines.push("");
						lines.push("Technical snapshot:");
						lines.push(`  Storage: ${getStoragePath()}`);
						lines.push(
							`  Runtime failures: failed=${runtime.failedRequests}, rateLimited=${runtime.rateLimitedResponses}, authRefreshFailed=${runtime.authRefreshFailures}, server=${runtime.serverErrors}, network=${runtime.networkErrors}`,
						);
					}
					return lines.join("\n");
				},
			}),
			"codex-next": tool({
				description: "Show the single most recommended next action for beginners.",
				args: {},
				async execute() {
					const ui = resolveUiRuntime();
					const storage = await loadAccounts();
					const now = Date.now();
					const activeIndex =
						storage && storage.accounts.length > 0
							? resolveActiveIndex(storage, "codex")
							: 0;
					const snapshots = storage
						? toBeginnerAccountSnapshots(storage, activeIndex, now)
						: [];
					const action = recommendBeginnerNextAction({
						accounts: snapshots,
						now,
						runtime: getBeginnerRuntimeSnapshot(),
					});
					if (ui.v2Enabled) {
						return [
							...formatUiHeader(ui, "Recommended next action"),
							"",
							formatUiItem(ui, action, "accent"),
						].join("\n");
					}
					return `Recommended next action:\n${action}`;
				},
			}),
			"codex-label": tool({
				description: "Set or clear a beginner-friendly display label for an account (interactive picker when index is omitted).",
				args: {
					index: tool.schema.number().optional().describe(
						"Account number to update (1-based, e.g., 1 for first account)",
					),
					label: tool.schema.string().describe(
						"Display label. Use an empty string to clear (e.g., Work, Personal, Team A)",
					),
				},
				async execute({ index, label }: { index?: number; label: string }) {
					const ui = resolveUiRuntime();
					const storage = await loadAccounts();
					if (!storage || storage.accounts.length === 0) {
						if (ui.v2Enabled) {
							return [
								...formatUiHeader(ui, "Set account label"),
								"",
								formatUiItem(ui, "No accounts configured.", "warning"),
								formatUiItem(ui, "Run: opencode auth login", "accent"),
							].join("\n");
						}
						return "No Codex accounts configured. Run: opencode auth login";
					}

					let resolvedIndex = index;
					if (resolvedIndex === undefined) {
						const selectedIndex = await promptAccountIndexSelection(ui, storage, "Set account label");
						if (selectedIndex === null) {
							if (supportsInteractiveMenus()) {
								if (ui.v2Enabled) {
									return [
										...formatUiHeader(ui, "Set account label"),
										"",
										formatUiItem(ui, "No account selected.", "warning"),
										formatUiItem(ui, "Run again and pick an account, or pass codex-label index=2 label=\"Work\".", "muted"),
									].join("\n");
								}
								return "No account selected.";
							}
							if (ui.v2Enabled) {
								return [
									...formatUiHeader(ui, "Set account label"),
									"",
									formatUiItem(ui, "Missing account number.", "warning"),
									formatUiItem(ui, "Use: codex-label index=2 label=\"Work\"", "accent"),
								].join("\n");
							}
							return "Missing account number. Use: codex-label index=2 label=\"Work\"";
						}
						resolvedIndex = selectedIndex + 1;
					}

					const targetIndex = Math.floor((resolvedIndex ?? 0) - 1);
					if (
						!Number.isFinite(targetIndex) ||
						targetIndex < 0 ||
						targetIndex >= storage.accounts.length
					) {
						if (ui.v2Enabled) {
							return [
								...formatUiHeader(ui, "Set account label"),
								"",
								formatUiItem(ui, `Invalid account number: ${resolvedIndex}`, "danger"),
								formatUiKeyValue(ui, "Valid range", `1-${storage.accounts.length}`, "muted"),
							].join("\n");
						}
						return `Invalid account number: ${resolvedIndex}\n\nValid range: 1-${storage.accounts.length}`;
					}

					const normalizedLabel = (label ?? "").trim().replace(/\s+/g, " ");
					if (normalizedLabel.length > 60) {
						if (ui.v2Enabled) {
							return [
								...formatUiHeader(ui, "Set account label"),
								"",
								formatUiItem(ui, "Label is too long (max 60 characters).", "danger"),
							].join("\n");
						}
						return "Label is too long (max 60 characters).";
					}

					const account = storage.accounts[targetIndex];
					if (!account) {
						return `Account ${resolvedIndex} not found.`;
					}

					const previousLabel = account.accountLabel?.trim() ?? "";
					if (normalizedLabel.length === 0) {
						delete account.accountLabel;
					} else {
						account.accountLabel = normalizedLabel;
					}

					try {
						await saveAccounts(storage);
					} catch (saveError) {
						logWarn("Failed to save account label update", { error: String(saveError) });
						if (ui.v2Enabled) {
							return [
								...formatUiHeader(ui, "Set account label"),
								"",
								formatUiItem(ui, "Label updated in memory but failed to persist.", "danger"),
							].join("\n");
						}
						return "Label updated in memory but failed to persist. Changes may be lost on restart.";
					}

					if (cachedAccountManager) {
						const reloadedManager = await AccountManager.loadFromDisk();
						cachedAccountManager = reloadedManager;
						accountManagerPromise = Promise.resolve(reloadedManager);
					}

					const accountLabel = formatCommandAccountLabel(account, targetIndex);
					if (ui.v2Enabled) {
						const statusText =
							normalizedLabel.length === 0
								? `Cleared label for ${accountLabel}`
								: `Set label for ${accountLabel} to "${normalizedLabel}"`;
						const previousText =
							previousLabel.length > 0
								? formatUiKeyValue(ui, "Previous label", previousLabel, "muted")
								: formatUiKeyValue(ui, "Previous label", "none", "muted");
						return [
							...formatUiHeader(ui, "Set account label"),
							"",
							formatUiItem(ui, `${getStatusMarker(ui, "ok")} ${statusText}`, "success"),
							previousText,
						].join("\n");
					}

					if (normalizedLabel.length === 0) {
						return `Cleared label for ${accountLabel}`;
					}
					return `Set label for ${accountLabel} to "${normalizedLabel}"`;
				},
			}),
			"codex-tag": tool({
				description: "Set or clear account tags for filtering and grouping.",
				args: {
					index: tool.schema.number().optional().describe(
						"Account number to update (1-based, e.g., 1 for first account)",
					),
					tags: tool.schema.string().describe(
						"Comma-separated tags (e.g., work,team-a). Empty string clears tags.",
					),
				},
				async execute({ index, tags }: { index?: number; tags: string }) {
					const ui = resolveUiRuntime();
					const storage = await loadAccounts();
					if (!storage || storage.accounts.length === 0) {
						if (ui.v2Enabled) {
							return [
								...formatUiHeader(ui, "Set account tags"),
								"",
								formatUiItem(ui, "No accounts configured.", "warning"),
								formatUiItem(ui, "Run: opencode auth login", "accent"),
							].join("\n");
						}
						return "No Codex accounts configured. Run: opencode auth login";
					}

					let resolvedIndex = index;
					if (resolvedIndex === undefined) {
						const selectedIndex = await promptAccountIndexSelection(ui, storage, "Set account tags");
						if (selectedIndex === null) {
							if (supportsInteractiveMenus()) {
								return ui.v2Enabled
									? [
											...formatUiHeader(ui, "Set account tags"),
											"",
											formatUiItem(ui, "No account selected.", "warning"),
									  ].join("\n")
									: "No account selected.";
							}
							return "Missing account number. Use: codex-tag index=2 tags=\"work,team-a\"";
						}
						resolvedIndex = selectedIndex + 1;
					}

					const targetIndex = Math.floor((resolvedIndex ?? 0) - 1);
					if (
						!Number.isFinite(targetIndex) ||
						targetIndex < 0 ||
						targetIndex >= storage.accounts.length
					) {
						return `Invalid account number: ${resolvedIndex}\n\nValid range: 1-${storage.accounts.length}`;
					}

					const account = storage.accounts[targetIndex];
					if (!account) return `Account ${resolvedIndex} not found.`;
					const normalizedTags = normalizeAccountTags(tags ?? "");
					const previousTags = Array.isArray(account.accountTags)
						? [...account.accountTags]
						: [];
					if (normalizedTags.length === 0) {
						delete account.accountTags;
					} else {
						account.accountTags = normalizedTags;
					}

					try {
						await saveAccounts(storage);
					} catch (error) {
						logWarn("Failed to save account tag update", { error: String(error) });
						return "Tag update failed to persist. Changes may be lost on restart.";
					}

					if (cachedAccountManager) {
						const reloadedManager = await AccountManager.loadFromDisk();
						cachedAccountManager = reloadedManager;
						accountManagerPromise = Promise.resolve(reloadedManager);
					}

					const accountLabel = formatCommandAccountLabel(account, targetIndex);
					const previousText = previousTags.length > 0 ? previousTags.join(", ") : "none";
					const nextText = normalizedTags.length > 0 ? normalizedTags.join(", ") : "none";
					if (ui.v2Enabled) {
						return [
							...formatUiHeader(ui, "Set account tags"),
							"",
							formatUiItem(ui, `${getStatusMarker(ui, "ok")} Updated tags for ${accountLabel}`, "success"),
							formatUiKeyValue(ui, "Previous tags", previousText, "muted"),
							formatUiKeyValue(ui, "Current tags", nextText, normalizedTags.length > 0 ? "accent" : "muted"),
						].join("\n");
					}
					return `Updated tags for ${accountLabel}\nPrevious tags: ${previousText}\nCurrent tags: ${nextText}`;
				},
			}),
			"codex-note": tool({
				description: "Set or clear an account note for reminders.",
				args: {
					index: tool.schema.number().optional().describe(
						"Account number to update (1-based, e.g., 1 for first account)",
					),
					note: tool.schema.string().describe(
						"Short note. Empty string clears the note.",
					),
				},
				async execute({ index, note }: { index?: number; note: string }) {
					const ui = resolveUiRuntime();
					const storage = await loadAccounts();
					if (!storage || storage.accounts.length === 0) {
						return "No Codex accounts configured. Run: opencode auth login";
					}

					let resolvedIndex = index;
					if (resolvedIndex === undefined) {
						const selectedIndex = await promptAccountIndexSelection(ui, storage, "Set account note");
						if (selectedIndex === null) {
							if (supportsInteractiveMenus()) return "No account selected.";
							return "Missing account number. Use: codex-note index=2 note=\"weekday primary\"";
						}
						resolvedIndex = selectedIndex + 1;
					}

					const targetIndex = Math.floor((resolvedIndex ?? 0) - 1);
					if (
						!Number.isFinite(targetIndex) ||
						targetIndex < 0 ||
						targetIndex >= storage.accounts.length
					) {
						return `Invalid account number: ${resolvedIndex}\n\nValid range: 1-${storage.accounts.length}`;
					}

					const account = storage.accounts[targetIndex];
					if (!account) return `Account ${resolvedIndex} not found.`;

					const normalizedNote = (note ?? "").trim();
					if (normalizedNote.length > 240) {
						return "Note is too long (max 240 characters).";
					}

					if (normalizedNote.length === 0) {
						delete account.accountNote;
					} else {
						account.accountNote = normalizedNote;
					}

					try {
						await saveAccounts(storage);
					} catch (error) {
						logWarn("Failed to save account note update", { error: String(error) });
						return "Note update failed to persist. Changes may be lost on restart.";
					}

					if (cachedAccountManager) {
						const reloadedManager = await AccountManager.loadFromDisk();
						cachedAccountManager = reloadedManager;
						accountManagerPromise = Promise.resolve(reloadedManager);
					}

					const accountLabel = formatCommandAccountLabel(account, targetIndex);
					if (normalizedNote.length === 0) {
						return `Cleared note for ${accountLabel}`;
					}
					return `Saved note for ${accountLabel}: ${normalizedNote}`;
				},
			}),
			"codex-dashboard": tool({
				description:
					"Show a live Codex dashboard: account eligibility, retry budgets, and refresh queue health.",
				args: {},
				async execute() {
					const ui = resolveUiRuntime();
					const storage = await loadAccounts();
					if (!storage || storage.accounts.length === 0) {
						if (ui.v2Enabled) {
							return [
								...formatUiHeader(ui, "Codex dashboard"),
								"",
								formatUiItem(ui, "No accounts configured.", "warning"),
								formatUiItem(ui, "Run: opencode auth login", "accent"),
							].join("\n");
						}
						return "No Codex accounts configured. Run: opencode auth login";
					}

					const now = Date.now();
					const refreshMetrics = getRefreshQueueMetrics();
					const family = runtimeMetrics.lastSelectionSnapshot?.family ?? "codex";
					const model = runtimeMetrics.lastSelectionSnapshot?.model ?? undefined;
					const manager = cachedAccountManager ?? (await AccountManager.loadFromDisk());
					const explainability = manager.getSelectionExplainability(family, model, now);
					const selectionLabel = model ? `${family}:${model}` : family;

					if (ui.v2Enabled) {
						const lines: string[] = [
							...formatUiHeader(ui, "Codex dashboard"),
							formatUiKeyValue(ui, "Accounts", String(storage.accounts.length)),
							formatUiKeyValue(ui, "Selection lens", selectionLabel, "muted"),
							formatUiKeyValue(ui, "Retry profile", runtimeMetrics.retryProfile, "muted"),
							formatUiKeyValue(ui, "Beginner safe mode", beginnerSafeModeEnabled ? "on" : "off", beginnerSafeModeEnabled ? "accent" : "muted"),
							formatUiKeyValue(
								ui,
								"Retry usage",
								`A${runtimeMetrics.retryBudgetUsage.authRefresh} N${runtimeMetrics.retryBudgetUsage.network} S${runtimeMetrics.retryBudgetUsage.server} RS${runtimeMetrics.retryBudgetUsage.rateLimitShort} RG${runtimeMetrics.retryBudgetUsage.rateLimitGlobal} E${runtimeMetrics.retryBudgetUsage.emptyResponse}`,
								"muted",
							),
							formatUiKeyValue(
								ui,
								"Refresh queue",
								`pending=${refreshMetrics.pending}, success=${refreshMetrics.succeeded}, failed=${refreshMetrics.failed}`,
								"muted",
							),
							"",
							...formatUiSection(ui, "Account eligibility"),
						];

						for (const entry of explainability) {
							const label = formatCommandAccountLabel(storage.accounts[entry.index], entry.index);
							const state = entry.eligible ? formatUiBadge(ui, "eligible", "success") : formatUiBadge(ui, "blocked", "warning");
							lines.push(
								formatUiItem(
									ui,
									`${label} ${state} health=${Math.round(entry.healthScore)} tokens=${entry.tokensAvailable.toFixed(1)} reasons=${entry.reasons.join(", ")}`,
								),
							);
						}

						lines.push("");
						lines.push(...formatUiSection(ui, "Recommended next step"));
						lines.push(
							formatUiItem(
								ui,
								recommendBeginnerNextAction({
									accounts: toBeginnerAccountSnapshots(storage, resolveActiveIndex(storage, "codex"), now),
									now,
									runtime: getBeginnerRuntimeSnapshot(),
								}),
								"accent",
							),
						);

						if (runtimeMetrics.lastError) {
							lines.push("");
							lines.push(...formatUiSection(ui, "Last error"));
							lines.push(formatUiItem(ui, runtimeMetrics.lastError, "danger"));
							if (runtimeMetrics.lastErrorCategory) {
								lines.push(
									formatUiKeyValue(ui, "Category", runtimeMetrics.lastErrorCategory, "warning"),
								);
							}
						}

						return lines.join("\n");
					}

					const lines: string[] = [
						"Codex Dashboard:",
						`Accounts: ${storage.accounts.length}`,
						`Selection lens: ${selectionLabel}`,
						`Retry profile: ${runtimeMetrics.retryProfile}`,
						`Beginner safe mode: ${beginnerSafeModeEnabled ? "on" : "off"}`,
						`Retry usage: auth=${runtimeMetrics.retryBudgetUsage.authRefresh}, network=${runtimeMetrics.retryBudgetUsage.network}, server=${runtimeMetrics.retryBudgetUsage.server}, short429=${runtimeMetrics.retryBudgetUsage.rateLimitShort}, global429=${runtimeMetrics.retryBudgetUsage.rateLimitGlobal}, empty=${runtimeMetrics.retryBudgetUsage.emptyResponse}`,
						`Refresh queue: pending=${refreshMetrics.pending}, success=${refreshMetrics.succeeded}, failed=${refreshMetrics.failed}`,
						"",
						"Account eligibility:",
					];

					for (const entry of explainability) {
						const label = formatCommandAccountLabel(storage.accounts[entry.index], entry.index);
						lines.push(
							`  - ${label}: ${entry.eligible ? "eligible" : "blocked"} | health=${Math.round(entry.healthScore)} | tokens=${entry.tokensAvailable.toFixed(1)} | reasons=${entry.reasons.join(", ")}`,
						);
					}

					lines.push("");
					lines.push(
						`Recommended next step: ${recommendBeginnerNextAction({
							accounts: toBeginnerAccountSnapshots(storage, resolveActiveIndex(storage, "codex"), now),
							now,
							runtime: getBeginnerRuntimeSnapshot(),
						})}`,
					);

					if (runtimeMetrics.lastError) {
						lines.push("");
						lines.push(`Last error: ${runtimeMetrics.lastError}`);
						if (runtimeMetrics.lastErrorCategory) {
							lines.push(`Category: ${runtimeMetrics.lastErrorCategory}`);
						}
					}

					return lines.join("\n");
				},
			}),
				"codex-health": tool({
				description: "Check health of all Codex accounts by validating refresh tokens.",
				args: {},
				async execute() {
					const ui = resolveUiRuntime();
					const storage = await loadAccounts();
					if (!storage || storage.accounts.length === 0) {
						if (ui.v2Enabled) {
							return [
								...formatUiHeader(ui, "Health check"),
								"",
								formatUiItem(ui, "No accounts configured.", "warning"),
								formatUiItem(ui, "Run: opencode auth login", "accent"),
							].join("\n");
						}
						return "No Codex accounts configured. Run: opencode auth login";
					}

					const results: string[] = ui.v2Enabled
						? []
						: [`Health Check (${storage.accounts.length} accounts):`, ""];

					let healthyCount = 0;
					let unhealthyCount = 0;

					for (let i = 0; i < storage.accounts.length; i++) {
						const account = storage.accounts[i];
						if (!account) continue;

						const label = formatCommandAccountLabel(account, i);
						try {
				const refreshResult = await queuedRefresh(account.refreshToken);
							if (refreshResult.type === "success") {
								results.push(`  ${getStatusMarker(ui, "ok")} ${label}: Healthy`);
								healthyCount++;
							} else {
								results.push(`  ${getStatusMarker(ui, "error")} ${label}: Token refresh failed`);
								unhealthyCount++;
							}
						} catch (error) {
							const errorMsg = error instanceof Error ? error.message : String(error);
							results.push(`  ${getStatusMarker(ui, "error")} ${label}: Error - ${errorMsg.slice(0, 120)}`);
							unhealthyCount++;
						}
					}

					results.push("");
					results.push(`Summary: ${healthyCount} healthy, ${unhealthyCount} unhealthy`);

					if (ui.v2Enabled) {
						return [
							...formatUiHeader(ui, "Health check"),
							"",
							...results.map((line) => paintUiText(ui, line, "normal")),
						].join("\n");
					}

					return results.join("\n");
				},
			}),
			"codex-remove": tool({
				description: "Remove one Codex account entry by index (1-based) or interactive picker when index is omitted.",
				args: {
					index: tool.schema.number().optional().describe(
						"Account number to remove (1-based, e.g., 1 for first account)",
					),
				},
				async execute({ index }: { index?: number } = {}) {
					const ui = resolveUiRuntime();
					const storage = await loadAccounts();
					if (!storage || storage.accounts.length === 0) {
						if (ui.v2Enabled) {
							return [
								...formatUiHeader(ui, "Remove account"),
								"",
								formatUiItem(ui, "No accounts configured.", "warning"),
							].join("\n");
						}
						return "No Codex accounts configured. Nothing to remove.";
					}

					let resolvedIndex = index;
					if (resolvedIndex === undefined) {
						const selectedIndex = await promptAccountIndexSelection(ui, storage, "Remove account");
						if (selectedIndex === null) {
							if (supportsInteractiveMenus()) {
								if (ui.v2Enabled) {
									return [
										...formatUiHeader(ui, "Remove account"),
										"",
										formatUiItem(ui, "No account selected.", "warning"),
										formatUiItem(ui, "Run again and pick an account, or pass codex-remove index=2.", "muted"),
									].join("\n");
								}
								return "No account selected.";
							}
							if (ui.v2Enabled) {
								return [
									...formatUiHeader(ui, "Remove account"),
									"",
									formatUiItem(ui, "Missing account number.", "warning"),
									formatUiItem(ui, "Use: codex-remove index=2", "accent"),
								].join("\n");
							}
							return "Missing account number. Use: codex-remove index=2";
						}
						resolvedIndex = selectedIndex + 1;
					}

					const targetIndex = Math.floor((resolvedIndex ?? 0) - 1);
					if (
						!Number.isFinite(targetIndex) ||
						targetIndex < 0 ||
						targetIndex >= storage.accounts.length
					) {
						if (ui.v2Enabled) {
							return [
								...formatUiHeader(ui, "Remove account"),
								"",
								formatUiItem(ui, `Invalid account number: ${resolvedIndex}`, "danger"),
								formatUiKeyValue(ui, "Valid range", `1-${storage.accounts.length}`, "muted"),
								formatUiItem(ui, "Use codex-list to list all accounts.", "accent"),
							].join("\n");
						}
						return `Invalid account number: ${resolvedIndex}\n\nValid range: 1-${storage.accounts.length}\n\nUse codex-list to list all accounts.`;
					}

					const account = storage.accounts[targetIndex];
					if (!account) {
						return `Account ${resolvedIndex} not found.`;
					}

					const label = formatCommandAccountLabel(account, targetIndex);

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

					try {
					await saveAccounts(storage);
				} catch (saveError) {
					logWarn("Failed to save account removal", { error: String(saveError) });
					if (ui.v2Enabled) {
						return [
							...formatUiHeader(ui, "Remove account"),
							"",
							formatUiItem(ui, `Removed selected entry: ${label}`, "warning"),
							formatUiItem(ui, "Only the selected index was changed.", "muted"),
							formatUiItem(ui, "Failed to persist. Change may be lost on restart.", "danger"),
						].join("\n");
					}
					return `Removed selected entry: ${label} from memory, but failed to persist. Only the selected index was changed and this may be lost on restart.`;
				}

					if (cachedAccountManager) {
						const reloadedManager = await AccountManager.loadFromDisk();
						cachedAccountManager = reloadedManager;
						accountManagerPromise = Promise.resolve(reloadedManager);
					}

					const remaining = storage.accounts.length;
					const matchingEmailRemaining =
						account.email?.trim()
							? storage.accounts.filter((entry) => entry.email === account.email).length
							: 0;
					if (ui.v2Enabled) {
						const postRemoveHint =
							matchingEmailRemaining > 0 && account.email
								? formatUiItem(
										ui,
										`Other entries for ${account.email} remain: ${matchingEmailRemaining}`,
										"muted",
								  )
								: formatUiItem(ui, "Only the selected entry was removed.", "muted");
						return [
							...formatUiHeader(ui, "Remove account"),
							"",
							formatUiItem(ui, `${getStatusMarker(ui, "ok")} Removed selected entry: ${label}`, "success"),
							postRemoveHint,
							remaining > 0
								? formatUiKeyValue(ui, "Remaining accounts", String(remaining))
								: formatUiItem(ui, "No accounts remaining. Run: opencode auth login", "warning"),
						].join("\n");
					}
					const postRemoveHint =
						matchingEmailRemaining > 0 && account.email
							? `Other entries for ${account.email} remain: ${matchingEmailRemaining}`
							: "Only the selected entry was removed.";
					return [
						`Removed selected entry: ${label}`,
						postRemoveHint,
						"",
						remaining > 0
							? `Remaining accounts: ${remaining}`
							: "No accounts remaining. Run: opencode auth login",
					].join("\n");
				},
			}),

			"codex-refresh": tool({
				description: "Manually refresh OAuth tokens for all accounts to verify they're still valid.",
				args: {},
				async execute() {
					const ui = resolveUiRuntime();
					const storage = await loadAccounts();
					if (!storage || storage.accounts.length === 0) {
						if (ui.v2Enabled) {
							return [
								...formatUiHeader(ui, "Refresh accounts"),
								"",
								formatUiItem(ui, "No accounts configured.", "warning"),
								formatUiItem(ui, "Run: opencode auth login", "accent"),
							].join("\n");
						}
						return "No Codex accounts configured. Run: opencode auth login";
					}

					const results: string[] = ui.v2Enabled
						? []
						: [`Refreshing ${storage.accounts.length} account(s):`, ""];

					let refreshedCount = 0;
					let failedCount = 0;

					for (let i = 0; i < storage.accounts.length; i++) {
						const account = storage.accounts[i];
						if (!account) continue;
						const label = formatCommandAccountLabel(account, i);

						try {
							const refreshResult = await queuedRefresh(account.refreshToken);
							if (refreshResult.type === "success") {
								account.refreshToken = refreshResult.refresh;
								account.accessToken = refreshResult.access;
								account.expiresAt = refreshResult.expires;
								results.push(`  ${getStatusMarker(ui, "ok")} ${label}: Refreshed`);
								refreshedCount++;
							} else {
								results.push(`  ${getStatusMarker(ui, "error")} ${label}: Failed - ${refreshResult.message ?? refreshResult.reason}`);
								failedCount++;
							}
						} catch (error) {
							const errorMsg = error instanceof Error ? error.message : String(error);
							results.push(`  ${getStatusMarker(ui, "error")} ${label}: Error - ${errorMsg.slice(0, 120)}`);
							failedCount++;
						}
					}

				await saveAccounts(storage);
				if (cachedAccountManager) {
					const reloadedManager = await AccountManager.loadFromDisk();
					cachedAccountManager = reloadedManager;
					accountManagerPromise = Promise.resolve(reloadedManager);
				}
				results.push("");
				results.push(`Summary: ${refreshedCount} refreshed, ${failedCount} failed`);
				if (ui.v2Enabled) {
					return [
						...formatUiHeader(ui, "Refresh accounts"),
						"",
						...results.map((line) => paintUiText(ui, line, "normal")),
					].join("\n");
				}
				return results.join("\n");
			},
		}),

		"codex-export": tool({
			description: "Export accounts to a JSON file for backup or migration. Can auto-generate timestamped backup paths.",
			args: {
				path: tool.schema.string().optional().describe(
					"File path to export to (e.g., ~/codex-backup.json). If omitted, a timestamped backup path is used."
				),
				force: tool.schema.boolean().optional().describe(
					"Overwrite existing file (default: true)"
				),
				timestamped: tool.schema.boolean().optional().describe(
					"When true (default), omitted paths use a timestamped backup filename."
				),
			},
			async execute({
				path: filePath,
				force,
				timestamped,
			}: {
				path?: string;
				force?: boolean;
				timestamped?: boolean;
			}) {
				const ui = resolveUiRuntime();
				const shouldTimestamp = timestamped ?? true;
				const resolvedExportPath =
					filePath && filePath.trim().length > 0
						? filePath
						: shouldTimestamp
							? createTimestampedBackupPath()
							: "codex-backup.json";
				try {
					await exportAccounts(resolvedExportPath, force ?? true);
					const storage = await loadAccounts();
					const count = storage?.accounts.length ?? 0;
					if (ui.v2Enabled) {
						return [
							...formatUiHeader(ui, "Export accounts"),
							"",
							formatUiItem(ui, `${getStatusMarker(ui, "ok")} Exported ${count} account(s)`, "success"),
							formatUiKeyValue(ui, "Path", resolvedExportPath, "muted"),
						].join("\n");
					}
					return `Exported ${count} account(s) to: ${resolvedExportPath}`;
				} catch (error) {
					const msg = error instanceof Error ? error.message : String(error);
					if (ui.v2Enabled) {
						return [
							...formatUiHeader(ui, "Export accounts"),
							"",
							formatUiItem(ui, `${getStatusMarker(ui, "error")} Export failed`, "danger"),
							formatUiKeyValue(ui, "Error", msg, "danger"),
						].join("\n");
					}
					return `Export failed: ${msg}`;
				}
			},
		}),

		"codex-import": tool({
			description: "Import accounts from a JSON file, with dry-run preview and automatic timestamped backup before apply.",
			args: {
				path: tool.schema.string().describe(
					"File path to import from (e.g., ~/codex-backup.json)"
				),
				dryRun: tool.schema.boolean().optional().describe(
					"Preview import impact without applying changes."
				),
			},
			async execute({ path: filePath, dryRun }: { path: string; dryRun?: boolean }) {
				const ui = resolveUiRuntime();
				try {
					const preview = await previewImportAccounts(filePath);
					if (dryRun) {
						if (ui.v2Enabled) {
							return [
								...formatUiHeader(ui, "Import preview"),
								"",
								formatUiItem(ui, "No changes applied (dry run).", "warning"),
								formatUiKeyValue(ui, "Path", filePath, "muted"),
								formatUiKeyValue(ui, "New accounts", String(preview.imported), preview.imported > 0 ? "success" : "muted"),
								formatUiKeyValue(ui, "Duplicates skipped", String(preview.skipped), preview.skipped > 0 ? "warning" : "muted"),
								formatUiKeyValue(ui, "Resulting total", String(preview.total), "accent"),
							].join("\n");
						}
						return [
							"Import preview (dry run):",
							`Path: ${filePath}`,
							`New accounts: ${preview.imported}`,
							`Duplicates skipped: ${preview.skipped}`,
							`Resulting total: ${preview.total}`,
						].join("\n");
					}

					const result = await importAccounts(filePath, {
						preImportBackupPrefix: "codex-pre-import-backup",
						backupMode: "required",
					});
					const backupSummary =
						result.backupStatus === "created"
							? result.backupPath ?? "created"
							: result.backupStatus === "failed"
								? `failed (${result.backupError ?? "unknown error"})`
								: "skipped (no existing accounts)";
					const backupStatus: "ok" | "warning" =
						result.backupStatus === "created" ? "ok" : "warning";
					invalidateAccountManagerCache();
					const lines = [`Import complete.`, ``];
					lines.push(`Preview: +${preview.imported} new, ${preview.skipped} skipped, ${preview.total} total`);
					lines.push(`Auto-backup: ${backupSummary}`);
					if (result.imported > 0) {
						lines.push(`New accounts: ${result.imported}`);
					}
					if (result.skipped > 0) {
						lines.push(`Duplicates skipped: ${result.skipped}`);
					}
					lines.push(`Total accounts: ${result.total}`);
					if (ui.v2Enabled) {
						const styled = [
							...formatUiHeader(ui, "Import accounts"),
							"",
							formatUiItem(ui, `${getStatusMarker(ui, "ok")} Import complete`, "success"),
							formatUiKeyValue(ui, "Path", filePath, "muted"),
							formatUiKeyValue(
								ui,
								"Auto-backup",
								backupSummary,
								backupStatus === "ok" ? "muted" : "warning",
							),
							formatUiKeyValue(ui, "Preview", `+${preview.imported}, skipped=${preview.skipped}, total=${preview.total}`, "muted"),
							formatUiKeyValue(ui, "New accounts", String(result.imported), result.imported > 0 ? "success" : "muted"),
							formatUiKeyValue(ui, "Duplicates skipped", String(result.skipped), result.skipped > 0 ? "warning" : "muted"),
							formatUiKeyValue(ui, "Total accounts", String(result.total), "accent"),
						];
						return styled.join("\n");
					}
					return lines.join("\n");
				} catch (error) {
					const msg = error instanceof Error ? error.message : String(error);
					if (ui.v2Enabled) {
						return [
							...formatUiHeader(ui, "Import accounts"),
							"",
							formatUiItem(ui, `${getStatusMarker(ui, "error")} Import failed`, "danger"),
							formatUiKeyValue(ui, "Error", msg, "danger"),
						].join("\n");
					}
					return `Import failed: ${msg}`;
				}
			},
		}),

	},
	};
};

export const OpenAIAuthPlugin = OpenAIOAuthPlugin;

export default OpenAIOAuthPlugin;
