import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
	loadPluginConfig,
	getCodexMode,
	getHashlineBridgeHintsMode,
	getHashlineBridgeHintsBeta,
	getPolicyProfile,
	getToolArgumentRecoveryMode,
	getModelCapabilitySyncMode,
	getModelCapabilityCacheTtlMs,
	getRetryPolicyMode,
	getRerouteNoticeMode,
	getJsonRepairMode,
	getConfigDoctorMode,
	collectConfigDoctorWarnings,
	getCodexTuiV2,
	getCodexTuiColorProfile,
	getCodexTuiGlyphMode,
	getFastSession,
	getFastSessionStrategy,
	getFastSessionMaxInputItems,
	getUnsupportedCodexPolicy,
	getFallbackOnUnsupportedCodexModel,
	getAccountScopeMode,
	getTokenRefreshSkewMs,
	getTokenRefreshSkewMode,
	getPerProjectAccounts,
	getRetryAllAccountsMaxRetries,
	getFallbackToGpt52OnUnsupportedGpt53,
	getUnsupportedCodexFallbackChain,
	getRequestTransformMode,
	getFetchTimeoutMs,
	getStreamStallTimeoutMs,
} from '../lib/config.js';
import type { PluginConfig } from '../lib/types.js';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as logger from '../lib/logger.js';

// Mock the fs module
vi.mock('node:fs', async () => {
	const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
	return {
		...actual,
		existsSync: vi.fn(),
		readFileSync: vi.fn(),
	};
});

// Mock the logger module to track warnings
vi.mock('../lib/logger.js', async () => {
	const actual = await vi.importActual<typeof import('../lib/logger.js')>('../lib/logger.js');
	return {
		...actual,
		logWarn: vi.fn(),
	};
});

describe('Plugin Configuration', () => {
	const mockExistsSync = vi.mocked(fs.existsSync);
	const mockReadFileSync = vi.mocked(fs.readFileSync);
	const envKeys = [
		'CODEX_MODE',
		'CODEX_AUTH_HASHLINE_HINTS_MODE',
		'CODEX_AUTH_HASHLINE_HINTS_BETA',
		'CODEX_AUTH_POLICY_PROFILE',
		'CODEX_AUTH_TOOL_ARGUMENT_RECOVERY_MODE',
		'CODEX_AUTH_MODEL_CAPABILITY_SYNC_MODE',
		'CODEX_AUTH_MODEL_CAPABILITY_CACHE_TTL_MS',
		'CODEX_AUTH_RETRY_POLICY_MODE',
		'CODEX_AUTH_REROUTE_NOTICE_MODE',
		'CODEX_AUTH_JSON_REPAIR_MODE',
		'CODEX_AUTH_CONFIG_DOCTOR_MODE',
		'CODEX_AUTH_ACCOUNT_SCOPE_MODE',
		'CODEX_AUTH_PER_PROJECT_ACCOUNTS',
		'CODEX_AUTH_TOKEN_REFRESH_SKEW_MODE',
		'CODEX_TUI_V2',
		'CODEX_TUI_COLOR_PROFILE',
		'CODEX_TUI_GLYPHS',
		'CODEX_AUTH_FAST_SESSION',
		'CODEX_AUTH_FAST_SESSION_STRATEGY',
		'CODEX_AUTH_FAST_SESSION_MAX_INPUT_ITEMS',
		'CODEX_AUTH_REQUEST_TRANSFORM_MODE',
		'CODEX_AUTH_UNSUPPORTED_MODEL_POLICY',
		'CODEX_AUTH_FALLBACK_UNSUPPORTED_MODEL',
		'CODEX_AUTH_FALLBACK_GPT53_TO_GPT52',
	] as const;
	const originalEnv: Partial<Record<(typeof envKeys)[number], string | undefined>> = {};

	beforeEach(() => {
		for (const key of envKeys) {
			originalEnv[key] = process.env[key];
		}
		vi.clearAllMocks();
	});

	afterEach(() => {
		for (const key of envKeys) {
			const value = originalEnv[key];
			if (value === undefined) {
				delete process.env[key];
			} else {
				process.env[key] = value;
			}
		}
	});

	describe('loadPluginConfig', () => {
		it('should return default config when file does not exist', () => {
			mockExistsSync.mockReturnValue(false);

			const config = loadPluginConfig();

			expect(config).toEqual({
				codexMode: true,
				requestTransformMode: 'native',
				toolArgumentRecoveryMode: 'safe',
				modelCapabilitySyncMode: 'safe',
				modelCapabilityCacheTtlMs: 600_000,
				retryPolicyMode: 'legacy',
				rerouteNoticeMode: 'log',
				jsonRepairMode: 'safe',
				configDoctorMode: 'warn',
				codexTuiV2: true,
				codexTuiColorProfile: 'truecolor',
				codexTuiGlyphMode: 'ascii',
				fastSession: false,
				fastSessionStrategy: 'hybrid',
				fastSessionMaxInputItems: 30,
				retryAllAccountsRateLimited: true,
				retryAllAccountsMaxWaitMs: 0,
				retryAllAccountsMaxRetries: Infinity,
				unsupportedCodexPolicy: 'strict',
				fallbackOnUnsupportedCodexModel: false,
				fallbackToGpt52OnUnsupportedGpt53: true,
				unsupportedCodexFallbackChain: {},
				tokenRefreshSkewMs: 60_000,
				rateLimitToastDebounceMs: 60_000,
				toastDurationMs: 5_000,
				perProjectAccounts: true,
				sessionRecovery: true,
				autoResume: true,
				parallelProbing: false,
				parallelProbingMaxConcurrency: 2,
				emptyResponseMaxRetries: 2,
				emptyResponseRetryDelayMs: 1_000,
				pidOffsetEnabled: false,
				fetchTimeoutMs: 60_000,
				streamStallTimeoutMs: 45_000,
			});
			expect(mockExistsSync).toHaveBeenCalledWith(
				path.join(os.homedir(), '.opencode', 'openai-codex-auth-config.json')
			);
		});

		it('should load config from file when it exists', () => {
			mockExistsSync.mockReturnValue(true);
			mockReadFileSync.mockReturnValue(JSON.stringify({ codexMode: false }));

			const config = loadPluginConfig();

			expect(config).toEqual({
				codexMode: false,
				requestTransformMode: 'native',
				toolArgumentRecoveryMode: 'safe',
				modelCapabilitySyncMode: 'safe',
				modelCapabilityCacheTtlMs: 600_000,
				retryPolicyMode: 'legacy',
				rerouteNoticeMode: 'log',
				jsonRepairMode: 'safe',
				configDoctorMode: 'warn',
				codexTuiV2: true,
				codexTuiColorProfile: 'truecolor',
				codexTuiGlyphMode: 'ascii',
				fastSession: false,
				fastSessionStrategy: 'hybrid',
				fastSessionMaxInputItems: 30,
				retryAllAccountsRateLimited: true,
				retryAllAccountsMaxWaitMs: 0,
				retryAllAccountsMaxRetries: Infinity,
				unsupportedCodexPolicy: 'strict',
				fallbackOnUnsupportedCodexModel: false,
				fallbackToGpt52OnUnsupportedGpt53: true,
				unsupportedCodexFallbackChain: {},
				tokenRefreshSkewMs: 60_000,
				rateLimitToastDebounceMs: 60_000,
				toastDurationMs: 5_000,
				perProjectAccounts: true,
				sessionRecovery: true,
				autoResume: true,
				parallelProbing: false,
				parallelProbingMaxConcurrency: 2,
				emptyResponseMaxRetries: 2,
				emptyResponseRetryDelayMs: 1_000,
				pidOffsetEnabled: false,
				fetchTimeoutMs: 60_000,
				streamStallTimeoutMs: 45_000,
			});
		});

		it('should merge user config with defaults', () => {
			mockExistsSync.mockReturnValue(true);
			mockReadFileSync.mockReturnValue(JSON.stringify({}));

			const config = loadPluginConfig();

			expect(config).toEqual({
				codexMode: true,
				requestTransformMode: 'native',
				toolArgumentRecoveryMode: 'safe',
				modelCapabilitySyncMode: 'safe',
				modelCapabilityCacheTtlMs: 600_000,
				retryPolicyMode: 'legacy',
				rerouteNoticeMode: 'log',
				jsonRepairMode: 'safe',
				configDoctorMode: 'warn',
				codexTuiV2: true,
				codexTuiColorProfile: 'truecolor',
				codexTuiGlyphMode: 'ascii',
				fastSession: false,
				fastSessionStrategy: 'hybrid',
				fastSessionMaxInputItems: 30,
				retryAllAccountsRateLimited: true,
				retryAllAccountsMaxWaitMs: 0,
				retryAllAccountsMaxRetries: Infinity,
				unsupportedCodexPolicy: 'strict',
				fallbackOnUnsupportedCodexModel: false,
				fallbackToGpt52OnUnsupportedGpt53: true,
				unsupportedCodexFallbackChain: {},
				tokenRefreshSkewMs: 60_000,
				rateLimitToastDebounceMs: 60_000,
				toastDurationMs: 5_000,
				perProjectAccounts: true,
				sessionRecovery: true,
				autoResume: true,
				parallelProbing: false,
				parallelProbingMaxConcurrency: 2,
				emptyResponseMaxRetries: 2,
				emptyResponseRetryDelayMs: 1_000,
				pidOffsetEnabled: false,
				fetchTimeoutMs: 60_000,
				streamStallTimeoutMs: 45_000,
			});
		});

		it('should parse UTF-8 BOM-prefixed config files', () => {
			mockExistsSync.mockReturnValue(true);
			mockReadFileSync.mockReturnValue('\ufeff{"codexMode":false}');

			const config = loadPluginConfig();

			expect(config.codexMode).toBe(false);
		});

	it('should handle invalid JSON gracefully', () => {
		mockExistsSync.mockReturnValue(true);
		mockReadFileSync.mockReturnValue('invalid json');

		const mockLogWarn = vi.mocked(logger.logWarn);
		mockLogWarn.mockClear();
		const config = loadPluginConfig();

	expect(config).toEqual({
		codexMode: true,
		requestTransformMode: 'native',
		toolArgumentRecoveryMode: 'safe',
		modelCapabilitySyncMode: 'safe',
		modelCapabilityCacheTtlMs: 600_000,
		retryPolicyMode: 'legacy',
		rerouteNoticeMode: 'log',
		jsonRepairMode: 'safe',
		configDoctorMode: 'warn',
		codexTuiV2: true,
		codexTuiColorProfile: 'truecolor',
		codexTuiGlyphMode: 'ascii',
		fastSession: false,
		fastSessionStrategy: 'hybrid',
		fastSessionMaxInputItems: 30,
		retryAllAccountsRateLimited: true,
		retryAllAccountsMaxWaitMs: 0,
		retryAllAccountsMaxRetries: Infinity,
		unsupportedCodexPolicy: 'strict',
		fallbackOnUnsupportedCodexModel: false,
		fallbackToGpt52OnUnsupportedGpt53: true,
		unsupportedCodexFallbackChain: {},
		tokenRefreshSkewMs: 60_000,
		rateLimitToastDebounceMs: 60_000,
		toastDurationMs: 5_000,
		perProjectAccounts: true,
		sessionRecovery: true,
		autoResume: true,
		parallelProbing: false,
		parallelProbingMaxConcurrency: 2,
		emptyResponseMaxRetries: 2,
		emptyResponseRetryDelayMs: 1_000,
		pidOffsetEnabled: false,
		fetchTimeoutMs: 60_000,
		streamStallTimeoutMs: 45_000,
	});
		expect(mockLogWarn).toHaveBeenCalled();
	});

	it('should handle file read errors gracefully', () => {
		mockExistsSync.mockReturnValue(true);
		mockReadFileSync.mockImplementation(() => {
			throw new Error('Permission denied');
		});

		const mockLogWarn = vi.mocked(logger.logWarn);
		mockLogWarn.mockClear();
		const config = loadPluginConfig();

		expect(config).toEqual({
			codexMode: true,
			requestTransformMode: 'native',
			toolArgumentRecoveryMode: 'safe',
			modelCapabilitySyncMode: 'safe',
			modelCapabilityCacheTtlMs: 600_000,
			retryPolicyMode: 'legacy',
			rerouteNoticeMode: 'log',
			jsonRepairMode: 'safe',
			configDoctorMode: 'warn',
			codexTuiV2: true,
			codexTuiColorProfile: 'truecolor',
			codexTuiGlyphMode: 'ascii',
			fastSession: false,
			fastSessionStrategy: 'hybrid',
			fastSessionMaxInputItems: 30,
			retryAllAccountsRateLimited: true,
			retryAllAccountsMaxWaitMs: 0,
			retryAllAccountsMaxRetries: Infinity,
			unsupportedCodexPolicy: 'strict',
			fallbackOnUnsupportedCodexModel: false,
			fallbackToGpt52OnUnsupportedGpt53: true,
			unsupportedCodexFallbackChain: {},
			tokenRefreshSkewMs: 60_000,
			rateLimitToastDebounceMs: 60_000,
			toastDurationMs: 5_000,
			perProjectAccounts: true,
			sessionRecovery: true,
			autoResume: true,
			parallelProbing: false,
			parallelProbingMaxConcurrency: 2,
			emptyResponseMaxRetries: 2,
			emptyResponseRetryDelayMs: 1_000,
			pidOffsetEnabled: false,
			fetchTimeoutMs: 60_000,
			streamStallTimeoutMs: 45_000,
		});
		expect(mockLogWarn).toHaveBeenCalled();
	});
	});

	describe('getCodexMode', () => {
		it('should return true by default', () => {
			delete process.env.CODEX_MODE;
			const config: PluginConfig = {};

			const result = getCodexMode(config);

			expect(result).toBe(true);
		});

		it('should use config value when env var not set', () => {
			delete process.env.CODEX_MODE;
			const config: PluginConfig = { codexMode: false };

			const result = getCodexMode(config);

			expect(result).toBe(false);
		});

		it('should prioritize env var CODEX_MODE=1 over config', () => {
			process.env.CODEX_MODE = '1';
			const config: PluginConfig = { codexMode: false };

			const result = getCodexMode(config);

			expect(result).toBe(true);
		});

		it('should prioritize env var CODEX_MODE=0 over config', () => {
			process.env.CODEX_MODE = '0';
			const config: PluginConfig = { codexMode: true };

			const result = getCodexMode(config);

			expect(result).toBe(false);
		});

		it('should handle env var with any value other than "1" as false', () => {
			process.env.CODEX_MODE = 'false';
			const config: PluginConfig = { codexMode: true };

			const result = getCodexMode(config);

			expect(result).toBe(false);
		});

		it('should use config codexMode=true when explicitly set', () => {
			delete process.env.CODEX_MODE;
			const config: PluginConfig = { codexMode: true };

			const result = getCodexMode(config);

			expect(result).toBe(true);
		});
	});

	describe('getHashlineBridgeHintsMode', () => {
		it('should default to auto', () => {
			delete process.env.CODEX_AUTH_HASHLINE_HINTS_MODE;
			delete process.env.CODEX_AUTH_HASHLINE_HINTS_BETA;
			expect(getHashlineBridgeHintsMode({})).toBe('auto');
		});

		it('should prefer explicit mode env var over config', () => {
			process.env.CODEX_AUTH_HASHLINE_HINTS_MODE = 'strict';
			process.env.CODEX_AUTH_HASHLINE_HINTS_BETA = '0';
			expect(
				getHashlineBridgeHintsMode({
					hashlineBridgeHintsMode: 'hints',
					hashlineBridgeHintsBeta: false,
				}),
			).toBe('strict');
		});

		it('should use legacy beta env var when mode env var is absent', () => {
			delete process.env.CODEX_AUTH_HASHLINE_HINTS_MODE;
			process.env.CODEX_AUTH_HASHLINE_HINTS_BETA = '1';
			expect(getHashlineBridgeHintsMode({ hashlineBridgeHintsMode: 'off' })).toBe('hints');
		});

		it('should use config mode when env vars are not set', () => {
			delete process.env.CODEX_AUTH_HASHLINE_HINTS_MODE;
			delete process.env.CODEX_AUTH_HASHLINE_HINTS_BETA;
			expect(getHashlineBridgeHintsMode({ hashlineBridgeHintsMode: 'strict' })).toBe(
				'strict',
			);
			expect(getHashlineBridgeHintsMode({ hashlineBridgeHintsMode: 'auto' })).toBe(
				'auto',
			);
		});

		it('should fallback to legacy config boolean when mode key is absent', () => {
			delete process.env.CODEX_AUTH_HASHLINE_HINTS_MODE;
			delete process.env.CODEX_AUTH_HASHLINE_HINTS_BETA;
			expect(getHashlineBridgeHintsMode({ hashlineBridgeHintsBeta: true })).toBe('hints');
			expect(getHashlineBridgeHintsMode({ hashlineBridgeHintsBeta: false })).toBe('off');
		});
	});

	describe('getHashlineBridgeHintsBeta', () => {
		it('should map mode values to boolean helper output', () => {
			delete process.env.CODEX_AUTH_HASHLINE_HINTS_MODE;
			delete process.env.CODEX_AUTH_HASHLINE_HINTS_BETA;
			expect(getHashlineBridgeHintsBeta({ hashlineBridgeHintsMode: 'off' })).toBe(false);
			expect(getHashlineBridgeHintsBeta({ hashlineBridgeHintsMode: 'auto' })).toBe(true);
			expect(getHashlineBridgeHintsBeta({ hashlineBridgeHintsMode: 'hints' })).toBe(true);
			expect(getHashlineBridgeHintsBeta({ hashlineBridgeHintsMode: 'strict' })).toBe(true);
		});

		it('should still honor legacy env toggle', () => {
			delete process.env.CODEX_AUTH_HASHLINE_HINTS_MODE;
			process.env.CODEX_AUTH_HASHLINE_HINTS_BETA = '0';
			expect(getHashlineBridgeHintsBeta({ hashlineBridgeHintsBeta: true })).toBe(false);
			process.env.CODEX_AUTH_HASHLINE_HINTS_BETA = '1';
			expect(getHashlineBridgeHintsBeta({ hashlineBridgeHintsBeta: false })).toBe(true);
		});
	});

	describe('getPolicyProfile', () => {
		it('should default to stable', () => {
			delete process.env.CODEX_AUTH_POLICY_PROFILE;
			expect(getPolicyProfile({})).toBe('stable');
		});

		it('should prefer env over config', () => {
			process.env.CODEX_AUTH_POLICY_PROFILE = 'aggressive';
			expect(getPolicyProfile({ policyProfile: 'stable' })).toBe('aggressive');
		});
	});

	describe('policy-profile defaults', () => {
		it('should apply aggressive defaults when specific modes are unset', () => {
			process.env.CODEX_AUTH_POLICY_PROFILE = 'aggressive';
			delete process.env.CODEX_AUTH_RETRY_POLICY_MODE;
			delete process.env.CODEX_AUTH_REROUTE_NOTICE_MODE;
			delete process.env.CODEX_AUTH_HASHLINE_HINTS_MODE;
			expect(getRetryPolicyMode({})).toBe('route-matrix');
			expect(getRerouteNoticeMode({})).toBe('log+ui');
			expect(getHashlineBridgeHintsMode({})).toBe('strict');
		});

		it('should keep explicit config values over profile defaults', () => {
			process.env.CODEX_AUTH_POLICY_PROFILE = 'aggressive';
			delete process.env.CODEX_AUTH_RETRY_POLICY_MODE;
			expect(getRetryPolicyMode({ retryPolicyMode: 'legacy' })).toBe('legacy');
		});
	});

	describe('getAccountScopeMode', () => {
		it('should default to project under stable profile', () => {
			delete process.env.CODEX_AUTH_POLICY_PROFILE;
			delete process.env.CODEX_AUTH_ACCOUNT_SCOPE_MODE;
			delete process.env.CODEX_AUTH_PER_PROJECT_ACCOUNTS;
			expect(getAccountScopeMode({})).toBe('project');
		});

		it('should respect explicit scope env value', () => {
			process.env.CODEX_AUTH_ACCOUNT_SCOPE_MODE = 'worktree';
			expect(getAccountScopeMode({ accountScopeMode: 'global' })).toBe('worktree');
		});

		it('should map legacy per-project env when scope mode env is unset', () => {
			delete process.env.CODEX_AUTH_ACCOUNT_SCOPE_MODE;
			process.env.CODEX_AUTH_PER_PROJECT_ACCOUNTS = '0';
			expect(getAccountScopeMode({})).toBe('global');
			process.env.CODEX_AUTH_PER_PROJECT_ACCOUNTS = '1';
			expect(getAccountScopeMode({})).toBe('project');
		});

		it('should map perProjectAccounts helper from scope mode', () => {
			expect(getPerProjectAccounts({ accountScopeMode: 'global' })).toBe(false);
			expect(getPerProjectAccounts({ accountScopeMode: 'project' })).toBe(true);
			expect(getPerProjectAccounts({ accountScopeMode: 'worktree' })).toBe(true);
		});
	});

	describe('getTokenRefreshSkewMode', () => {
		it('should default to static under stable profile', () => {
			delete process.env.CODEX_AUTH_POLICY_PROFILE;
			delete process.env.CODEX_AUTH_TOKEN_REFRESH_SKEW_MODE;
			expect(getTokenRefreshSkewMode({})).toBe('static');
		});

		it('should default to adaptive for aggressive profile', () => {
			process.env.CODEX_AUTH_POLICY_PROFILE = 'aggressive';
			delete process.env.CODEX_AUTH_TOKEN_REFRESH_SKEW_MODE;
			expect(getTokenRefreshSkewMode({})).toBe('adaptive');
		});

		it('should prefer explicit env value over profile', () => {
			process.env.CODEX_AUTH_POLICY_PROFILE = 'aggressive';
			process.env.CODEX_AUTH_TOKEN_REFRESH_SKEW_MODE = 'static';
			expect(getTokenRefreshSkewMode({})).toBe('static');
		});
	});

	describe('getCodexTuiV2', () => {
		it('should default to true', () => {
			delete process.env.CODEX_TUI_V2;
			expect(getCodexTuiV2({})).toBe(true);
		});

		it('should use config value when env var not set', () => {
			delete process.env.CODEX_TUI_V2;
			expect(getCodexTuiV2({ codexTuiV2: false })).toBe(false);
		});

		it('should prioritize env value over config', () => {
			process.env.CODEX_TUI_V2 = '0';
			expect(getCodexTuiV2({ codexTuiV2: true })).toBe(false);
			process.env.CODEX_TUI_V2 = '1';
			expect(getCodexTuiV2({ codexTuiV2: false })).toBe(true);
		});
	});

	describe('getCodexTuiColorProfile', () => {
		it('should default to truecolor', () => {
			delete process.env.CODEX_TUI_COLOR_PROFILE;
			expect(getCodexTuiColorProfile({})).toBe('truecolor');
		});

		it('should use config value when env var not set', () => {
			delete process.env.CODEX_TUI_COLOR_PROFILE;
			expect(getCodexTuiColorProfile({ codexTuiColorProfile: 'ansi16' })).toBe('ansi16');
		});

		it('should prioritize valid env value over config', () => {
			process.env.CODEX_TUI_COLOR_PROFILE = 'ansi256';
			expect(getCodexTuiColorProfile({ codexTuiColorProfile: 'ansi16' })).toBe('ansi256');
		});

		it('should ignore invalid env value and fallback to config/default', () => {
			process.env.CODEX_TUI_COLOR_PROFILE = 'invalid-profile';
			expect(getCodexTuiColorProfile({ codexTuiColorProfile: 'ansi16' })).toBe('ansi16');
			expect(getCodexTuiColorProfile({})).toBe('truecolor');
		});
	});

	describe('getCodexTuiGlyphMode', () => {
		it('should default to ascii', () => {
			delete process.env.CODEX_TUI_GLYPHS;
			expect(getCodexTuiGlyphMode({})).toBe('ascii');
		});

		it('should use config value when env var not set', () => {
			delete process.env.CODEX_TUI_GLYPHS;
			expect(getCodexTuiGlyphMode({ codexTuiGlyphMode: 'unicode' })).toBe('unicode');
		});

		it('should prioritize valid env value over config', () => {
			process.env.CODEX_TUI_GLYPHS = 'auto';
			expect(getCodexTuiGlyphMode({ codexTuiGlyphMode: 'ascii' })).toBe('auto');
		});

		it('should ignore invalid env value and fallback to config/default', () => {
			process.env.CODEX_TUI_GLYPHS = 'invalid';
			expect(getCodexTuiGlyphMode({ codexTuiGlyphMode: 'unicode' })).toBe('unicode');
			expect(getCodexTuiGlyphMode({})).toBe('ascii');
		});
	});

	describe('getFastSession', () => {
		it('should default to false', () => {
			delete process.env.CODEX_AUTH_FAST_SESSION;
			expect(getFastSession({})).toBe(false);
		});

		it('should use config value when env var not set', () => {
			delete process.env.CODEX_AUTH_FAST_SESSION;
			expect(getFastSession({ fastSession: true })).toBe(true);
		});

		it('should prioritize env var over config', () => {
			process.env.CODEX_AUTH_FAST_SESSION = '0';
			expect(getFastSession({ fastSession: true })).toBe(false);
			process.env.CODEX_AUTH_FAST_SESSION = '1';
			expect(getFastSession({ fastSession: false })).toBe(true);
		});
	});

	describe('getFallbackToGpt52OnUnsupportedGpt53', () => {
		it('should default to true', () => {
			delete process.env.CODEX_AUTH_FALLBACK_GPT53_TO_GPT52;
			expect(getFallbackToGpt52OnUnsupportedGpt53({})).toBe(true);
		});

		it('should use config value when env var not set', () => {
			delete process.env.CODEX_AUTH_FALLBACK_GPT53_TO_GPT52;
			expect(
				getFallbackToGpt52OnUnsupportedGpt53({
					fallbackToGpt52OnUnsupportedGpt53: true,
				}),
			).toBe(true);
		});

		it('should prioritize env var over config', () => {
			process.env.CODEX_AUTH_FALLBACK_GPT53_TO_GPT52 = '0';
			expect(
				getFallbackToGpt52OnUnsupportedGpt53({
					fallbackToGpt52OnUnsupportedGpt53: true,
				}),
			).toBe(false);
			process.env.CODEX_AUTH_FALLBACK_GPT53_TO_GPT52 = '1';
			expect(
				getFallbackToGpt52OnUnsupportedGpt53({
					fallbackToGpt52OnUnsupportedGpt53: false,
				}),
			).toBe(true);
		});
	});

	describe('getUnsupportedCodexPolicy', () => {
		it('should default to strict', () => {
			delete process.env.CODEX_AUTH_UNSUPPORTED_MODEL_POLICY;
			delete process.env.CODEX_AUTH_FALLBACK_UNSUPPORTED_MODEL;
			expect(getUnsupportedCodexPolicy({})).toBe('strict');
		});

		it('should use config policy when set', () => {
			delete process.env.CODEX_AUTH_UNSUPPORTED_MODEL_POLICY;
			expect(getUnsupportedCodexPolicy({ unsupportedCodexPolicy: 'fallback' })).toBe('fallback');
		});

		it('should prioritize env policy over config', () => {
			process.env.CODEX_AUTH_UNSUPPORTED_MODEL_POLICY = 'strict';
			expect(getUnsupportedCodexPolicy({ unsupportedCodexPolicy: 'fallback' })).toBe('strict');
			process.env.CODEX_AUTH_UNSUPPORTED_MODEL_POLICY = 'fallback';
			expect(getUnsupportedCodexPolicy({ unsupportedCodexPolicy: 'strict' })).toBe('fallback');
		});

		it('should map legacy fallback flag to fallback policy when policy key missing', () => {
			delete process.env.CODEX_AUTH_UNSUPPORTED_MODEL_POLICY;
			expect(getUnsupportedCodexPolicy({ fallbackOnUnsupportedCodexModel: true })).toBe('fallback');
		});

		it('should map legacy env fallback toggle when policy env is unset', () => {
			delete process.env.CODEX_AUTH_UNSUPPORTED_MODEL_POLICY;
			process.env.CODEX_AUTH_FALLBACK_UNSUPPORTED_MODEL = '1';
			expect(getUnsupportedCodexPolicy({})).toBe('fallback');
			process.env.CODEX_AUTH_FALLBACK_UNSUPPORTED_MODEL = '0';
			expect(getUnsupportedCodexPolicy({})).toBe('strict');
		});
	});

	describe('getFallbackOnUnsupportedCodexModel', () => {
		it('should default to false (strict policy)', () => {
			delete process.env.CODEX_AUTH_FALLBACK_UNSUPPORTED_MODEL;
			delete process.env.CODEX_AUTH_UNSUPPORTED_MODEL_POLICY;
			expect(getFallbackOnUnsupportedCodexModel({})).toBe(false);
		});

		it('should use explicit policy when set', () => {
			delete process.env.CODEX_AUTH_UNSUPPORTED_MODEL_POLICY;
			delete process.env.CODEX_AUTH_FALLBACK_UNSUPPORTED_MODEL;
			expect(getFallbackOnUnsupportedCodexModel({ unsupportedCodexPolicy: 'fallback' })).toBe(true);
			expect(getFallbackOnUnsupportedCodexModel({ unsupportedCodexPolicy: 'strict' })).toBe(false);
		});

		it('should still support legacy env toggle', () => {
			process.env.CODEX_AUTH_FALLBACK_UNSUPPORTED_MODEL = '0';
			delete process.env.CODEX_AUTH_UNSUPPORTED_MODEL_POLICY;
			expect(getFallbackOnUnsupportedCodexModel({})).toBe(false);
			process.env.CODEX_AUTH_FALLBACK_UNSUPPORTED_MODEL = '1';
			expect(getFallbackOnUnsupportedCodexModel({})).toBe(true);
		});

		it('policy env overrides legacy toggles', () => {
			process.env.CODEX_AUTH_UNSUPPORTED_MODEL_POLICY = 'strict';
			process.env.CODEX_AUTH_FALLBACK_UNSUPPORTED_MODEL = '1';
			expect(getFallbackOnUnsupportedCodexModel({ unsupportedCodexPolicy: 'fallback' })).toBe(false);
			process.env.CODEX_AUTH_UNSUPPORTED_MODEL_POLICY = 'fallback';
			process.env.CODEX_AUTH_FALLBACK_UNSUPPORTED_MODEL = '0';
			expect(getFallbackOnUnsupportedCodexModel({ unsupportedCodexPolicy: 'strict' })).toBe(true);
		});
	});

	describe('getUnsupportedCodexFallbackChain', () => {
		it('returns normalized fallback chain entries', () => {
			const result = getUnsupportedCodexFallbackChain({
				unsupportedCodexFallbackChain: {
					'OpenAI/GPT-5.3-CODEX-SPARK': [' gpt-5.3-codex ', 'gpt-5.2-codex'],
				},
			});

			expect(result).toEqual({
				'gpt-5.3-codex-spark': ['gpt-5.3-codex', 'gpt-5.2-codex'],
			});
		});

		it('returns empty object for missing/invalid chain', () => {
			expect(getUnsupportedCodexFallbackChain({})).toEqual({});
			expect(
				getUnsupportedCodexFallbackChain({
					unsupportedCodexFallbackChain: {
						'': ['   '],
					},
				}),
			).toEqual({});
		});
	});

	describe('getFastSessionMaxInputItems', () => {
		it('should default to 30', () => {
			delete process.env.CODEX_AUTH_FAST_SESSION_MAX_INPUT_ITEMS;
			expect(getFastSessionMaxInputItems({})).toBe(30);
		});

		it('should use config value when env var not set', () => {
			delete process.env.CODEX_AUTH_FAST_SESSION_MAX_INPUT_ITEMS;
			expect(getFastSessionMaxInputItems({ fastSessionMaxInputItems: 18 })).toBe(18);
		});

		it('should clamp to minimum 8', () => {
			process.env.CODEX_AUTH_FAST_SESSION_MAX_INPUT_ITEMS = '2';
			expect(getFastSessionMaxInputItems({})).toBe(8);
		});
	});

	describe('getFastSessionStrategy', () => {
		it('should default to hybrid', () => {
			delete process.env.CODEX_AUTH_FAST_SESSION_STRATEGY;
			expect(getFastSessionStrategy({})).toBe('hybrid');
		});

		it('should use config value', () => {
			delete process.env.CODEX_AUTH_FAST_SESSION_STRATEGY;
			expect(getFastSessionStrategy({ fastSessionStrategy: 'always' })).toBe('always');
		});

		it('should prioritize env value', () => {
			process.env.CODEX_AUTH_FAST_SESSION_STRATEGY = 'always';
			expect(getFastSessionStrategy({ fastSessionStrategy: 'hybrid' })).toBe('always');
			process.env.CODEX_AUTH_FAST_SESSION_STRATEGY = 'hybrid';
			expect(getFastSessionStrategy({ fastSessionStrategy: 'always' })).toBe('hybrid');
		});
	});

	describe('getRequestTransformMode', () => {
		it('should default to native', () => {
			delete process.env.CODEX_AUTH_REQUEST_TRANSFORM_MODE;
			expect(getRequestTransformMode({})).toBe('native');
		});

		it('should use config value when env var not set', () => {
			delete process.env.CODEX_AUTH_REQUEST_TRANSFORM_MODE;
			expect(getRequestTransformMode({ requestTransformMode: 'legacy' })).toBe('legacy');
		});

		it('should prioritize env value', () => {
			process.env.CODEX_AUTH_REQUEST_TRANSFORM_MODE = 'legacy';
			expect(getRequestTransformMode({ requestTransformMode: 'native' })).toBe('legacy');
			process.env.CODEX_AUTH_REQUEST_TRANSFORM_MODE = 'native';
			expect(getRequestTransformMode({ requestTransformMode: 'legacy' })).toBe('native');
		});
	});

	describe('getToolArgumentRecoveryMode', () => {
		it('should default to safe', () => {
			delete process.env.CODEX_AUTH_TOOL_ARGUMENT_RECOVERY_MODE;
			expect(getToolArgumentRecoveryMode({})).toBe('safe');
		});

		it('should use config value when env var not set', () => {
			delete process.env.CODEX_AUTH_TOOL_ARGUMENT_RECOVERY_MODE;
			expect(getToolArgumentRecoveryMode({ toolArgumentRecoveryMode: 'off' })).toBe('off');
		});

		it('should prioritize valid env value over config', () => {
			process.env.CODEX_AUTH_TOOL_ARGUMENT_RECOVERY_MODE = 'off';
			expect(getToolArgumentRecoveryMode({ toolArgumentRecoveryMode: 'safe' })).toBe('off');
			process.env.CODEX_AUTH_TOOL_ARGUMENT_RECOVERY_MODE = 'safe';
			expect(getToolArgumentRecoveryMode({ toolArgumentRecoveryMode: 'off' })).toBe('safe');
			process.env.CODEX_AUTH_TOOL_ARGUMENT_RECOVERY_MODE = 'schema-safe';
			expect(getToolArgumentRecoveryMode({ toolArgumentRecoveryMode: 'off' })).toBe('schema-safe');
		});

		it('should ignore invalid env values', () => {
			process.env.CODEX_AUTH_TOOL_ARGUMENT_RECOVERY_MODE = 'invalid';
			expect(getToolArgumentRecoveryMode({ toolArgumentRecoveryMode: 'off' })).toBe('off');
			expect(getToolArgumentRecoveryMode({})).toBe('safe');
		});
	});

	describe('getModelCapabilitySyncMode', () => {
		it('should default to safe', () => {
			delete process.env.CODEX_AUTH_MODEL_CAPABILITY_SYNC_MODE;
			expect(getModelCapabilitySyncMode({})).toBe('safe');
		});

		it('should use config value when env var not set', () => {
			delete process.env.CODEX_AUTH_MODEL_CAPABILITY_SYNC_MODE;
			expect(getModelCapabilitySyncMode({ modelCapabilitySyncMode: 'off' })).toBe('off');
		});

		it('should prioritize valid env value over config', () => {
			process.env.CODEX_AUTH_MODEL_CAPABILITY_SYNC_MODE = 'off';
			expect(getModelCapabilitySyncMode({ modelCapabilitySyncMode: 'safe' })).toBe('off');
			process.env.CODEX_AUTH_MODEL_CAPABILITY_SYNC_MODE = 'safe';
			expect(getModelCapabilitySyncMode({ modelCapabilitySyncMode: 'off' })).toBe('safe');
		});
	});

	describe('getModelCapabilityCacheTtlMs', () => {
		it('should default to 600000', () => {
			delete process.env.CODEX_AUTH_MODEL_CAPABILITY_CACHE_TTL_MS;
			expect(getModelCapabilityCacheTtlMs({})).toBe(600000);
		});

		it('should use config value when env var not set', () => {
			delete process.env.CODEX_AUTH_MODEL_CAPABILITY_CACHE_TTL_MS;
			expect(getModelCapabilityCacheTtlMs({ modelCapabilityCacheTtlMs: 120000 })).toBe(120000);
		});

		it('should clamp to minimum 1000', () => {
			process.env.CODEX_AUTH_MODEL_CAPABILITY_CACHE_TTL_MS = '10';
			expect(getModelCapabilityCacheTtlMs({})).toBe(1000);
		});
	});

	describe('getRetryPolicyMode', () => {
		it('should default to legacy', () => {
			delete process.env.CODEX_AUTH_RETRY_POLICY_MODE;
			expect(getRetryPolicyMode({})).toBe('legacy');
		});

		it('should use config value when env var not set', () => {
			delete process.env.CODEX_AUTH_RETRY_POLICY_MODE;
			expect(getRetryPolicyMode({ retryPolicyMode: 'route-matrix' })).toBe('route-matrix');
		});

		it('should prioritize valid env value over config', () => {
			process.env.CODEX_AUTH_RETRY_POLICY_MODE = 'route-matrix';
			expect(getRetryPolicyMode({ retryPolicyMode: 'legacy' })).toBe('route-matrix');
			process.env.CODEX_AUTH_RETRY_POLICY_MODE = 'legacy';
			expect(getRetryPolicyMode({ retryPolicyMode: 'route-matrix' })).toBe('legacy');
		});

		it('should ignore invalid env values', () => {
			process.env.CODEX_AUTH_RETRY_POLICY_MODE = 'invalid';
			expect(getRetryPolicyMode({ retryPolicyMode: 'route-matrix' })).toBe('route-matrix');
			expect(getRetryPolicyMode({})).toBe('legacy');
		});
	});

	describe('getRerouteNoticeMode', () => {
		it('should default to log', () => {
			delete process.env.CODEX_AUTH_REROUTE_NOTICE_MODE;
			expect(getRerouteNoticeMode({})).toBe('log');
		});

		it('should prioritize valid env value over config', () => {
			process.env.CODEX_AUTH_REROUTE_NOTICE_MODE = 'log+ui';
			expect(getRerouteNoticeMode({ rerouteNoticeMode: 'off' })).toBe('log+ui');
		});

		it('should ignore invalid env values', () => {
			process.env.CODEX_AUTH_REROUTE_NOTICE_MODE = 'invalid';
			expect(getRerouteNoticeMode({ rerouteNoticeMode: 'off' })).toBe('off');
			expect(getRerouteNoticeMode({})).toBe('log');
		});
	});

	describe('getJsonRepairMode', () => {
		it('should default to safe', () => {
			delete process.env.CODEX_AUTH_JSON_REPAIR_MODE;
			expect(getJsonRepairMode({})).toBe('safe');
		});

		it('should prioritize env over config', () => {
			process.env.CODEX_AUTH_JSON_REPAIR_MODE = 'off';
			expect(getJsonRepairMode({ jsonRepairMode: 'safe' })).toBe('off');
		});
	});

	describe('getConfigDoctorMode', () => {
		it('should default to warn', () => {
			delete process.env.CODEX_AUTH_CONFIG_DOCTOR_MODE;
			expect(getConfigDoctorMode({})).toBe('warn');
		});

		it('should respect config and env', () => {
			delete process.env.CODEX_AUTH_CONFIG_DOCTOR_MODE;
			expect(getConfigDoctorMode({ configDoctorMode: 'off' })).toBe('off');
			process.env.CODEX_AUTH_CONFIG_DOCTOR_MODE = 'warn';
			expect(getConfigDoctorMode({ configDoctorMode: 'off' })).toBe('warn');
		});
	});

	describe('collectConfigDoctorWarnings', () => {
		it('reports conflicting legacy and modern hashline settings', () => {
			const warnings = collectConfigDoctorWarnings({
				hashlineBridgeHintsBeta: false,
				hashlineBridgeHintsMode: 'strict',
			});
			expect(warnings.join('\n')).toContain('Conflicting hashline settings');
		});

		it('reports ignored model capability ttl when sync is off', () => {
			const warnings = collectConfigDoctorWarnings({
				modelCapabilitySyncMode: 'off',
				modelCapabilityCacheTtlMs: 120000,
			});
			expect(warnings.join('\n')).toContain('TTL is ignored');
		});

		it('reports conflicting unsupported-model fallback settings', () => {
			const warnings = collectConfigDoctorWarnings({
				unsupportedCodexPolicy: 'strict',
				fallbackOnUnsupportedCodexModel: true,
			});
			expect(warnings.join('\n')).toContain('Conflicting unsupported-model settings');
		});

		it('reports conflicting account scope settings', () => {
			const warnings = collectConfigDoctorWarnings({
				accountScopeMode: 'worktree',
				perProjectAccounts: false,
			});
			expect(warnings.join('\n')).toContain('Conflicting account scope settings');
		});

		it('uses effective env mode for reroute toast-duration warning', () => {
			process.env.CODEX_AUTH_REROUTE_NOTICE_MODE = 'log+ui';
			const warnings = collectConfigDoctorWarnings({
				rerouteNoticeMode: 'off',
				toastDurationMs: 1000,
			});
			expect(warnings.join('\n')).toContain('rerouteNoticeMode="log+ui"');
		});

		it('uses effective env toast duration for reroute warning', () => {
			process.env.CODEX_AUTH_REROUTE_NOTICE_MODE = 'log+ui';
			process.env.CODEX_AUTH_TOAST_DURATION_MS = '1000';
			const warnings = collectConfigDoctorWarnings({});
			expect(warnings.join('\n')).toContain('rerouteNoticeMode="log+ui"');
		});
	});

	describe('Priority order', () => {
		it('should follow priority: env var > config file > default', () => {
			// Test 1: env var overrides config
			process.env.CODEX_MODE = '0';
			expect(getCodexMode({ codexMode: true })).toBe(false);

			// Test 2: config overrides default
			delete process.env.CODEX_MODE;
			expect(getCodexMode({ codexMode: false })).toBe(false);

			// Test 3: default when neither set
			expect(getCodexMode({})).toBe(true);
		});
	});

	describe('Schema validation warnings', () => {
		it('should log warning when config has invalid properties', () => {
			mockExistsSync.mockReturnValue(true);
			mockReadFileSync.mockReturnValue(JSON.stringify({ 
				codexMode: 'not-a-boolean',
				unknownProperty: 'value'
			}));

			const mockLogWarn = vi.mocked(logger.logWarn);
			mockLogWarn.mockClear();
			loadPluginConfig();

			expect(mockLogWarn).toHaveBeenCalledWith(
				expect.stringContaining('Plugin config validation warnings')
			);
		});
	});

	describe('resolveNumberSetting without min option', () => {
		it('should return candidate without min constraint via getRetryAllAccountsMaxRetries', () => {
			delete process.env.CODEX_AUTH_RETRY_ALL_MAX_RETRIES;
			const config: PluginConfig = { retryAllAccountsMaxRetries: 5 };
			const result = getRetryAllAccountsMaxRetries(config);
			expect(result).toBe(5);
		});

		it('should return env value without min constraint', () => {
			process.env.CODEX_AUTH_TOKEN_REFRESH_SKEW_MS = '30000';
			const config: PluginConfig = { tokenRefreshSkewMs: 60000 };
			const result = getTokenRefreshSkewMs(config);
			expect(result).toBe(30000);
			delete process.env.CODEX_AUTH_TOKEN_REFRESH_SKEW_MS;
		});
	});

	describe('timeout settings', () => {
		it('should read fetch timeout from config', () => {
			const config: PluginConfig = { fetchTimeoutMs: 120000 };
			expect(getFetchTimeoutMs(config)).toBe(120000);
		});

		it('should read stream stall timeout from env', () => {
			process.env.CODEX_AUTH_STREAM_STALL_TIMEOUT_MS = '30000';
			expect(getStreamStallTimeoutMs({})).toBe(30000);
			delete process.env.CODEX_AUTH_STREAM_STALL_TIMEOUT_MS;
		});
	});
});
