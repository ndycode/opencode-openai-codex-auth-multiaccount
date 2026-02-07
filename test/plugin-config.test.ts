import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
	loadPluginConfig,
	getCodexMode,
	getFastSession,
	getFastSessionStrategy,
	getFastSessionMaxInputItems,
	getTokenRefreshSkewMs,
	getRetryAllAccountsMaxRetries,
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
		'CODEX_AUTH_FAST_SESSION',
		'CODEX_AUTH_FAST_SESSION_STRATEGY',
		'CODEX_AUTH_FAST_SESSION_MAX_INPUT_ITEMS',
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
				fastSession: false,
				fastSessionStrategy: 'hybrid',
				fastSessionMaxInputItems: 30,
				retryAllAccountsRateLimited: true,
				retryAllAccountsMaxWaitMs: 0,
				retryAllAccountsMaxRetries: Infinity,
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
				fastSession: false,
				fastSessionStrategy: 'hybrid',
				fastSessionMaxInputItems: 30,
				retryAllAccountsRateLimited: true,
				retryAllAccountsMaxWaitMs: 0,
				retryAllAccountsMaxRetries: Infinity,
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
				fastSession: false,
				fastSessionStrategy: 'hybrid',
				fastSessionMaxInputItems: 30,
				retryAllAccountsRateLimited: true,
				retryAllAccountsMaxWaitMs: 0,
				retryAllAccountsMaxRetries: Infinity,
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

	it('should handle invalid JSON gracefully', () => {
		mockExistsSync.mockReturnValue(true);
		mockReadFileSync.mockReturnValue('invalid json');

		const mockLogWarn = vi.mocked(logger.logWarn);
		mockLogWarn.mockClear();
		const config = loadPluginConfig();

	expect(config).toEqual({
		codexMode: true,
		fastSession: false,
		fastSessionStrategy: 'hybrid',
		fastSessionMaxInputItems: 30,
		retryAllAccountsRateLimited: true,
		retryAllAccountsMaxWaitMs: 0,
		retryAllAccountsMaxRetries: Infinity,
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
			fastSession: false,
			fastSessionStrategy: 'hybrid',
			fastSessionMaxInputItems: 30,
			retryAllAccountsRateLimited: true,
			retryAllAccountsMaxWaitMs: 0,
			retryAllAccountsMaxRetries: Infinity,
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
