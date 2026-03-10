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
import { promises as fsPromises } from "node:fs";
import { createInterface } from "node:readline/promises";
import { dirname } from "node:path";
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
import { promptAddAnotherAccount, promptCodexMultiAuthSyncPrune, promptLoginMode } from "./lib/cli.js";
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
	getSyncFromCodexMultiAuthEnabled,
	loadPluginConfig,
	setSyncFromCodexMultiAuthEnabled,
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
	cleanupDuplicateEmailAccounts,
	previewDuplicateEmailCleanup,
	clearAccounts,
	setStoragePath,
	backupRawAccountsFile,
	exportAccounts,
	importAccounts,
	previewImportAccounts,
	createTimestampedBackupPath,
	loadFlaggedAccounts,
	loadAccountAndFlaggedStorageSnapshot,
	saveFlaggedAccounts,
	clearFlaggedAccounts,
	StorageError,
	formatStorageErrorHint,
	normalizeAccountStorage,
	withFlaggedAccountsTransaction,
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
import { confirm } from "./lib/ui/confirm.js";
import { ANSI, ANSI_CSI_REGEX, CONTROL_CHAR_REGEX } from "./lib/ui/ansi.js";
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
import {
	CodexMultiAuthSyncCapacityError,
	cleanupCodexMultiAuthSyncedOverlaps,
	isCodexMultiAuthSourceTooLargeForCapacity,
	loadCodexMultiAuthSourceStorage,
	previewCodexMultiAuthSyncedOverlapCleanup,
	previewSyncFromCodexMultiAuth,
	syncFromCodexMultiAuth,
} from "./lib/codex-multi-auth-sync.js";
import { createSyncPruneBackupPayload } from "./lib/sync-prune-backup.js";

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
						byOrganizationId: Map<string, number[]>;
						byAccountIdNoOrg: Map<string, number>;
						byRefreshTokenNoOrg: Map<string, number[]>;
						byEmailNoOrg: Map<string, number>;
						byAccountIdOrgScoped: Map<string, number[]>;
						byRefreshTokenOrgScoped: Map<string, number[]>;
						byRefreshTokenGlobal: Map<string, number[]>;
					};

					const resolveOrganizationMatch = (
						indexes: IdentityIndexes,
						organizationId: string,
						candidateAccountId: string | undefined,
					): number | undefined => {
						const matches = indexes.byOrganizationId.get(organizationId);
						if (!matches || matches.length === 0) return undefined;

						const candidateId = candidateAccountId?.trim() || undefined;
						let newestNoAccountId: number | undefined;
						let newestExactAccountId: number | undefined;
						let newestAnyNonEmptyAccountId: number | undefined;
						const distinctNonEmptyAccountIds = new Set<string>();

						for (const index of matches) {
							const existing = accounts[index];
							if (!existing) continue;
							const existingAccountId = normalizeStoredAccountId(existing);
							if (!existingAccountId) {
								newestNoAccountId =
									typeof newestNoAccountId === "number"
										? pickNewestAccountIndex(newestNoAccountId, index)
										: index;
								continue;
							}
							distinctNonEmptyAccountIds.add(existingAccountId);
							newestAnyNonEmptyAccountId =
								typeof newestAnyNonEmptyAccountId === "number"
									? pickNewestAccountIndex(newestAnyNonEmptyAccountId, index)
									: index;
							if (candidateId && existingAccountId === candidateId) {
								newestExactAccountId =
									typeof newestExactAccountId === "number"
										? pickNewestAccountIndex(newestExactAccountId, index)
										: index;
							}
						}

						if (candidateId) {
							return newestExactAccountId ?? newestNoAccountId;
						}
						if (typeof newestNoAccountId === "number") {
							return newestNoAccountId;
						}
						if (distinctNonEmptyAccountIds.size === 1) {
							return newestAnyNonEmptyAccountId;
						}
						return undefined;
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

				if (accountId) {
					const accountMatches = indexes.byAccountIdOrgScoped.get(accountId);
					if (accountMatches && accountMatches.length > 1) {
						let newestRefreshMatch: number | undefined;
						for (const index of accountMatches) {
							const existing = accounts[index];
							if (!existing) continue;
							const existingRefresh = existing.refreshToken?.trim();
							if (!existingRefresh || existingRefresh !== refreshToken) {
								continue;
							}
							newestRefreshMatch =
								typeof newestRefreshMatch === "number"
									? pickNewestAccountIndex(newestRefreshMatch, index)
									: index;
						}
						if (typeof newestRefreshMatch === "number") {
							return newestRefreshMatch;
						}
					}
				}

				// Refresh-token-only fallback is allowed only when accountId is absent.
				// This avoids collapsing distinct workspace variants that share refresh token.
				if (accountId) return undefined;

						return asUniqueIndex(indexes.byRefreshTokenOrgScoped.get(refreshToken));
					};

					const buildIdentityIndexes = (): IdentityIndexes => {
						const byOrganizationId = new Map<string, number[]>();
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
								pushIndex(byOrganizationId, organizationId, i);
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
								return resolveOrganizationMatch(
									identityIndexes,
									organizationId,
									normalizedAccountId,
								);
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
				const exactIdentityToIndex = new Map<string, number>();

				const getExactIdentityKey = (
					account: {
						organizationId?: string;
						accountId?: string;
						email?: string;
						refreshToken?: string;
					} | undefined,
				): string => {
					const organizationId = account?.organizationId?.trim() ?? "";
					const accountId = normalizeStoredAccountId(account) ?? "";
					const email = account?.email?.trim().toLowerCase() ?? "";
					const refreshToken = account?.refreshToken?.trim() ?? "";
					if (organizationId || accountId) {
						return `org:${organizationId}|account:${accountId}|refresh:${refreshToken}`;
					}
					return `email:${email}|refresh:${refreshToken}`;
				};

				for (let i = 0; i < accounts.length; i += 1) {
					const account = accounts[i];
					if (!account) continue;

					const identityKey = getExactIdentityKey(account);
					const existingIndex = exactIdentityToIndex.get(identityKey);
					if (existingIndex === undefined) {
						exactIdentityToIndex.set(identityKey, i);
						continue;
					}

					const newestIndex = pickNewestAccountIndex(existingIndex, i);
					const obsoleteIndex = newestIndex === existingIndex ? i : existingIndex;
					mergeAccountRecords(newestIndex, obsoleteIndex);
					indicesToRemove.add(obsoleteIndex);
					exactIdentityToIndex.set(identityKey, newestIndex);
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

		const sanitizeScreenText = (value: string): string =>
			value.replace(ANSI_CSI_REGEX, "").replace(CONTROL_CHAR_REGEX, "").trim();
		type OperationTone = "normal" | "muted" | "success" | "warning" | "danger" | "accent";

		const styleOperationText = (
			ui: UiRuntimeOptions,
			text: string,
			tone: OperationTone,
		): string => {
			if (ui.v2Enabled) {
				return paintUiText(ui, text, tone);
			}
			const ansiCode =
				tone === "accent"
					? ANSI.cyan
					: tone === "success"
						? ANSI.green
						: tone === "warning"
							? ANSI.yellow
							: tone === "danger"
								? ANSI.red
								: tone === "muted"
									? ANSI.dim
									: "";
			return ansiCode ? `${ansiCode}${text}${ANSI.reset}` : text;
		};

		const isAbortError = (error: unknown): boolean => {
			if (!(error instanceof Error)) return false;
			const maybe = error as Error & { code?: string };
			return maybe.name === "AbortError" || maybe.code === "ABORT_ERR";
		};

		const waitForMenuReturn = async (
			ui: UiRuntimeOptions,
			options: {
				promptText?: string;
				autoReturnMs?: number;
				pauseOnAnyKey?: boolean;
			} = {},
		): Promise<void> => {
			if (!process.stdin.isTTY || !process.stdout.isTTY) {
				return;
			}

			const promptText = options.promptText ?? "Press Enter to return to the dashboard.";
			const autoReturnMs = options.autoReturnMs ?? 0;
			const pauseOnAnyKey = options.pauseOnAnyKey ?? true;

			try {
				let chunk: Buffer | string | null;
				do {
					chunk = process.stdin.read();
				} while (chunk !== null);
			} catch {
				// best effort drain
			}

			const writeInlineStatus = (message: string) => {
				process.stdout.write(`\r${ANSI.clearLine}${styleOperationText(ui, message, "muted")}`);
			};
			const clearInlineStatus = () => {
				process.stdout.write(`\r${ANSI.clearLine}`);
			};

			if (autoReturnMs > 0) {
				if (!pauseOnAnyKey) {
					await new Promise((resolve) => setTimeout(resolve, autoReturnMs));
					return;
				}

				const wasRaw = process.stdin.isRaw ?? false;
				const endAt = Date.now() + autoReturnMs;
				let lastShownSeconds: number | null = null;
				const renderCountdown = () => {
					const remainingMs = Math.max(0, endAt - Date.now());
					const remainingSeconds = Math.max(1, Math.ceil(remainingMs / 1000));
					if (lastShownSeconds === remainingSeconds) return;
					lastShownSeconds = remainingSeconds;
					writeInlineStatus(`Returning to dashboard in ${remainingSeconds}s. Press any key to pause.`);
				};

				renderCountdown();
				const pinned = await new Promise<boolean>((resolve) => {
					let done = false;
					const interval = setInterval(renderCountdown, 80);
					let timeout: NodeJS.Timeout | null = setTimeout(() => {
						timeout = null;
						if (!done) {
							done = true;
							cleanup();
							resolve(false);
						}
					}, autoReturnMs);
					const onData = () => {
						if (done) return;
						done = true;
						cleanup();
						resolve(true);
					};
					const cleanup = () => {
						clearInterval(interval);
						if (timeout) {
							clearTimeout(timeout);
							timeout = null;
						}
						process.stdin.removeListener("data", onData);
						try {
							process.stdin.setRawMode(wasRaw);
						} catch {
							// best effort restore
						}
					};

					try {
						process.stdin.setRawMode(true);
					} catch {
						// best effort
					}
					process.stdin.on("data", onData);
					process.stdin.resume();
				});

				clearInlineStatus();
				if (!pinned) {
					return;
				}

				writeInlineStatus("Paused. Press any key to return.");
				await new Promise<void>((resolve) => {
					const onData = () => {
						cleanup();
						resolve();
					};
					const cleanup = () => {
						process.stdin.removeListener("data", onData);
						try {
							process.stdin.setRawMode(wasRaw);
						} catch {
							// best effort restore
						}
					};

					try {
						process.stdin.setRawMode(true);
					} catch {
						// best effort fallback
					}
					process.stdin.on("data", onData);
					process.stdin.resume();
				});
				clearInlineStatus();
				return;
			}

			const rl = createInterface({
				input: process.stdin,
				output: process.stdout,
			});
			try {
				process.stdout.write(`\r${ANSI.clearLine}`);
				await rl.question(`${styleOperationText(ui, promptText, "muted")} `);
			} catch (error) {
				if (!isAbortError(error)) {
					throw error;
				}
			} finally {
				rl.close();
				clearInlineStatus();
			}
		};

		const createOperationScreen = (
			ui: UiRuntimeOptions,
			title: string,
			subtitle?: string,
		): {
			push: (line: string, tone?: OperationTone) => void;
			finish: (
				summaryLines?: Array<{ line: string; tone?: OperationTone }>,
				options?: { failed?: boolean },
			) => Promise<void>;
			abort: () => void;
		} | null => {
			if (!supportsInteractiveMenus()) {
				return null;
			}

			const entries: Array<{ line: string; tone: OperationTone }> = [];
			const spinnerFrames = ["-", "\\", "|", "/"];
			let frame = 0;
			let running = true;
			let failed = false;
			let initialized = false;
			let timer: NodeJS.Timeout | null = null;
			let closed = false;

			const dispose = () => {
				if (closed) return;
				closed = true;
				running = false;
				if (timer) {
					clearInterval(timer);
					timer = null;
				}
				process.stdout.write(ANSI.altScreenOff + ANSI.show + ANSI.clearScreen + ANSI.moveTo(1, 1));
			};

			const render = () => {
				const lines: string[] = [];
				const maxVisibleLines = Math.max(8, (process.stdout.rows ?? 24) - 8);
				const visibleEntries = entries.slice(-maxVisibleLines);
				const spinner = running
					? `${spinnerFrames[frame % spinnerFrames.length] ?? "-"} `
					: failed
						? "x "
						: "+ ";
				const stageTone: OperationTone = failed ? "danger" : running ? "accent" : "success";
				const stageText = running
					? `${spinner}${sanitizeScreenText(subtitle ?? "Working")}`
					: failed
						? "Action failed"
						: "Done";

				lines.push(styleOperationText(ui, sanitizeScreenText(title), "accent"));
				lines.push(styleOperationText(ui, stageText, stageTone));
				lines.push("");
				for (const entry of visibleEntries) {
					lines.push(styleOperationText(ui, sanitizeScreenText(entry.line), entry.tone));
				}
				for (let i = visibleEntries.length; i < maxVisibleLines; i += 1) {
					lines.push("");
				}
				lines.push("");
				if (running) lines.push(styleOperationText(ui, "Working...", "muted"));
				process.stdout.write(ANSI.clearScreen + ANSI.moveTo(1, 1) + lines.join("\n"));
				frame += 1;
			};

			const ensureScreen = () => {
				if (initialized) return;
				process.stdout.write(ANSI.altScreenOn + ANSI.hide + ANSI.clearScreen + ANSI.moveTo(1, 1));
				render();
				timer = setInterval(() => {
					if (!running) return;
					render();
				}, 120);
				initialized = true;
			};

			ensureScreen();
			return {
				push: (line: string, tone = "normal") => {
					ensureScreen();
					entries.push({ line: sanitizeScreenText(line), tone });
					render();
				},
				finish: async (summaryLines, options) => {
					ensureScreen();
					if (summaryLines && summaryLines.length > 0) {
						entries.push({ line: "", tone: "normal" });
						for (const entry of summaryLines) {
							entries.push({ line: sanitizeScreenText(entry.line), tone: entry.tone ?? "normal" });
						}
					}
					failed = options?.failed === true;
					running = false;
					if (timer) {
						clearInterval(timer);
						timer = null;
					}
					render();
					await waitForMenuReturn(ui, failed
						? { promptText: "Press Enter to return to the dashboard." }
						: { autoReturnMs: 2_000, pauseOnAnyKey: true });
					dispose();
				},
				abort: dispose,
			};
		};
		type DashboardOperationScreen = NonNullable<ReturnType<typeof createOperationScreen>>;

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

		const buildEmailCountMap = (
			accounts: Array<{ email?: string }>,
		): Map<string, number> => {
			const counts = new Map<string, number>();
			for (const account of accounts) {
				const normalizedEmail = sanitizeEmail(account.email);
				if (!normalizedEmail) continue;
				counts.set(normalizedEmail, (counts.get(normalizedEmail) ?? 0) + 1);
			}
			return counts;
		};

		const updateEmailCountMap = (
			emailCounts: Map<string, number>,
			previousEmail: string | undefined,
			nextEmail: string | undefined,
		): void => {
			const previousNormalized = sanitizeEmail(previousEmail);
			const nextNormalized = sanitizeEmail(nextEmail);
			if (previousNormalized === nextNormalized) {
				return;
			}
			if (previousNormalized) {
				const nextCount = (emailCounts.get(previousNormalized) ?? 0) - 1;
				if (nextCount > 0) {
					emailCounts.set(previousNormalized, nextCount);
				} else {
					emailCounts.delete(previousNormalized);
				}
			}
			if (nextNormalized) {
				emailCounts.set(nextNormalized, (emailCounts.get(nextNormalized) ?? 0) + 1);
			}
		};

		const canHydrateCachedTokenForAccount = (
			emailCounts: Map<string, number>,
			account: { email?: string; accountId?: string },
			tokenAccountId: string | undefined,
		): boolean => {
			const normalizedAccountId = account.accountId?.trim();
			if (normalizedAccountId) {
				return tokenAccountId === normalizedAccountId;
			}
			const normalizedEmail = sanitizeEmail(account.email);
			if (normalizedEmail && (emailCounts.get(normalizedEmail) ?? 0) <= 1) {
				return true;
			}
			return false;
		};

		type SyncRemovalTarget = {
			refreshToken: string;
			organizationId?: string;
			accountId?: string;
		};

		const getSyncRemovalTargetKey = (target: SyncRemovalTarget): string => {
			return `${target.organizationId ?? ""}|${target.accountId ?? ""}|${target.refreshToken}`;
		};

		const findAccountIndexByExactIdentity = (
			accounts: AccountStorageV3["accounts"],
			target: SyncRemovalTarget | null | undefined,
		): number => {
			if (!target || !target.refreshToken) return -1;
			const targetKey = getSyncRemovalTargetKey(target);
			return accounts.findIndex((account) =>
				getSyncRemovalTargetKey({
					refreshToken: account.refreshToken,
					organizationId: account.organizationId,
					accountId: account.accountId,
				}) === targetKey,
			);
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
							// Instructions are fetched per model family (codex-max, codex, gpt-5.4, etc.)
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
										let modelFamily = model ? getModelFamily(model) : "gpt-5.4";
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
										let accountCount = accountManager.getAccountCount();
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
					const removedCount = accountManager.removeAccountsWithSameRefreshToken(account);
					if (removedCount <= 0) {
						logWarn(
							`[${PLUGIN_NAME}] Expected grouped account removal after auth failures, but removed ${removedCount}.`,
						);
						const cooledCount = accountManager.markAccountsWithRefreshTokenCoolingDown(
							account.refreshToken,
							ACCOUNT_LIMITS.AUTH_FAILURE_COOLDOWN_MS,
							"auth-failure",
						);
						if (cooledCount <= 0) {
							logWarn(
								`[${PLUGIN_NAME}] Unable to apply auth-failure cooldown; no live account found for refresh token.`,
							);
						}
						accountManager.saveToDiskDebounced();
						continue;
					}
					accountManager.saveToDiskDebounced();
					const removalMessage = removedCount > 1
						? `Removed ${removedCount} accounts (same refresh token) after ${failures} consecutive auth failures. Run 'opencode auth login' to re-add.`
						: `Removed ${accountLabel} after ${failures} consecutive auth failures. Run 'opencode auth login' to re-add.`;
					await showToast(
						removalMessage,
						"error",
						{ duration: toastDurationMs * 2 },
					);
					// Restart traversal: clear attempted and refresh accountCount to avoid skipping healthy accounts
					attempted.clear();
					accountCount = accountManager.getAccountCount();
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
										organizationId: account.organizationId,
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
								const quotaBar = (usedPercent: number | undefined): string => {
									if (typeof usedPercent !== "number" || !Number.isFinite(usedPercent)) {
										return "▒▒▒▒▒▒▒▒▒▒";
									}
									const left = Math.max(0, Math.min(100, Math.round(100 - usedPercent)));
									const filled = Math.max(0, Math.min(10, Math.round(left / 10)));
									return `${"█".repeat(filled)}${"▒".repeat(10 - filled)}`;
								};
								const summarizeWindow = (label: string, window: CodexQuotaWindow): string => {
									const used = window.usedPercent;
									const left =
										typeof used === "number" && Number.isFinite(used)
											? Math.max(0, Math.min(100, Math.round(100 - used)))
											: undefined;
									const reset = formatResetAt(window.resetAtMs);
									let summary = label;
									if (left !== undefined) summary = `${summary} ${quotaBar(used)} ${left}% left`;
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
								organizationId: string | undefined;
							}): Promise<CodexQuotaSnapshot> => {
								const QUOTA_PROBE_MODELS = ["gpt-5.4", "gpt-5-codex", "gpt-5.3-codex", "gpt-5.2-codex"];
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
											organizationId: params.organizationId,
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
								const ui = resolveUiRuntime();
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
								const screen = createOperationScreen(
									ui,
									"Health check",
									deepProbe
										? `Checking ${workingStorage.accounts.length} account(s) with full refresh + live validation`
										: `Checking ${workingStorage.accounts.length} account(s) with quota validation`,
								);
								let screenFinished = false;
								const emit = (
									index: number,
									detail: string,
									tone: "normal" | "muted" | "success" | "warning" | "danger" | "accent" = "normal",
								) => {
									const account = workingStorage.accounts[index];
									const label = sanitizeScreenText(formatCommandAccountLabel(account, index));
									const safeDetail = sanitizeScreenText(detail);
									const prefix =
										tone === "danger"
											? getStatusMarker(ui, "error")
											: tone === "warning"
												? getStatusMarker(ui, "warning")
												: getStatusMarker(ui, "ok");
									const line = sanitizeScreenText(`${prefix} ${label} | ${safeDetail}`);
									if (screen) {
										screen.push(line, tone);
										return;
									}
									console.log(line);
								};

								try {
									if (workingStorage.accounts.length === 0) {
										if (screen) {
											screen.push("No accounts to check.", "warning");
											await screen.finish();
											screenFinished = true;
										} else {
											console.log("No accounts to check.");
										}
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
									const workingEmailCounts = buildEmailCountMap(workingStorage.accounts);

									for (let i = 0; i < total; i += 1) {
										const account = workingStorage.accounts[i];
										if (!account) continue;
										if (account.enabled === false) {
											disabled += 1;
											emit(i, "disabled", "warning");
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
											const cachedTokenAccountId = cached ? extractAccountId(cached.accessToken) : undefined;
											if (
											cached &&
											canHydrateCachedTokenForAccount(
												workingEmailCounts,
												account,
												cachedTokenAccountId,
											) &&
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
													updateEmailCountMap(workingEmailCounts, account.email, hydratedEmail);
													account.email = hydratedEmail;
													storageChanged = true;
												}

												tokenAccountId = cachedTokenAccountId;
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
												emit(i, `error: ${message}`, "danger");
												if (deepProbe && isFlaggableFailure(refreshResult)) {
													const flaggedKey = getSyncRemovalTargetKey({
														refreshToken: account.refreshToken,
														organizationId: account.organizationId,
														accountId: account.accountId,
													});
													const existingIndex = flaggedStorage.accounts.findIndex(
														(flagged) =>
															getSyncRemovalTargetKey({
																refreshToken: flagged.refreshToken,
																organizationId: flagged.organizationId,
																accountId: flagged.accountId,
															}) === flaggedKey,
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
													removeFromActive.add(flaggedKey);
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
												updateEmailCountMap(workingEmailCounts, account.email, hydratedEmail);
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
											emit(i, detail, "success");
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
												organizationId: account.organizationId,
											});
											ok += 1;
											emit(i, formatCodexQuotaLine(snapshot), snapshot.status === 429 ? "warning" : "success");
										} catch (error) {
											errors += 1;
											const message = error instanceof Error ? error.message : String(error);
											emit(i, `error: ${message.slice(0, 160)}`, "danger");
										}
										} catch (error) {
											errors += 1;
											const message = error instanceof Error ? error.message : String(error);
											emit(i, `error: ${message.slice(0, 120)}`, "danger");
										}
									}

									if (removeFromActive.size > 0) {
										workingStorage.accounts = workingStorage.accounts.filter(
											(account) =>
												!removeFromActive.has(
													getSyncRemovalTargetKey({
														refreshToken: account.refreshToken,
														organizationId: account.organizationId,
														accountId: account.accountId,
													}),
												),
										);
										clampActiveIndices(workingStorage);
										storageChanged = true;
									}

									if (flaggedChanged) {
										await saveFlaggedAccounts(flaggedStorage);
									}
									if (storageChanged) {
										await saveAccounts(workingStorage);
										invalidateAccountManagerCache();
									}

									const summaryLines: Array<{
										line: string;
										tone?: "normal" | "muted" | "success" | "warning" | "danger" | "accent";
									}> = [{ line: `Results: ${ok} ok, ${errors} error, ${disabled} disabled`, tone: errors > 0 ? "warning" : "success" }];
									if (removeFromActive.size > 0) {
										summaryLines.push({ line: `Moved ${removeFromActive.size} account(s) to flagged pool (invalid refresh token).`, tone: "warning" as const });
									}
									if (screen) {
										await screen.finish(summaryLines);
										screenFinished = true;
										return;
									}
									console.log("");
									for (const line of summaryLines) {
										console.log(line.line);
									}
									console.log("");
								} catch (error) {
									const message = error instanceof Error ? error.message : String(error);
									if (screen) {
										screen.push(`Health check failed: ${message}`, "danger");
										await screen.finish(undefined, { failed: true });
										screenFinished = true;
									} else {
										console.log(`\nHealth check failed: ${message}\n`);
									}
								} finally {
									if (screen && !screenFinished) {
										screen.abort();
									}
								}
							};

							const verifyFlaggedAccounts = async (
								screenOverride?: DashboardOperationScreen | null,
							): Promise<void> => {
								const ui = resolveUiRuntime();
								const screen =
									screenOverride ??
									createOperationScreen(
										ui,
										"Check Problem Accounts",
										"Checking flagged accounts and attempting restore",
									);
								const emit = (
									line: string,
									tone: OperationTone = "normal",
								) => {
									const safeLine = sanitizeScreenText(line);
									if (screen) {
										screen.push(safeLine, tone);
										return;
									}
									console.log(safeLine);
								};
								let screenFinished = false;
								try {
									const flaggedStorage = await loadFlaggedAccounts();
									const activeStorage = await loadAccounts();
									if (flaggedStorage.accounts.length === 0) {
									emit("No flagged accounts to verify.");
										if (screen && !screenOverride) {
											await screen.finish();
											screenFinished = true;
										}
										return;
									}

									emit(`Checking ${flaggedStorage.accounts.length} problem account(s)...`, "muted");
									const remaining: FlaggedAccountMetadataV1[] = [];
									const restored: TokenSuccessWithAccount[] = [];
									const flaggedLabelWidth = Math.min(
										72,
										Math.max(
											18,
											...flaggedStorage.accounts.map((flagged, index) =>
												(flagged.email ?? flagged.accountLabel ?? `Flagged ${index + 1}`).length,
											),
										),
									);
									const padFlaggedLabel = (value: string): string =>
										value.length >= flaggedLabelWidth ? value : `${value}${" ".repeat(flaggedLabelWidth - value.length)}`;

									for (let i = 0; i < flaggedStorage.accounts.length; i += 1) {
										const flagged = flaggedStorage.accounts[i];
										if (!flagged) continue;
										const label = padFlaggedLabel(flagged.email ?? flagged.accountLabel ?? `Flagged ${i + 1}`);
									try {
										const cached = await lookupCodexCliTokensByEmail(flagged.email);
										const now = Date.now();
										const cachedTokenAccountId = cached ? extractAccountId(cached.accessToken) : undefined;
										const restoredIdentityContext = restored.map((entry) => ({
											email: sanitizeEmail(extractAccountEmail(entry.access, entry.idToken)),
											accountId: entry.accountIdOverride ?? extractAccountId(entry.access),
										}));
										const restoreEmailCounts = buildEmailCountMap([
											...(activeStorage?.accounts ?? []),
											...restoredIdentityContext,
											...remaining,
											flagged,
											...flaggedStorage.accounts.slice(i + 1).filter(Boolean),
										]);
										if (
											cached &&
											canHydrateCachedTokenForAccount(
												restoreEmailCounts,
												flagged,
												cachedTokenAccountId,
											) &&
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
										emit(`${getStatusMarker(ui, "ok")} ${label} | restored (cache)`, "success");
											continue;
										}

										const refreshResult = await queuedRefresh(flagged.refreshToken);
										if (refreshResult.type !== "success") {
											emit(`${getStatusMarker(ui, "warning")} ${label} | still flagged: ${refreshResult.message ?? refreshResult.reason ?? "refresh failed"}`, "warning");
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
									emit(`${getStatusMarker(ui, "ok")} ${label} | restored`, "success");
										} catch (error) {
											const message = error instanceof Error ? error.message : String(error);
											emit(
												`${getStatusMarker(ui, "error")} ${label} | error: ${message.slice(0, 120)}`,
												"danger",
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

									const summaryLines: Array<{
										line: string;
										tone?: "normal" | "muted" | "success" | "warning" | "danger" | "accent";
									}> = [{ line: `Results: ${restored.length} restored, ${remaining.length} still flagged`, tone: remaining.length > 0 ? "warning" : "success" }];
									if (screen && !screenOverride) {
										await screen.finish(summaryLines);
										screenFinished = true;
										return;
									}
									console.log("");
									for (const line of summaryLines) {
										console.log(line.line);
									}
									console.log("");
								} finally {
									if (screen && !screenFinished && !screenOverride) {
										screen.abort();
									}
								}
							};

							const toggleCodexMultiAuthSyncSetting = async (): Promise<void> => {
								try {
									const currentConfig = loadPluginConfig();
									const enabled = getSyncFromCodexMultiAuthEnabled(currentConfig);
									await setSyncFromCodexMultiAuthEnabled(!enabled);
									const nextLabel = !enabled ? "enabled" : "disabled";
									console.log(`\nSync from codex-multi-auth ${nextLabel}.\n`);
								} catch (error) {
									const message = error instanceof Error ? error.message : String(error);
									console.log(`\nFailed to update sync setting: ${message}\n`);
								}
							};

							const createMaintenanceAccountsBackup = async (
								prefix: string,
							): Promise<string> => {
								const backupPath = createTimestampedBackupPath(prefix);
								await backupRawAccountsFile(backupPath, true);
								return backupPath;
							};

							const runCodexMultiAuthSync = async (): Promise<void> => {
								const currentConfig = loadPluginConfig();
								if (!getSyncFromCodexMultiAuthEnabled(currentConfig)) {
									console.log("\nEnable sync from codex-multi-auth in Experimental settings first.\n");
									return;
								}

							const PRUNE_BACKUP_READ_RETRY_DELAYS_MS = [100, 250, 500] as const;

							const createSyncPruneBackup = async (): Promise<{
								backupPath: string;
								restore: () => Promise<void>;
							}> => {
								const readPruneBackupFile = async (backupPath: string): Promise<string> => {
									const retryableCodes = new Set(["EBUSY", "EACCES", "EPERM"]);
									for (
										let attempt = 0;
										attempt <= PRUNE_BACKUP_READ_RETRY_DELAYS_MS.length;
										attempt += 1
									) {
										try {
											return await fsPromises.readFile(backupPath, "utf-8");
										} catch (error) {
											const code = (error as NodeJS.ErrnoException).code;
											if (!code || !retryableCodes.has(code) || attempt >= PRUNE_BACKUP_READ_RETRY_DELAYS_MS.length) {
												throw error;
											}
											const delayMs = PRUNE_BACKUP_READ_RETRY_DELAYS_MS[attempt];
											if (delayMs !== undefined) {
												await new Promise((resolve) => setTimeout(resolve, delayMs));
											}
										}
									}
									throw new Error("readPruneBackupFile: unexpected retry exit");
								};
								const { accounts: loadedAccountsStorage, flagged: currentFlaggedStorage } =
									await loadAccountAndFlaggedStorageSnapshot();
								const currentAccountsStorage =
									loadedAccountsStorage ??
									({
										version: 3,
										accounts: [],
										activeIndex: 0,
										activeIndexByFamily: {},
									} satisfies AccountStorageV3);
									const backupPath = createTimestampedBackupPath("codex-sync-prune-backup");
									await fsPromises.mkdir(dirname(backupPath), { recursive: true });
									const backupPayload = createSyncPruneBackupPayload(currentAccountsStorage, currentFlaggedStorage);
									const restoreAccountsSnapshot = structuredClone(currentAccountsStorage);
									const restoreFlaggedSnapshot = structuredClone(currentFlaggedStorage);
									// On Windows, mode bits are ignored and the backup relies on the parent directory ACLs.
									await fsPromises.writeFile(backupPath, `${JSON.stringify(backupPayload, null, 2)}\n`, {
										encoding: "utf-8",
										mode: 0o600,
										flag: "wx",
									});
									return {
										backupPath,
										restore: async () => {
											const backupRaw = await readPruneBackupFile(backupPath);
											JSON.parse(backupRaw);
											const normalizedAccounts = normalizeAccountStorage(restoreAccountsSnapshot);
											if (!normalizedAccounts) {
												throw new Error("Prune backup account snapshot failed validation.");
											}
											const flaggedSnapshot = restoreFlaggedSnapshot;
											if (
												!flaggedSnapshot ||
												typeof flaggedSnapshot !== "object" ||
												(flaggedSnapshot as { version?: unknown }).version !== 1 ||
												!Array.isArray((flaggedSnapshot as { accounts?: unknown }).accounts)
											) {
												throw new Error("Prune backup flagged snapshot failed validation.");
											}
											const emptyAccountsStorage = {
												version: 3,
												accounts: [],
												activeIndex: 0,
												activeIndexByFamily: {},
											} satisfies AccountStorageV3;
											const restoredAccountsSnapshot = JSON.stringify(normalizedAccounts);
											const liveAccountsBeforeRestore = await withAccountStorageTransaction(
												async (current, persist) => {
													const snapshot = current ?? emptyAccountsStorage;
													try {
														await persist(normalizedAccounts);
													} catch (error) {
														const message = error instanceof Error ? error.message : String(error);
														throw new Error(`Failed to restore account storage from prune backup: ${message}`);
													}
													return snapshot;
												},
											);
											try {
												await saveFlaggedAccounts(
													flaggedSnapshot as { version: 1; accounts: FlaggedAccountMetadataV1[] },
												);
											} catch (error) {
												const message = error instanceof Error ? error.message : String(error);
												try {
													let rolledBack = false;
													await withAccountStorageTransaction(async (current, persist) => {
														const currentStorage = current ?? emptyAccountsStorage;
														if (JSON.stringify(currentStorage) !== restoredAccountsSnapshot) {
															return;
														}
														await persist(liveAccountsBeforeRestore);
														rolledBack = true;
													});
													if (!rolledBack) {
														throw new Error("Account storage changed concurrently before rollback could be applied.");
													}
												} catch (rollbackError) {
													const rollbackMessage =
														rollbackError instanceof Error ? rollbackError.message : String(rollbackError);
													throw new Error(
														`Failed to restore flagged storage from prune backup: ${message}. Account-store rollback also failed: ${rollbackMessage}`,
													);
												}
												throw new Error(
													`Failed to restore flagged storage from prune backup: ${message}. Account-store changes were rolled back.`,
												);
											}
											invalidateAccountManagerCache();
										},
									};
								};

							const removeAccountsForSync = async (
								targets: SyncRemovalTarget[],
							): Promise<void> => {
								const targetKeySet = new Set(
									targets
										.filter((target) => typeof target.refreshToken === "string" && target.refreshToken.length > 0)
										.map((target) => getSyncRemovalTargetKey(target)),
								);
								let removedTargets: Array<{
									index: number;
									account: AccountStorageV3["accounts"][number];
								}> = [];
								await withAccountStorageTransaction(async (loadedStorage, persist) => {
									const currentStorage =
										loadedStorage ??
										({
											version: 3,
											accounts: [],
											activeIndex: 0,
											activeIndexByFamily: {},
										} satisfies AccountStorageV3);
									removedTargets = currentStorage.accounts
										.map((account, index) => ({ index, account }))
										.filter((entry) =>
											entry.account &&
											targetKeySet.has(
												getSyncRemovalTargetKey({
													refreshToken: entry.account.refreshToken,
													organizationId: entry.account.organizationId,
													accountId: entry.account.accountId,
												}),
											),
										);
									if (removedTargets.length === 0) {
										return;
									}
									const matchedKeySet = new Set(
										removedTargets.map((entry) =>
											getSyncRemovalTargetKey({
												refreshToken: entry.account.refreshToken,
												organizationId: entry.account.organizationId,
												accountId: entry.account.accountId,
											}),
										),
									);
									if (
										removedTargets.length !== targetKeySet.size ||
										matchedKeySet.size !== targetKeySet.size ||
										[...targetKeySet].some((key) => !matchedKeySet.has(key))
									) {
										throw new Error("Selected accounts changed before removal. Re-run sync and confirm again.");
									}
									const activeAccountIdentity = {
										refreshToken:
											currentStorage.accounts[currentStorage.activeIndex]?.refreshToken ?? "",
										organizationId:
											currentStorage.accounts[currentStorage.activeIndex]?.organizationId,
										accountId: currentStorage.accounts[currentStorage.activeIndex]?.accountId,
									} satisfies SyncRemovalTarget;
									const familyActiveIdentities = Object.fromEntries(
										MODEL_FAMILIES.map((family) => {
											const familyIndex = currentStorage.activeIndexByFamily?.[family] ?? currentStorage.activeIndex;
											const familyAccount = currentStorage.accounts[familyIndex];
											return [
												family,
												familyAccount
													? ({
															refreshToken: familyAccount.refreshToken,
															organizationId: familyAccount.organizationId,
															accountId: familyAccount.accountId,
														} satisfies SyncRemovalTarget)
													: null,
											];
										}),
									) as Partial<Record<ModelFamily, SyncRemovalTarget | null>>;
									currentStorage.accounts = currentStorage.accounts.filter(
										(account) =>
											!targetKeySet.has(
												getSyncRemovalTargetKey({
													refreshToken: account.refreshToken,
													organizationId: account.organizationId,
													accountId: account.accountId,
												}),
											),
									);
									const remappedActiveIndex = findAccountIndexByExactIdentity(
										currentStorage.accounts,
										activeAccountIdentity,
									);
									currentStorage.activeIndex =
										remappedActiveIndex >= 0
											? remappedActiveIndex
											: Math.min(currentStorage.activeIndex, Math.max(0, currentStorage.accounts.length - 1));
									currentStorage.activeIndexByFamily = currentStorage.activeIndexByFamily ?? {};
									for (const family of MODEL_FAMILIES) {
										const remappedFamilyIndex = findAccountIndexByExactIdentity(
											currentStorage.accounts,
											familyActiveIdentities[family] ?? null,
										);
										currentStorage.activeIndexByFamily[family] =
											remappedFamilyIndex >= 0 ? remappedFamilyIndex : currentStorage.activeIndex;
									}
									clampActiveIndices(currentStorage);
									await persist(currentStorage);
								});
								if (removedTargets.length === 0) {
									return;
								}
								const removedFlaggedKeys = new Set(
									removedTargets.map((entry) =>
										getSyncRemovalTargetKey({
											refreshToken: entry.account.refreshToken,
											organizationId: entry.account.organizationId,
											accountId: entry.account.accountId,
										}),
									),
								);
								await withFlaggedAccountsTransaction(async (currentFlaggedStorage, persist) => {
									await persist({
										version: 1,
										accounts: currentFlaggedStorage.accounts.filter(
											(flagged) =>
												!removedFlaggedKeys.has(
													getSyncRemovalTargetKey({
														refreshToken: flagged.refreshToken,
														organizationId: flagged.organizationId,
														accountId: flagged.accountId,
													}),
												),
										),
									});
								});
								invalidateAccountManagerCache();
								const removedLabels = removedTargets
									.map((entry) => {
										const accountId = entry.account?.accountId?.trim();
										return accountId
											? `Account ${entry.index + 1} [${accountId.slice(-6)}]`
											: `Account ${entry.index + 1}`;
									})
									.join(", ");
								console.log(`\nRemoved ${removedTargets.length} account(s): ${removedLabels}\n`);
							};

								const buildSyncRemovalPlan = async (indexes: number[]): Promise<{
									previewLines: string[];
									targets: SyncRemovalTarget[];
								}> => {
									const currentStorage =
										(await loadAccounts()) ??
										({
											version: 3,
											accounts: [],
											activeIndex: 0,
											activeIndexByFamily: {},
										} satisfies AccountStorageV3);
									const candidates: Array<{
										previewLine: string;
										target: SyncRemovalTarget;
									}> = [...indexes]
										.sort((left, right) => left - right)
										.map((index) => {
											const account = currentStorage.accounts[index];
											if (!account) {
												throw new Error(
													`Selected account ${index + 1} changed before confirmation. Re-run sync and confirm again.`,
												);
											}
											const label = account.email ?? account.accountLabel ?? `Account ${index + 1}`;
											const currentSuffix = index === currentStorage.activeIndex ? " | current" : "";
											return {
												previewLine: `${index + 1}. ${label}${currentSuffix}`,
												target: {
													refreshToken: account.refreshToken,
													organizationId: account.organizationId,
													accountId: account.accountId,
												} satisfies SyncRemovalTarget,
											};
										});
									return {
										previewLines: candidates.map((candidate) => candidate.previewLine),
										targets: candidates.map((candidate) => candidate.target),
									};
								};

								let pruneBackup:
									| {
											backupPath: string;
											restore: () => Promise<void>;
											restoreFailureMessage?: string;
									  }
									| null = null;
								const restorePruneBackup = async (): Promise<void> => {
									const currentBackup = pruneBackup;
									if (!currentBackup) return;
									if (currentBackup.restoreFailureMessage) {
										throw new Error(
											`${currentBackup.restoreFailureMessage}. Backup remains at ${currentBackup.backupPath}.`,
										);
									}
									try {
										await currentBackup.restore();
										pruneBackup = null;
									} catch (restoreError) {
										const message =
											restoreError instanceof Error ? restoreError.message : String(restoreError);
										currentBackup.restoreFailureMessage = message;
										pruneBackup = currentBackup;
										throw new Error(`${message}. Backup remains at ${currentBackup.backupPath}.`);
									}
								};
								const safeRestorePruneBackup = async (context: string): Promise<void> => {
									try {
										await restorePruneBackup();
									} catch (restoreError) {
										const message =
											restoreError instanceof Error ? restoreError.message : String(restoreError);
										console.log(`\nFailed to restore pruned accounts during ${context}: ${message}\n`);
									}
								};
								const syncPruneMaxAttempts = 5;
								let syncPruneAttempts = 0;
								while (syncPruneAttempts < syncPruneMaxAttempts) {
									syncPruneAttempts += 1;
									try {
										const loadedSource = await loadCodexMultiAuthSourceStorage(process.cwd());
										const preview = await previewSyncFromCodexMultiAuth(process.cwd(), loadedSource);
										console.log("");
										console.log(`codex-multi-auth source: ${preview.accountsPath}`);
										console.log(`Scope: ${preview.scope}`);
										console.log(
											`Preview: +${preview.imported} new, ${preview.skipped} skipped, ${preview.total} total`,
										);

										if (preview.imported <= 0) {
											if (pruneBackup) {
												try {
													await restorePruneBackup();
												} catch (restoreError) {
													const message =
														restoreError instanceof Error ? restoreError.message : String(restoreError);
													logWarn(
														`[${PLUGIN_NAME}] Failed to restore prune backup after zero-import preview: ${message}`,
													);
													throw new Error(
														`Failed to restore previously pruned accounts after zero-import preview: ${message}`,
													);
												}
											}
											console.log("No new accounts to import.\n");
											return;
										}

										const confirmed = await confirm(
											`Import ${preview.imported} new account(s) from codex-multi-auth?`,
										);
										if (!confirmed) {
											await safeRestorePruneBackup("sync cancellation");
											console.log("\nSync cancelled.\n");
											return;
										}

										const result = await syncFromCodexMultiAuth(process.cwd(), loadedSource);
										pruneBackup = null;
										invalidateAccountManagerCache();
										const backupLabel =
											result.backupStatus === "created"
												? result.backupPath ?? "created"
												: result.backupStatus === "skipped"
													? "skipped"
													: result.backupError ?? "failed";

										console.log("");
										console.log("Sync complete.");
										console.log(`Source: ${result.accountsPath}`);
										console.log(`Imported: ${result.imported}`);
										console.log(`Skipped: ${result.skipped}`);
										console.log(`Total: ${result.total}`);
										console.log(`Auto-backup: ${backupLabel}`);
										console.log("");
										return;
									} catch (error) {
										if (error instanceof CodexMultiAuthSyncCapacityError) {
											const { details } = error;
										console.log("");
										console.log("Sync blocked by account limit.");
										console.log(`Source: ${details.accountsPath}`);
										console.log(`Scope: ${details.scope}`);
										console.log(`Current accounts: ${details.currentCount}`);
										console.log(`Source accounts: ${details.sourceCount}`);
										console.log(`Deduped total after merge: ${details.dedupedTotal}`);
										console.log(`Overlap accounts skipped by dedupe: ${details.skippedOverlaps}`);
										console.log(`Importable new accounts: ${details.importableNewAccounts}`);
										console.log(`Maximum allowed: ${details.maxAccounts}`);
										if (isCodexMultiAuthSourceTooLargeForCapacity(details)) {
											await safeRestorePruneBackup("capacity handling");
											console.log(
												`Source alone exceeds the configured maximum. Reduce the source set or raise CODEX_AUTH_SYNC_MAX_ACCOUNTS before retrying.`,
											);
											console.log("");
											return;
										}
										console.log(`Remove at least ${details.needToRemove} account(s) first.`);
										if (details.suggestedRemovals.length > 0) {
											console.log("Suggested removals:");
											for (const suggestion of details.suggestedRemovals) {
												const label =
													suggestion.email ??
													suggestion.accountLabel ??
													`Account ${suggestion.index + 1}`;
												const currentSuffix = suggestion.isCurrentAccount ? " | current" : "";
												console.log(
													`  ${suggestion.index + 1}. ${label}${currentSuffix} | score ${suggestion.score} | ${suggestion.reason}`,
												);
											}
										}
										console.log("");
										const indexesToRemove = await promptCodexMultiAuthSyncPrune(
											details.needToRemove,
											details.suggestedRemovals,
										);
										if (!indexesToRemove || indexesToRemove.length === 0) {
											await safeRestorePruneBackup("sync cancellation");
											console.log("Sync cancelled.\n");
											return;
										}
										let removalPlan: {
											previewLines: string[];
											targets: SyncRemovalTarget[];
										};
										try {
											removalPlan = await buildSyncRemovalPlan(indexesToRemove);
										} catch (planError) {
											const message =
												planError instanceof Error ? planError.message : String(planError);
											await safeRestorePruneBackup("removal planning");
											console.log(`\nSync failed: ${message}\n`);
											return;
										}
										console.log("Dry run removal:");
										for (const line of removalPlan.previewLines) {
											console.log(`  ${line}`);
										}
										console.log(
											"Accounts removed in this step cannot be recovered if the process is interrupted - ensure sync completes before closing.",
										);
										console.log("");
										const confirmed = await confirm(
											`Remove ${indexesToRemove.length} selected account(s) and retry sync? ` +
												`Accounts cannot be recovered if the process is interrupted before sync completes.`,
										);
										if (!confirmed) {
											await safeRestorePruneBackup("sync cancellation");
											console.log("Sync cancelled.\n");
											return;
										}
											if (!pruneBackup) {
												pruneBackup = await createSyncPruneBackup();
											}
											await removeAccountsForSync(removalPlan.targets);
											continue;
										}
										const message = error instanceof Error ? error.message : String(error);
										await safeRestorePruneBackup("sync failure");
										console.log(`\nSync failed: ${message}\n`);
										return;
									}
								}
								console.log(
									"\nSync hit max retry limit - raise CODEX_AUTH_SYNC_MAX_ACCOUNTS or remove accounts manually.\n",
								);
								return;
							};

							const runCodexMultiAuthOverlapCleanup = async (): Promise<void> => {
								try {
									const preview = await previewCodexMultiAuthSyncedOverlapCleanup();
									if (preview.removed <= 0 && preview.updated <= 0) {
										console.log("\nNo synced overlaps found.\n");
										return;
									}
									console.log("");
									console.log("Cleanup preview.");
									console.log(`Before: ${preview.before}`);
									console.log(`After: ${preview.after}`);
									console.log(`Would remove overlaps: ${preview.removed}`);
									console.log(`Would update synced records: ${preview.updated}`);
									console.log("A backup will be created before changes are applied.");
									console.log("");
									const confirmed = await confirm(
										`Create a backup and apply synced overlap cleanup?`,
									);
									if (!confirmed) {
										console.log("\nCleanup cancelled.\n");
										return;
									}
									const backupPath = await createMaintenanceAccountsBackup(
										"codex-maintenance-overlap-backup",
									);
									const result = await cleanupCodexMultiAuthSyncedOverlaps();
									invalidateAccountManagerCache();
									console.log("");
									console.log("Cleanup complete.");
									console.log(`Before: ${result.before}`);
									console.log(`After: ${result.after}`);
									console.log(`Removed overlaps: ${result.removed}`);
									console.log(`Updated synced records: ${result.updated}`);
									console.log(`Backup: ${backupPath}`);
									console.log("");
								} catch (error) {
									const message = error instanceof Error ? error.message : String(error);
									console.log(`\nCleanup failed: ${message}\n`);
								}
							};

							const runDuplicateEmailCleanup = async (): Promise<void> => {
								try {
									const preview = await previewDuplicateEmailCleanup();
									if (preview.removed <= 0) {
										console.log("\nNo legacy duplicate emails found.\n");
										return;
									}
									console.log("");
									console.log("Cleanup preview.");
									console.log(`Before: ${preview.before}`);
									console.log(`After: ${preview.after}`);
									console.log(`Would remove legacy duplicates: ${preview.removed}`);
									console.log("Only legacy accounts without organization or workspace IDs are eligible.");
									console.log("A backup will be created before changes are applied.");
									console.log("");
									const confirmed = await confirm(
										`Create a backup and remove ${preview.removed} legacy duplicate-email account(s)?`,
									);
									if (!confirmed) {
										console.log("\nDuplicate email cleanup cancelled.\n");
										return;
									}
									const backupPath = await createMaintenanceAccountsBackup(
										"codex-maintenance-duplicate-email-backup",
									);
									const result = await cleanupDuplicateEmailAccounts();
									if (result.removed > 0) {
										invalidateAccountManagerCache();
										console.log("");
										console.log("Duplicate email cleanup complete.");
										console.log(`Before: ${result.before}`);
										console.log(`After: ${result.after}`);
										console.log(`Removed duplicates: ${result.removed}`);
										console.log(`Backup: ${backupPath}`);
										console.log("");
										return;
									}

									console.log("\nNo legacy duplicate emails found.\n");
								} catch (error) {
									const message = error instanceof Error ? error.message : String(error);
									console.log(`\nDuplicate email cleanup failed: ${message}\n`);
								}
							};

							const pickBestAccountFromDashboard = async (
								screenOverride?: DashboardOperationScreen | null,
							): Promise<void> => {
								const ui = resolveUiRuntime();
								const screen =
									screenOverride ??
									createOperationScreen(ui, "Best Account", "Comparing accounts");
								let screenFinished = false;
								try {
									const storage = await loadAccounts();
									if (!storage || storage.accounts.length === 0) {
										if (screen) {
											screen.push("No accounts available.", "warning");
											if (!screenOverride) {
												await screen.finish();
											}
											screenFinished = true;
										} else {
											console.log("\nNo accounts available.\n");
										}
										return;
									}

									const now = Date.now();
									const managerForFix = await AccountManager.loadFromDisk();
									cachedAccountManager = managerForFix;
									const explainability = managerForFix.getSelectionExplainability("codex", undefined, now);
									const eligible = explainability
										.filter((entry) => entry.eligible)
										.sort((a, b) => {
											if (b.healthScore !== a.healthScore) return b.healthScore - a.healthScore;
											return b.tokensAvailable - a.tokensAvailable;
										});
									const best = eligible[0];
									if (!best) {
										if (screen) {
											screen.push(`Compared ${explainability.length} account(s).`, "muted");
											screen.push("No eligible account available.", "warning");
											if (!screenOverride) {
												await screen.finish();
											}
											screenFinished = true;
										} else {
											console.log("\nNo eligible account available.\n");
										}
										return;
									}

									let selectedAccount: AccountStorageV3["accounts"][number] | undefined;
									await withAccountStorageTransaction(async (loadedStorage, persist) => {
										const workingStorage =
											loadedStorage ??
											({
												version: 3,
												accounts: [],
												activeIndex: 0,
												activeIndexByFamily: {},
											} satisfies AccountStorageV3);
										if (!workingStorage.accounts[best.index]) {
											throw new Error(`Best account ${best.index + 1} changed before selection.`);
										}
										workingStorage.activeIndex = best.index;
										workingStorage.activeIndexByFamily = workingStorage.activeIndexByFamily ?? {};
										for (const family of MODEL_FAMILIES) {
											workingStorage.activeIndexByFamily[family] = best.index;
										}
										await persist(workingStorage);
										selectedAccount = workingStorage.accounts[best.index];
									});
									invalidateAccountManagerCache();
									const selectedLabel = formatCommandAccountLabel(selectedAccount, best.index);

									if (screen) {
										screen.push(`Compared ${explainability.length} account(s); ${eligible.length} eligible.`, "muted");
										screen.push(`${getStatusMarker(ui, "ok")} ${selectedLabel}`, "success");
										screen.push(
											`Availability ready | risk low | health ${best.healthScore} | tokens ${best.tokensAvailable}`,
											"muted",
										);
										if (best.reasons.length > 0) {
											screen.push(`Why: ${best.reasons.slice(0, 3).join("; ")}`, "muted");
										}
										if (!screenOverride) {
											await screen.finish([{ line: "Best account selected.", tone: "success" }]);
										}
										screenFinished = true;
										return;
									}

									console.log(`\nSelected best account: ${selectedAccount?.email ?? `Account ${best.index + 1}`}\n`);
								} catch (error) {
									const message = error instanceof Error ? error.message : String(error);
									if (screen) {
										screen.push(`Failed to pick best account: ${message}`, "danger");
										if (!screenOverride) {
											await screen.finish(undefined, { failed: true });
										}
										screenFinished = true;
										return;
									}
									console.log(`\nFailed to pick best account: ${message}\n`);
								} finally {
									if (screen && !screenFinished && !screenOverride) {
										screen.abort();
									}
								}
							};

							const runAutoRepairFromDashboard = async (): Promise<void> => {
								const ui = resolveUiRuntime();
								const screen = createOperationScreen(
									ui,
									"Auto-Fix",
									"Checking and fixing common issues",
								);
								let screenFinished = false;
								const emit = (
									line: string,
									tone: OperationTone = "normal",
								) => {
									const safeLine = sanitizeScreenText(line);
									if (screen) {
										screen.push(safeLine, tone);
										return;
									}
									console.log(safeLine);
								};
								try {
									const initialStorage = await loadAccounts();
									if (!initialStorage || initialStorage.accounts.length === 0) {
										emit("No accounts available.", "warning");
										if (screen) {
											await screen.finish();
											screenFinished = true;
										}
										return;
									}
									const appliedFixes: string[] = [];
									const fixErrors: string[] = [];
									const backupPath = await createMaintenanceAccountsBackup("codex-auto-repair-backup");
									emit(`Backup created: ${backupPath}`, "muted");
									const cleanupResult = await cleanupCodexMultiAuthSyncedOverlaps();
									if (cleanupResult.removed > 0) {
										appliedFixes.push(`Removed ${cleanupResult.removed} synced overlap(s).`);
										emit(`Removed ${cleanupResult.removed} synced overlap(s).`, "success");
									}
									const refreshedStorage = await withAccountStorageTransaction(
										async (loadedStorage, persist) => {
											if (!loadedStorage || loadedStorage.accounts.length === 0) {
												return null;
											}
											const workingStorage: AccountStorageV3 = {
												...loadedStorage,
												accounts: loadedStorage.accounts.map((account) => ({ ...account })),
												activeIndexByFamily: { ...(loadedStorage.activeIndexByFamily ?? {}) },
											};

											let changedByRefresh = false;
											let refreshedCount = 0;
											for (const account of workingStorage.accounts) {
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
													fixErrors.push(error instanceof Error ? error.message : String(error));
												}
											}

											if (changedByRefresh) {
												await persist(workingStorage);
											}
											return {
												changedByRefresh,
												refreshedCount,
											};
										},
									);
									if (!refreshedStorage) {
										emit("No accounts available after cleanup.", "warning");
										if (screen) {
											await screen.finish();
											screenFinished = true;
										}
										return;
									}

									if (refreshedStorage.changedByRefresh) {
										appliedFixes.push(`Refreshed ${refreshedStorage.refreshedCount} account token(s).`);
										emit(`Refreshed ${refreshedStorage.refreshedCount} account token(s).`, "success");
									}
									await verifyFlaggedAccounts(screen);
									await pickBestAccountFromDashboard(screen);
									emit("");
									emit("Auto-repair complete.", "success");
									for (const entry of appliedFixes) {
										emit(`- ${entry}`, "muted");
									}
									for (const entry of fixErrors) {
										emit(`- warning: ${entry}`, "warning");
									}
									if (screen) {
										await screen.finish();
										screenFinished = true;
									} else {
										console.log("");
									}
								} catch (error) {
									const message = error instanceof Error ? error.message : String(error);
									if (screen) {
										screen.push(`Auto-repair failed: ${message}`, "danger");
										await screen.finish(undefined, { failed: true });
										screenFinished = true;
									} else {
										console.log(`\nAuto-repair failed: ${message}\n`);
									}
								} finally {
									if (screen && !screenFinished) {
										screen.abort();
									}
								}
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
											sourceIndex: index,
											quickSwitchNumber: index + 1,
											addedAt: account.addedAt,
											lastUsed: account.lastUsed,
											status,
											quotaSummary: formatRateLimitEntry(account, now) ?? undefined,
											isCurrentAccount: index === activeIndex,
											enabled: account.enabled !== false,
										};
									});

									const menuResult = await promptLoginMode(existingAccounts, {
										flaggedCount: flaggedStorage.accounts.length,
										syncFromCodexMultiAuthEnabled: getSyncFromCodexMultiAuthEnabled(loadPluginConfig()),
										statusMessage: () => {
											const snapshot = runtimeMetrics.lastSelectionSnapshot;
											if (!snapshot) return undefined;
											return snapshot.model ? `Current lens: ${snapshot.family}:${snapshot.model}` : `Current lens: ${snapshot.family}`;
										},
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
									if (menuResult.mode === "forecast") {
										await pickBestAccountFromDashboard();
										continue;
									}
									if (menuResult.mode === "fix") {
										await runAutoRepairFromDashboard();
										continue;
									}
									if (menuResult.mode === "settings") {
										continue;
									}
									if (menuResult.mode === "experimental-toggle-sync") {
										await toggleCodexMultiAuthSyncSetting();
										continue;
									}
									if (menuResult.mode === "experimental-sync-now") {
										await runCodexMultiAuthSync();
										continue;
									}
									if (menuResult.mode === "experimental-cleanup-overlaps") {
										await runCodexMultiAuthOverlapCleanup();
										continue;
									}
									if (menuResult.mode === "maintenance-clean-duplicate-emails") {
										await runDuplicateEmailCleanup();
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
										if (typeof menuResult.switchAccountIndex === "number") {
											const targetIndex = menuResult.switchAccountIndex;
											let targetLabel: string | null = null;
											await withAccountStorageTransaction(async (loadedStorage, persist) => {
												const txStorage = loadedStorage;
												if (!txStorage) return;
												const target = txStorage.accounts[targetIndex];
												if (!target) return;
												txStorage.activeIndex = targetIndex;
												txStorage.activeIndexByFamily = txStorage.activeIndexByFamily ?? {};
												for (const family of MODEL_FAMILIES) {
													txStorage.activeIndexByFamily[family] = targetIndex;
												}
												await persist(txStorage);
												targetLabel = target.email ?? `Account ${targetIndex + 1}`;
											});
											if (targetLabel) {
												invalidateAccountManagerCache();
												console.log(`\nSet current account: ${targetLabel}.\n`);
											}
											continue;
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
										: Number.isFinite(ACCOUNT_LIMITS.MAX_ACCOUNTS)
											? ACCOUNT_LIMITS.MAX_ACCOUNTS - existingCount
											: Number.POSITIVE_INFINITY;

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

								if (
									Number.isFinite(ACCOUNT_LIMITS.MAX_ACCOUNTS) &&
									accounts.length >= ACCOUNT_LIMITS.MAX_ACCOUNTS
								) {
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
			"codex-limits": tool({
				description: "Show live 5-hour and weekly Codex usage limits for all accounts.",
				args: {},
				async execute() {
					const ui = resolveUiRuntime();
					const storage = await loadAccounts();
					if (!storage || storage.accounts.length === 0) {
						if (ui.v2Enabled) {
							return [
								...formatUiHeader(ui, "Codex limits"),
								"",
								formatUiItem(ui, "No accounts configured.", "warning"),
								formatUiItem(ui, "Run: opencode auth login", "accent"),
							].join("\n");
						}
						return "No Codex accounts configured. Run: opencode auth login";
					}

					type UsageWindow = {
						used_percent?: number;
						limit_window_seconds?: number;
						reset_at?: number;
						reset_after_seconds?: number;
					} | null;

					type LimitWindow = {
						usedPercent?: number;
						windowMinutes?: number;
						resetAtMs?: number;
					};

					type UsageRateLimit = {
						primary_window?: UsageWindow;
						secondary_window?: UsageWindow;
					} | null;

					type UsageCredits = {
						has_credits?: boolean;
						unlimited?: boolean;
						balance?: string | null;
					} | null;

					type UsagePayload = {
						plan_type?: string;
						rate_limit?: UsageRateLimit;
						code_review_rate_limit?: UsageRateLimit;
						additional_rate_limits?: Array<{
							limit_name?: string;
							metered_feature?: string;
							rate_limit?: UsageRateLimit;
						}> | null;
						credits?: UsageCredits;
					};

					const formatWindowLabel = (windowMinutes: number | undefined): string => {
						if (!windowMinutes || !Number.isFinite(windowMinutes) || windowMinutes <= 0) {
							return "quota";
						}
						if (windowMinutes % 1440 === 0) return `${windowMinutes / 1440}d`;
						if (windowMinutes % 60 === 0) return `${windowMinutes / 60}h`;
						return `${windowMinutes}m`;
					};

					const formatReset = (resetAtMs: number | undefined): string | undefined => {
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

					const mapWindow = (window: UsageWindow): LimitWindow => {
						if (!window) return {};
						return {
							usedPercent:
								typeof window.used_percent === "number" && Number.isFinite(window.used_percent)
									? window.used_percent
									: undefined,
							windowMinutes:
								typeof window.limit_window_seconds === "number" && Number.isFinite(window.limit_window_seconds)
									? Math.max(1, Math.ceil(window.limit_window_seconds / 60))
									: undefined,
							resetAtMs:
								typeof window.reset_at === "number" && window.reset_at > 0
									? window.reset_at * 1000
									: typeof window.reset_after_seconds === "number" && window.reset_after_seconds > 0
										? Date.now() + window.reset_after_seconds * 1000
										: undefined,
						};
					};

					const formatLimitTitle = (windowMinutes: number | undefined, fallback = "quota"): string => {
						if (windowMinutes === 300) return "5h limit";
						if (windowMinutes === 10080) return "Weekly limit";
						if (fallback !== "quota") return fallback;
						return `${formatWindowLabel(windowMinutes)} limit`;
					};

					const formatLimitSummary = (window: LimitWindow): string => {
						const used = window.usedPercent;
						const left =
							typeof used === "number" && Number.isFinite(used)
								? Math.max(0, Math.min(100, Math.round(100 - used)))
								: undefined;
						const reset = formatReset(window.resetAtMs);
						if (left !== undefined && reset) return `${left}% left (resets ${reset})`;
						if (left !== undefined) return `${left}% left`;
						if (reset) return `resets ${reset}`;
						return "unavailable";
					};

					const formatCredits = (credits: UsageCredits): string | undefined => {
						if (!credits) return undefined;
						if (credits.unlimited) return "unlimited";
						if (typeof credits.balance === "string" && credits.balance.trim()) {
							return credits.balance.trim();
						}
						if (credits.has_credits) return "available";
						return undefined;
					};

					const formatExtraName = (name: string | undefined): string => {
						if (!name) return "Additional limit";
						if (name === "code_review_rate_limit") return "Code review";
						return name.replace(/[_-]+/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
					};

					const sanitizeUsageErrorMessage = (status: number, bodyText: string): string => {
						const normalized = bodyText.replace(/\s+/g, " ").trim();
						const redacted = normalized
							.replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
							.replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[redacted-token]")
							.replace(/\bsk-[A-Za-z0-9][A-Za-z0-9._:-]{19,}\b/gi, "[redacted-token]")
							.replace(/\b[a-f0-9]{40,}\b/gi, "[redacted-token]");
						return redacted ? `HTTP ${status}: ${redacted.slice(0, 200)}` : `HTTP ${status}`;
					};

					const isAbortError = (error: unknown): boolean =>
						(error instanceof Error && error.name === "AbortError") ||
						(typeof DOMException !== "undefined" && error instanceof DOMException && error.name === "AbortError");

					const applyRefreshedCredentials = (
						target: {
							refreshToken: string;
							accessToken?: string;
							expiresAt?: number;
						},
						result: {
							refresh: string;
							access: string;
							expires: number;
						},
					): void => {
						target.refreshToken = result.refresh;
						target.accessToken = result.access;
						target.expiresAt = result.expires;
					};
					const usageErrorBodyMaxChars = 4096;

					const persistRefreshedCredentials = async (params: {
						previousRefreshToken: string;
						accountId?: string;
						organizationId?: string;
						email?: string;
						refreshResult: {
							refresh: string;
							access: string;
							expires: number;
						};
					}): Promise<boolean> => {
						return await withAccountStorageTransaction(async (current, persist) => {
							const latestStorage: AccountStorageV3 =
								current ??
								({
									version: 3,
									accounts: [],
									activeIndex: 0,
									activeIndexByFamily: {},
								} satisfies AccountStorageV3);

							const uniqueMatch = <T>(matches: T[]): T | undefined =>
								matches.length === 1 ? matches[0] : undefined;

							let updated = false;
							if (params.previousRefreshToken) {
								for (const storedAccount of latestStorage.accounts) {
									if (storedAccount.refreshToken === params.previousRefreshToken) {
										applyRefreshedCredentials(storedAccount, params.refreshResult);
										updated = true;
									}
								}
							}

							if (!updated) {
								const normalizedOrganizationId = params.organizationId?.trim() ?? "";
								const normalizedEmail = params.email?.trim().toLowerCase();
								const orgScopedMatches = params.accountId
									? latestStorage.accounts.filter(
											(storedAccount) =>
												storedAccount.accountId === params.accountId &&
												(storedAccount.organizationId?.trim() ?? "") === normalizedOrganizationId,
										)
									: [];
								const accountIdMatches = params.accountId
									? latestStorage.accounts.filter(
											(storedAccount) => storedAccount.accountId === params.accountId,
										)
									: [];
								const emailMatches =
									normalizedEmail && !params.accountId
										? latestStorage.accounts.filter(
												(storedAccount) =>
													storedAccount.email?.trim().toLowerCase() === normalizedEmail,
											)
										: [];

								const fallbackTarget =
									uniqueMatch(orgScopedMatches) ??
									uniqueMatch(accountIdMatches) ??
									uniqueMatch(emailMatches);

								if (fallbackTarget) {
									applyRefreshedCredentials(fallbackTarget, params.refreshResult);
									updated = true;
								}
							}

							if (updated) {
								await persist(latestStorage);
							}
							if (!updated) {
								logWarn(
									`[${PLUGIN_NAME}] persistRefreshedCredentials could not find a matching stored account. Refreshed credentials remain in-memory for this invocation only.`,
									{
										accountId: params.accountId,
										organizationId: params.organizationId,
									},
								);
							}

							return updated;
						});
					};

					const usageFetchTimeoutMs = getFetchTimeoutMs(loadPluginConfig());

					const fetchUsage = async (params: {
						accountId: string;
						accessToken: string;
						organizationId: string | undefined;
					}): Promise<UsagePayload> => {
						const headers = createCodexHeaders(undefined, params.accountId, params.accessToken, {
							organizationId: params.organizationId,
						});
						headers.set("accept", "application/json");
						const controller = new AbortController();
						const timeout = setTimeout(() => controller.abort(), usageFetchTimeoutMs);

						try {
							const response = await fetch(`${CODEX_BASE_URL}/wham/usage`, {
								method: "GET",
								headers,
								signal: controller.signal,
							});
							if (!response.ok) {
								let bodyText = "";
								try {
									bodyText = (await response.text()).slice(0, usageErrorBodyMaxChars);
								} catch (error) {
									if (isAbortError(error) || controller.signal.aborted) {
										throw new Error("Usage request timed out");
									}
									throw error;
								}
								if (controller.signal.aborted) {
									throw new Error("Usage request timed out");
								}
								throw new Error(sanitizeUsageErrorMessage(response.status, bodyText));
							}
							return (await response.json()) as UsagePayload;
						} catch (error) {
							if (isAbortError(error)) {
								throw new Error("Usage request timed out");
							}
							throw error;
						} finally {
							clearTimeout(timeout);
						}
					};

					// Deduplicate accounts by refreshToken (same credential = same limits)
					const seenTokens = new Set<string>();
					const uniqueIndices: number[] = [];
					for (let i = 0; i < storage.accounts.length; i++) {
						const acct = storage.accounts[i];
						if (!acct) continue;
						const refreshToken =
							typeof acct.refreshToken === "string" ? acct.refreshToken.trim() : "";
						if (refreshToken && seenTokens.has(refreshToken)) continue;
						if (refreshToken) seenTokens.add(refreshToken);
						uniqueIndices.push(i);
					}

					const lines: string[] = ui.v2Enabled
						? [...formatUiHeader(ui, "Codex limits"), ""]
						: [`Codex limits (${uniqueIndices.length} account${uniqueIndices.length === 1 ? "" : "s"}):`, ""];
					const activeIndex = resolveActiveIndex(storage, "codex");
					const activeRefreshToken =
						typeof activeIndex === "number" && activeIndex >= 0 && activeIndex < storage.accounts.length
							? storage.accounts[activeIndex]?.refreshToken?.trim() || undefined
							: undefined;
					let storageChanged = false;

					for (const i of uniqueIndices) {
						const account = storage.accounts[i];
						if (!account) continue;
						const sharesActiveCredential =
							!!activeRefreshToken && account.refreshToken === activeRefreshToken;
						const displayIndex =
							sharesActiveCredential && typeof activeIndex === "number" ? activeIndex : i;
						const displayAccount = storage.accounts[displayIndex];
						if (sharesActiveCredential && !displayAccount) {
							logWarn(
								`[${PLUGIN_NAME}] active account entry missing for index ${displayIndex}, falling back to account ${i}`,
							);
						}
						const effectiveDisplayAccount = displayAccount ?? account;
						const label = formatCommandAccountLabel(effectiveDisplayAccount, displayIndex);
						const isActive = i === activeIndex || sharesActiveCredential;
						const activeSuffix = isActive ? (ui.v2Enabled ? ` ${formatUiBadge(ui, "active", "accent")}` : " [active]") : "";

						try {
							let accessToken = account.accessToken;
							if (
								typeof accessToken !== "string" ||
								!accessToken ||
								typeof account.expiresAt !== "number" ||
								account.expiresAt <= Date.now() + 30_000
							) {
								const previousRefreshToken = account.refreshToken;
								if (!previousRefreshToken) {
									throw new Error("Cannot refresh: account has no refresh token");
								}
								const refreshResult = await queuedRefresh(previousRefreshToken);
								if (refreshResult.type !== "success") {
									throw new Error(refreshResult.message ?? refreshResult.reason);
								}

								let refreshedCount = 0;
								for (const storedAccount of storage.accounts) {
									if (!storedAccount) continue;
									if (storedAccount.refreshToken === previousRefreshToken) {
										applyRefreshedCredentials(storedAccount, refreshResult);
										refreshedCount += 1;
									}
								}
								if (refreshedCount === 0) {
									applyRefreshedCredentials(account, refreshResult);
								}

								const persistedRefresh = await persistRefreshedCredentials({
									previousRefreshToken,
									accountId: account.accountId,
									organizationId: account.organizationId,
									email: account.email,
									refreshResult,
								});

								accessToken = refreshResult.access;
								storageChanged = storageChanged || persistedRefresh;
							}

							const effectiveAccount = sharesActiveCredential ? effectiveDisplayAccount : account;
							const accountId = effectiveAccount.accountId ?? extractAccountId(accessToken);
							if (!accountId) {
								throw new Error("Missing account id");
							}

							const payload = await fetchUsage({
								accountId,
								accessToken,
								organizationId: effectiveAccount.organizationId,
							});

							const primary = mapWindow(payload.rate_limit?.primary_window ?? null);
							const secondary = mapWindow(payload.rate_limit?.secondary_window ?? null);
							const codeReviewRateLimit =
								payload.code_review_rate_limit ??
								payload.additional_rate_limits?.find((entry) => entry.limit_name === "code_review_rate_limit")?.rate_limit ??
								null;
							const codeReview = mapWindow(codeReviewRateLimit?.primary_window ?? null);
							const credits = formatCredits(payload.credits ?? null);
							const additionalLimits = (payload.additional_rate_limits ?? []).filter(
								(entry) => entry.limit_name !== "code_review_rate_limit",
							);

							if (ui.v2Enabled) {
								lines.push(formatUiItem(ui, `${label}${activeSuffix}`));
								lines.push(`  ${formatUiKeyValue(ui, formatLimitTitle(primary.windowMinutes), formatLimitSummary(primary), "muted")}`);
								lines.push(`  ${formatUiKeyValue(ui, formatLimitTitle(secondary.windowMinutes), formatLimitSummary(secondary), "muted")}`);
								if (codeReview.windowMinutes || typeof codeReview.usedPercent === "number" || codeReview.resetAtMs) {
									lines.push(`  ${formatUiKeyValue(ui, "Code review", formatLimitSummary(codeReview), "muted")}`);
								}
								for (const limit of additionalLimits) {
									const extraWindow = mapWindow(limit.rate_limit?.primary_window ?? null);
									lines.push(`  ${formatUiKeyValue(ui, formatExtraName(limit.limit_name ?? limit.metered_feature), formatLimitSummary(extraWindow), "muted")}`);
								}
								if (payload.plan_type) {
									lines.push(`  ${formatUiKeyValue(ui, "Plan", payload.plan_type, "muted")}`);
								}
								if (credits) {
									lines.push(`  ${formatUiKeyValue(ui, "Credits", credits, "muted")}`);
								}
							} else {
								lines.push(`${label}${activeSuffix}:`);
								lines.push(`  ${formatLimitTitle(primary.windowMinutes)}: ${formatLimitSummary(primary)}`);
								lines.push(`  ${formatLimitTitle(secondary.windowMinutes)}: ${formatLimitSummary(secondary)}`);
								if (codeReview.windowMinutes || typeof codeReview.usedPercent === "number" || codeReview.resetAtMs) {
									lines.push(`  Code review: ${formatLimitSummary(codeReview)}`);
								}
								for (const limit of additionalLimits) {
									const extraWindow = mapWindow(limit.rate_limit?.primary_window ?? null);
									lines.push(`  ${formatExtraName(limit.limit_name ?? limit.metered_feature)}: ${formatLimitSummary(extraWindow)}`);
								}
								if (payload.plan_type) {
									lines.push(`  Plan: ${payload.plan_type}`);
								}
								if (credits) {
									lines.push(`  Credits: ${credits}`);
								}
							}
						} catch (error) {
							const message = error instanceof Error ? error.message : String(error);
							if (ui.v2Enabled) {
								lines.push(formatUiItem(ui, `${label}${activeSuffix}`));
								lines.push(`  ${formatUiKeyValue(ui, "Error", message.slice(0, 160), "danger")}`);
							} else {
								lines.push(`${label}${activeSuffix}:`);
								lines.push(`  Error: ${message.slice(0, 160)}`);
							}
						}

						lines.push("");
					}

					if (storageChanged) {
						invalidateAccountManagerCache();
					}

					while (lines.length > 0 && lines[lines.length - 1] === "") {
						lines.pop();
					}

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
