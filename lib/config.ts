import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { PluginConfig } from "./types.js";
import { logWarn } from "./logger.js";

const CONFIG_PATH = join(homedir(), ".opencode", "openai-codex-auth-config.json");

/**
 * Default plugin configuration
 * CODEX_MODE is enabled by default for better Codex CLI parity
 */
const DEFAULT_CONFIG: PluginConfig = {
	codexMode: true,
	retryAllAccountsRateLimited: true,
	retryAllAccountsMaxWaitMs: 0,
	retryAllAccountsMaxRetries: Infinity,
	tokenRefreshSkewMs: 60_000,
	rateLimitToastDebounceMs: 60_000,
	toastDurationMs: 5_000,
	perProjectAccounts: true,
	sessionRecovery: true,
	autoResume: true,
};

/**
 * Load plugin configuration from ~/.opencode/openai-codex-auth-config.json
 * Falls back to defaults if file doesn't exist or is invalid
 *
 * @returns Plugin configuration
 */
export function loadPluginConfig(): PluginConfig {
	try {
		if (!existsSync(CONFIG_PATH)) {
			return DEFAULT_CONFIG;
		}

		const fileContent = readFileSync(CONFIG_PATH, "utf-8");
		const userConfig = JSON.parse(fileContent) as Partial<PluginConfig>;

		// Merge with defaults
		return {
			...DEFAULT_CONFIG,
			...userConfig,
		};
	} catch (error) {
		logWarn(
			`Failed to load config from ${CONFIG_PATH}: ${(error as Error).message}`,
		);
		return DEFAULT_CONFIG;
	}
}

/**
 * Get the effective CODEX_MODE setting
 * Priority: environment variable > config file > default (true)
 *
 * @param pluginConfig - Plugin configuration from file
 * @returns True if CODEX_MODE should be enabled
 */
function parseBooleanEnv(value: string | undefined): boolean | undefined {
	if (value === undefined) return undefined;
	return value === "1";
}

function parseNumberEnv(value: string | undefined): number | undefined {
	if (value === undefined) return undefined;
	const parsed = Number(value);
	if (!Number.isFinite(parsed)) return undefined;
	return parsed;
}

function resolveBooleanSetting(
	envName: string,
	configValue: boolean | undefined,
	defaultValue: boolean,
): boolean {
	const envValue = parseBooleanEnv(process.env[envName]);
	if (envValue !== undefined) return envValue;
	return configValue ?? defaultValue;
}

function resolveNumberSetting(
	envName: string,
	configValue: number | undefined,
	defaultValue: number,
	options?: { min?: number },
): number {
	const envValue = parseNumberEnv(process.env[envName]);
	const candidate = envValue ?? configValue ?? defaultValue;
	const min = options?.min;
	if (min !== undefined) {
		return Math.max(min, candidate);
	}
	return candidate;
}

export function getCodexMode(pluginConfig: PluginConfig): boolean {
	return resolveBooleanSetting("CODEX_MODE", pluginConfig.codexMode, true);
}

export function getRetryAllAccountsRateLimited(pluginConfig: PluginConfig): boolean {
	return resolveBooleanSetting(
		"CODEX_AUTH_RETRY_ALL_RATE_LIMITED",
		pluginConfig.retryAllAccountsRateLimited,
		true,
	);
}

export function getRetryAllAccountsMaxWaitMs(pluginConfig: PluginConfig): number {
	return resolveNumberSetting(
		"CODEX_AUTH_RETRY_ALL_MAX_WAIT_MS",
		pluginConfig.retryAllAccountsMaxWaitMs,
		0,
		{ min: 0 },
	);
}

export function getRetryAllAccountsMaxRetries(pluginConfig: PluginConfig): number {
	return resolveNumberSetting(
		"CODEX_AUTH_RETRY_ALL_MAX_RETRIES",
		pluginConfig.retryAllAccountsMaxRetries,
		Infinity,
		{ min: 0 },
	);
}

export function getTokenRefreshSkewMs(pluginConfig: PluginConfig): number {
	return resolveNumberSetting(
		"CODEX_AUTH_TOKEN_REFRESH_SKEW_MS",
		pluginConfig.tokenRefreshSkewMs,
		60_000,
		{ min: 0 },
	);
}

export function getRateLimitToastDebounceMs(pluginConfig: PluginConfig): number {
	return resolveNumberSetting(
		"CODEX_AUTH_RATE_LIMIT_TOAST_DEBOUNCE_MS",
		pluginConfig.rateLimitToastDebounceMs,
		60_000,
		{ min: 0 },
	);
}

export function getSessionRecovery(pluginConfig: PluginConfig): boolean {
	return resolveBooleanSetting(
		"CODEX_AUTH_SESSION_RECOVERY",
		pluginConfig.sessionRecovery,
		true,
	);
}

export function getAutoResume(pluginConfig: PluginConfig): boolean {
	return resolveBooleanSetting(
		"CODEX_AUTH_AUTO_RESUME",
		pluginConfig.autoResume,
		true,
	);
}

export function getToastDurationMs(pluginConfig: PluginConfig): number {
	return resolveNumberSetting(
		"CODEX_AUTH_TOAST_DURATION_MS",
		pluginConfig.toastDurationMs,
		5_000,
		{ min: 1_000 },
	);
}

export function getPerProjectAccounts(pluginConfig: PluginConfig): boolean {
	return resolveBooleanSetting(
		"CODEX_AUTH_PER_PROJECT_ACCOUNTS",
		pluginConfig.perProjectAccounts,
		true,
	);
}
