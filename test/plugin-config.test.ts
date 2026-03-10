import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
	loadPluginConfig,
	savePluginConfigMutation,
	getCodexMode,
	getCodexTuiV2,
	getCodexTuiColorProfile,
	getCodexTuiGlyphMode,
	getBeginnerSafeMode,
	getFastSession,
	getFastSessionStrategy,
	getFastSessionMaxInputItems,
	getRetryProfile,
	getRetryBudgetOverrides,
	getUnsupportedCodexPolicy,
	getFallbackOnUnsupportedCodexModel,
	getTokenRefreshSkewMs,
	getRetryAllAccountsMaxRetries,
	getFallbackToGpt52OnUnsupportedGpt53,
	getUnsupportedCodexFallbackChain,
	getRequestTransformMode,
	getFetchTimeoutMs,
	getStreamStallTimeoutMs,
	getSyncFromCodexMultiAuthEnabled,
	setSyncFromCodexMultiAuthEnabled,
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
		promises: {
			...actual.promises,
			mkdir: vi.fn(),
			readFile: vi.fn(),
			readdir: vi.fn(),
			rename: vi.fn(),
			stat: vi.fn(),
			unlink: vi.fn(),
			writeFile: vi.fn(),
		},
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
	const mockMkdir = vi.mocked(fs.promises.mkdir);
	const mockReadFile = vi.mocked(fs.promises.readFile);
	const mockReaddir = vi.mocked(fs.promises.readdir);
	const mockRename = vi.mocked(fs.promises.rename);
	const mockStat = vi.mocked(fs.promises.stat);
	const mockUnlink = vi.mocked(fs.promises.unlink);
	const mockWriteFile = vi.mocked(fs.promises.writeFile);
	const mockLogWarn = vi.mocked(logger.logWarn);
	const envKeys = [
		'CODEX_MODE',
		'CODEX_TUI_V2',
		'CODEX_TUI_COLOR_PROFILE',
		'CODEX_TUI_GLYPHS',
		'CODEX_AUTH_FAST_SESSION',
		'CODEX_AUTH_BEGINNER_SAFE_MODE',
		'CODEX_AUTH_FAST_SESSION_STRATEGY',
		'CODEX_AUTH_FAST_SESSION_MAX_INPUT_ITEMS',
		'CODEX_AUTH_RETRY_PROFILE',
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
		mockExistsSync.mockReturnValue(false);
		mockReadFileSync.mockReturnValue('{}');
		mockMkdir.mockResolvedValue(undefined);
		mockReadFile.mockResolvedValue('{}');
		mockReaddir.mockResolvedValue([]);
		mockRename.mockResolvedValue(undefined);
		mockStat.mockResolvedValue({ mtimeMs: Date.now() } as fs.Stats);
		mockUnlink.mockResolvedValue(undefined);
		mockWriteFile.mockResolvedValue(undefined);
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
				codexTuiV2: true,
				codexTuiColorProfile: 'truecolor',
				codexTuiGlyphMode: 'ascii',
				beginnerSafeMode: false,
				fastSession: false,
				fastSessionStrategy: 'hybrid',
				fastSessionMaxInputItems: 30,
				retryProfile: 'balanced',
				retryBudgetOverrides: {},
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
				codexTuiV2: true,
				codexTuiColorProfile: 'truecolor',
				codexTuiGlyphMode: 'ascii',
				beginnerSafeMode: false,
				fastSession: false,
				fastSessionStrategy: 'hybrid',
				fastSessionMaxInputItems: 30,
				retryProfile: 'balanced',
				retryBudgetOverrides: {},
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
			mockReadFileSync.mockReturnValue(JSON.stringify({
				experimental: { syncFromCodexMultiAuth: { enabled: true } },
			}));

			const config = loadPluginConfig();

			expect(config).toEqual({
				codexMode: true,
				requestTransformMode: 'native',
				experimental: {
					syncFromCodexMultiAuth: {
						enabled: true,
					},
				},
				codexTuiV2: true,
				codexTuiColorProfile: 'truecolor',
				codexTuiGlyphMode: 'ascii',
				beginnerSafeMode: false,
				fastSession: false,
				fastSessionStrategy: 'hybrid',
				fastSessionMaxInputItems: 30,
				retryProfile: 'balanced',
				retryBudgetOverrides: {},
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
		codexTuiV2: true,
		codexTuiColorProfile: 'truecolor',
		codexTuiGlyphMode: 'ascii',
		beginnerSafeMode: false,
		fastSession: false,
		fastSessionStrategy: 'hybrid',
		fastSessionMaxInputItems: 30,
		retryProfile: 'balanced',
		retryBudgetOverrides: {},
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
			codexTuiV2: true,
			codexTuiColorProfile: 'truecolor',
			codexTuiGlyphMode: 'ascii',
			beginnerSafeMode: false,
			fastSession: false,
			fastSessionStrategy: 'hybrid',
			fastSessionMaxInputItems: 30,
			retryProfile: 'balanced',
			retryBudgetOverrides: {},
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

	describe('getBeginnerSafeMode', () => {
		it('should default to false', () => {
			delete process.env.CODEX_AUTH_BEGINNER_SAFE_MODE;
			expect(getBeginnerSafeMode({})).toBe(false);
		});

		it('should use config value when env var not set', () => {
			delete process.env.CODEX_AUTH_BEGINNER_SAFE_MODE;
			expect(getBeginnerSafeMode({ beginnerSafeMode: true })).toBe(true);
		});

		it('should prioritize env var over config', () => {
			process.env.CODEX_AUTH_BEGINNER_SAFE_MODE = '1';
			expect(getBeginnerSafeMode({ beginnerSafeMode: false })).toBe(true);
			process.env.CODEX_AUTH_BEGINNER_SAFE_MODE = '0';
			expect(getBeginnerSafeMode({ beginnerSafeMode: true })).toBe(false);
		});
	});

	describe('retry profile and budget overrides', () => {
		it('should default retry profile to balanced', () => {
			delete process.env.CODEX_AUTH_RETRY_PROFILE;
			expect(getRetryProfile({})).toBe('balanced');
		});

		it('should prioritize retry profile env over config', () => {
			process.env.CODEX_AUTH_RETRY_PROFILE = 'aggressive';
			expect(getRetryProfile({ retryProfile: 'conservative' })).toBe('aggressive');
		});

		it('should normalize retry budget overrides', () => {
			const overrides = getRetryBudgetOverrides({
				retryBudgetOverrides: {
					authRefresh: 2.8,
					network: -3,
					server: 4,
					rateLimitShort: 1,
					rateLimitGlobal: 5,
					emptyResponse: 2,
				},
			});
			expect(overrides).toEqual({
				authRefresh: 2,
				server: 4,
				rateLimitShort: 1,
				rateLimitGlobal: 5,
				emptyResponse: 2,
			});
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

	describe('experimental sync settings', () => {
		it('defaults sync-from-codex-multi-auth to false', () => {
			expect(getSyncFromCodexMultiAuthEnabled({})).toBe(false);
		});

		it('reads sync-from-codex-multi-auth from config', () => {
			expect(
				getSyncFromCodexMultiAuthEnabled({
					experimental: {
						syncFromCodexMultiAuth: {
							enabled: true,
						},
					},
				}),
			).toBe(true);
		});

		it('persists sync-from-codex-multi-auth while preserving unrelated keys', async () => {
			mockExistsSync.mockReturnValue(true);
			mockReadFile.mockResolvedValue(
				JSON.stringify({
					codexMode: false,
					customKey: 'keep-me',
				}),
			);

			await setSyncFromCodexMultiAuthEnabled(true);

			expect(mockMkdir).toHaveBeenCalledWith(
				path.join(os.homedir(), '.opencode'),
				{ recursive: true },
			);
			expect(mockWriteFile).toHaveBeenCalledTimes(2);
			// calls[0] is the lock file write, calls[1] is the temp config write
			const [writtenPath, writtenContent] = mockWriteFile.mock.calls[1] ?? [];
			expect(String(writtenPath)).toContain('.tmp');
			expect(mockRename).toHaveBeenCalled();
			expect(JSON.parse(String(writtenContent))).toEqual({
				codexMode: false,
				customKey: 'keep-me',
				experimental: {
					syncFromCodexMultiAuth: {
						enabled: true,
					},
				},
			});
			expect(mockUnlink).not.toHaveBeenCalledWith(
				path.join(os.homedir(), '.opencode', 'openai-codex-auth-config.json'),
			);
		});

		it('creates a new config file when enabling sync on a missing config', async () => {
			mockExistsSync.mockReturnValue(false);

			await setSyncFromCodexMultiAuthEnabled(true);

			const [, writtenContent] = mockWriteFile.mock.calls[1] ?? [];
			expect(JSON.parse(String(writtenContent))).toEqual({
				experimental: {
					syncFromCodexMultiAuth: {
						enabled: true,
					},
				},
			});
		});

		it('throws when mutating an invalid existing config file to avoid clobbering it', async () => {
			mockExistsSync.mockReturnValue(true);
			mockReadFile.mockResolvedValue('invalid json');

			await expect(savePluginConfigMutation((current) => current)).rejects.toThrow();
			expect(mockRename).not.toHaveBeenCalled();
		});

		it('rejects array roots when reading raw plugin config', async () => {
			mockExistsSync.mockReturnValue(true);
			mockReadFile.mockResolvedValue('[]');

			await expect(savePluginConfigMutation((current) => current)).rejects.toThrow(
				'Plugin config root must be a JSON object',
			);
		});

		it('throws when toggling sync setting on malformed config to preserve existing settings', async () => {
			mockExistsSync.mockReturnValue(true);
			mockReadFile.mockResolvedValue('invalid json');

			await expect(setSyncFromCodexMultiAuthEnabled(true)).rejects.toThrow();
			expect(mockRename).not.toHaveBeenCalled();
		});

		it('cleans up temp config files when the initial rename fails', async () => {
			mockExistsSync.mockReturnValue(false);
			mockRename.mockRejectedValueOnce(Object.assign(new Error('rename failed'), { code: 'EACCES' }));

			await expect(setSyncFromCodexMultiAuthEnabled(true)).rejects.toThrow('rename failed');
			expect(mockUnlink).toHaveBeenCalledWith(expect.stringContaining('.tmp'));
		});

		it('cleans up temp config files when the Windows fallback retry fails', async () => {
			const originalPlatform = process.platform;
			Object.defineProperty(process, 'platform', { value: 'win32' });
			mockExistsSync.mockImplementation((filePath) =>
				String(filePath).endsWith('openai-codex-auth-config.json'),
			);
			let renameCalls = 0;
			mockRename.mockImplementation(async (source, destination) => {
				if (String(source).includes('.tmp') && String(destination).endsWith('openai-codex-auth-config.json')) {
					renameCalls += 1;
					if (renameCalls <= 2) {
						throw Object.assign(new Error('rename failed'), { code: 'EPERM' });
					}
				}
				return undefined;
			});

			try {
				await expect(setSyncFromCodexMultiAuthEnabled(true)).rejects.toThrow('rename failed');
				expect(mockUnlink).toHaveBeenCalledWith(expect.stringContaining('.tmp'));
			} finally {
				Object.defineProperty(process, 'platform', { value: originalPlatform });
			}
		});

		it('recovers stale config lock files before mutating config', async () => {
			const configPath = path.join(os.homedir(), '.opencode', 'openai-codex-auth-config.json');
			const lockPath = `${configPath}.lock`;
			const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => {
				const error = new Error('process not found') as NodeJS.ErrnoException;
				error.code = 'ESRCH';
				throw error;
			});
			mockExistsSync.mockReturnValue(true);
			mockReadFile.mockImplementation(async (filePath: Parameters<typeof fs.promises.readFile>[0]) => {
				if (String(filePath) === lockPath) {
					return '424242';
				}
				if (String(filePath).includes('.stale')) {
					return '424242';
				}
				return JSON.stringify({ codexMode: false });
			});
			mockWriteFile.mockImplementation(async (filePath) => {
				if (String(filePath) === lockPath && mockWriteFile.mock.calls.length === 1) {
					const error = new Error('exists') as NodeJS.ErrnoException;
					error.code = 'EEXIST';
					throw error;
				}
				return undefined;
			});

			try {
				await expect(setSyncFromCodexMultiAuthEnabled(true)).resolves.toBeUndefined();
				expect(mockUnlink).toHaveBeenCalledWith(expect.stringContaining('.stale'));
				expect(killSpy).toHaveBeenCalledWith(424242, 0);
				expect(mockRename).toHaveBeenCalled();
			} finally {
				killSpy.mockRestore();
			}
		});

		it('sweeps old stale lock artifacts before acquiring the config lock', async () => {
			const configPath = path.join(os.homedir(), '.opencode', 'openai-codex-auth-config.json');
			const stalePath = `${configPath}.lock.424242.777777.1700000000000.stale`;
			mockReaddir.mockResolvedValue(
				[
					{ isFile: () => true, name: path.basename(stalePath) } as unknown as fs.Dirent,
				] as unknown as Awaited<ReturnType<typeof fs.promises.readdir>>,
			);
			mockStat.mockResolvedValue({
				mtimeMs: Date.now() - (25 * 60 * 60 * 1000),
			} as fs.Stats);

			await expect(setSyncFromCodexMultiAuthEnabled(true)).resolves.toBeUndefined();
			expect(mockUnlink).toHaveBeenCalledWith(stalePath);
		});

		it('warns when stale lock cleanup cannot remove a recovered stale file', async () => {
			const configPath = path.join(os.homedir(), '.opencode', 'openai-codex-auth-config.json');
			const lockPath = `${configPath}.lock`;
			const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => {
				const error = new Error('process not found') as NodeJS.ErrnoException;
				error.code = 'ESRCH';
				throw error;
			});
			mockExistsSync.mockReturnValue(true);
			mockReadFile.mockImplementation(async (filePath: Parameters<typeof fs.promises.readFile>[0]) => {
				if (String(filePath) === lockPath) {
					return '424242';
				}
				if (String(filePath).includes('.stale')) {
					return '424242';
				}
				return JSON.stringify({ codexMode: false });
			});
			mockWriteFile.mockImplementation(async (filePath) => {
				if (String(filePath) === lockPath && mockWriteFile.mock.calls.length === 1) {
					const error = new Error('exists') as NodeJS.ErrnoException;
					error.code = 'EEXIST';
					throw error;
				}
				return undefined;
			});
			mockUnlink.mockImplementation(async (filePath) => {
				if (String(filePath).includes('.stale')) {
					throw new Error('stale unlink blocked');
				}
				return undefined;
			});

			try {
				await expect(setSyncFromCodexMultiAuthEnabled(true)).resolves.toBeUndefined();
				expect(mockLogWarn).toHaveBeenCalledWith(
					expect.stringContaining('Failed to remove stale plugin config lock artifact'),
				);
			} finally {
				killSpy.mockRestore();
			}
		});

		it('backs off when a live lock reappears during stale-lock recovery', async () => {
			const configPath = path.join(os.homedir(), '.opencode', 'openai-codex-auth-config.json');
			const lockPath = `${configPath}.lock`;
			const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => {
				const error = new Error('process not found') as NodeJS.ErrnoException;
				error.code = 'ESRCH';
				throw error;
			});
			let lockExistsChecks = 0;
			mockExistsSync.mockImplementation((filePath) => {
				const candidate = String(filePath);
				if (candidate === configPath) {
					return true;
				}
				if (candidate === lockPath) {
					lockExistsChecks += 1;
					return lockExistsChecks >= 1;
				}
				return false;
			});
			mockReadFile.mockImplementation(async (filePath: Parameters<typeof fs.promises.readFile>[0]) => {
				if (String(filePath) === lockPath || String(filePath).includes('.stale')) {
					return '424242';
				}
				return JSON.stringify({ codexMode: false });
			});
			let lockWriteAttempts = 0;
			mockWriteFile.mockImplementation(async (filePath) => {
				if (String(filePath) === lockPath) {
					lockWriteAttempts += 1;
					if (lockWriteAttempts === 1) {
						const error = new Error('exists') as NodeJS.ErrnoException;
						error.code = 'EEXIST';
						throw error;
					}
				}
				return undefined;
			});

			try {
				await expect(setSyncFromCodexMultiAuthEnabled(true)).resolves.toBeUndefined();
				expect(lockWriteAttempts).toBeGreaterThan(1);
				expect(
					mockRename.mock.calls.some(
						([source, destination]) =>
							String(source).includes('.stale') && String(destination) === lockPath,
					),
				).toBe(false);
			} finally {
				killSpy.mockRestore();
			}
		});
	});
});

