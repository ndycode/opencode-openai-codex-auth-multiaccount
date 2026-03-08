import { readFileSync, existsSync, promises as fs } from "node:fs";
import { basename, dirname, join } from "node:path";
import { homedir } from "node:os";
import type { PluginConfig } from "./types.js";
import {
	normalizeRetryBudgetValue,
	type RetryBudgetOverrides,
	type RetryProfile,
} from "./request/retry-budget.js";
import { logWarn } from "./logger.js";
import { PluginConfigSchema, getValidationErrors } from "./schemas.js";

const CONFIG_PATH = join(homedir(), ".opencode", "openai-codex-auth-config.json");
const CONFIG_LOCK_PATH = `${CONFIG_PATH}.lock`;
const STALE_CONFIG_LOCK_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const TUI_COLOR_PROFILES = new Set(["truecolor", "ansi16", "ansi256"]);
const TUI_GLYPH_MODES = new Set(["ascii", "unicode", "auto"]);
const REQUEST_TRANSFORM_MODES = new Set(["native", "legacy"]);
const UNSUPPORTED_CODEX_POLICIES = new Set(["strict", "fallback"]);
const RETRY_PROFILES = new Set(["conservative", "balanced", "aggressive"]);

export type UnsupportedCodexPolicy = "strict" | "fallback";

type RawPluginConfig = Record<string, unknown>;

/**
 * Default plugin configuration
 * CODEX_MODE is enabled by default for better Codex CLI parity
 */
const DEFAULT_CONFIG: PluginConfig = {
	codexMode: true,
	requestTransformMode: "native",
	codexTuiV2: true,
	codexTuiColorProfile: "truecolor",
	codexTuiGlyphMode: "ascii",
	beginnerSafeMode: false,
	fastSession: false,
	fastSessionStrategy: "hybrid",
	fastSessionMaxInputItems: 30,
	retryProfile: "balanced",
	retryBudgetOverrides: {},
	retryAllAccountsRateLimited: true,
	retryAllAccountsMaxWaitMs: 0,
	retryAllAccountsMaxRetries: Infinity,
	unsupportedCodexPolicy: "strict",
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

		const userConfig = readRawPluginConfig(false) as unknown;
		const hasFallbackEnvOverride =
			process.env.CODEX_AUTH_FALLBACK_UNSUPPORTED_MODEL !== undefined ||
			process.env.CODEX_AUTH_FALLBACK_GPT53_TO_GPT52 !== undefined;
		if (isRecord(userConfig)) {
			const hasPolicyKey = Object.hasOwn(userConfig, "unsupportedCodexPolicy");
			const hasLegacyFallbackKey =
				Object.hasOwn(userConfig, "fallbackOnUnsupportedCodexModel") ||
				Object.hasOwn(userConfig, "fallbackToGpt52OnUnsupportedGpt53") ||
				Object.hasOwn(userConfig, "unsupportedCodexFallbackChain");
			if (!hasPolicyKey && (hasLegacyFallbackKey || hasFallbackEnvOverride)) {
				logWarn(
					"Legacy unsupported-model fallback settings detected without unsupportedCodexPolicy. " +
						'Using backward-compat behavior; prefer unsupportedCodexPolicy: "strict" | "fallback".',
				);
			}
		}

		const schemaErrors = getValidationErrors(PluginConfigSchema, userConfig);
		if (schemaErrors.length > 0) {
			logWarn(`Plugin config validation warnings: ${schemaErrors.slice(0, 3).join(", ")}`);
		}

		return {
			...DEFAULT_CONFIG,
			...(userConfig as Partial<PluginConfig>),
		};
	} catch (error) {
		logWarn(
			`Failed to load config from ${CONFIG_PATH}: ${(error as Error).message}`,
		);
		return DEFAULT_CONFIG;
	}
}

function readRawPluginConfig(recoverInvalid = false): RawPluginConfig {
	if (!existsSync(CONFIG_PATH)) {
		return {};
	}

	try {
		const fileContent = readFileSync(CONFIG_PATH, "utf-8");
		const normalizedFileContent = stripUtf8Bom(fileContent);
		const parsed = JSON.parse(normalizedFileContent) as unknown;
		if (!isRecord(parsed)) {
			throw new Error("Plugin config root must be a JSON object");
		}
		return { ...parsed };
	} catch (error) {
		if (recoverInvalid) {
			logWarn(`Failed to read raw plugin config from ${CONFIG_PATH}: ${(error as Error).message}`);
			return {};
		}
		throw error;
	}
}

async function readRawPluginConfigAsync(recoverInvalid = false): Promise<RawPluginConfig> {
	if (!existsSync(CONFIG_PATH)) {
		return {};
	}

	try {
		const fileContent = await fs.readFile(CONFIG_PATH, "utf-8");
		const normalizedFileContent = stripUtf8Bom(fileContent);
		const parsed = JSON.parse(normalizedFileContent) as unknown;
		if (!isRecord(parsed)) {
			throw new Error("Plugin config root must be a JSON object");
		}
		return { ...parsed };
	} catch (error) {
		if (recoverInvalid) {
			logWarn(`Failed to read raw plugin config from ${CONFIG_PATH}: ${(error as Error).message}`);
			return {};
		}
		throw error;
	}
}

export async function savePluginConfigMutation(
	mutate: (current: RawPluginConfig) => RawPluginConfig,
	options: { recoverInvalidCurrent?: boolean } = {},
): Promise<void> {
	await withPluginConfigLock(async () => {
		const current = await readRawPluginConfigAsync(options.recoverInvalidCurrent === true);
		const next = mutate({ ...current });

		if (!isRecord(next)) {
			throw new Error("Plugin config mutation must return a JSON object");
		}

		const tempPath = `${CONFIG_PATH}.${process.pid}.${Date.now()}.tmp`;
		let tempFilePresent = false;
		try {
			await fs.writeFile(tempPath, `${JSON.stringify(next, null, 2)}\n`, {
				encoding: "utf-8",
				mode: 0o600,
			});
			tempFilePresent = true;
			try {
				await fs.rename(tempPath, CONFIG_PATH);
				tempFilePresent = false;
				return;
			} catch (error) {
				const code = (error as NodeJS.ErrnoException).code;
				if (
					process.platform === "win32" &&
					(code === "EEXIST" || code === "EPERM") &&
					existsSync(CONFIG_PATH)
				) {
					const backupPath = `${CONFIG_PATH}.${process.pid}.${Date.now()}.bak`;
					let backupMoved = false;
					try {
						await fs.rename(CONFIG_PATH, backupPath);
						backupMoved = true;
						await fs.rename(tempPath, CONFIG_PATH);
						tempFilePresent = false;
						try {
							await fs.unlink(backupPath);
						} catch {
							// best effort backup cleanup
						}
						return;
					} catch (retryError) {
						if (backupMoved) {
							try {
								if (!existsSync(CONFIG_PATH)) {
									await fs.rename(backupPath, CONFIG_PATH);
									backupMoved = false;
								}
							} catch {
								// best effort config restore
							}
						}
						throw retryError;
					} finally {
						if (backupMoved) {
							try {
								await fs.unlink(backupPath);
							} catch {
								// best effort backup cleanup
							}
						}
					}
				}
				throw error;
			}
		} finally {
			if (tempFilePresent) {
				try {
					await fs.unlink(tempPath);
				} catch {
					// best effort temp cleanup
				}
			}
		}
	});
}

function stripUtf8Bom(content: string): string {
	return content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function sleepAsync(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function isProcessAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		return code !== "ESRCH";
	}
}

async function cleanupStalePluginConfigLockArtifacts(): Promise<void> {
	const lockDir = dirname(CONFIG_LOCK_PATH);
	const staleLockPrefix = `${basename(CONFIG_LOCK_PATH)}.`;
	try {
		const entries = await fs.readdir(lockDir, { withFileTypes: true });
		for (const entry of entries) {
			if (!entry.isFile() || !entry.name.startsWith(staleLockPrefix) || !entry.name.endsWith(".stale")) {
				continue;
			}
			const stalePath = join(lockDir, entry.name);
			try {
				const stats = await fs.stat(stalePath);
				if (Date.now() - stats.mtimeMs < STALE_CONFIG_LOCK_MAX_AGE_MS) {
					continue;
				}
				await fs.unlink(stalePath);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				logWarn(`Failed to remove stale plugin config lock artifact ${stalePath}: ${message}`);
			}
		}
	} catch {
		// best effort stale-lock cleanup only
	}
}

async function tryRecoverStalePluginConfigLock(rawLockContents: string): Promise<boolean> {
	const lockOwnerPid = Number.parseInt(rawLockContents.trim(), 10);
	if (
		!Number.isFinite(lockOwnerPid) ||
		lockOwnerPid === process.pid ||
		isProcessAlive(lockOwnerPid)
	) {
		return false;
	}

	const staleLockPath = `${CONFIG_LOCK_PATH}.${lockOwnerPid}.${process.pid}.${Date.now()}.stale`;
	try {
		await fs.rename(CONFIG_LOCK_PATH, staleLockPath);
	} catch {
		return false;
	}

	try {
		const movedLockContents = await fs.readFile(staleLockPath, "utf-8");
		if (movedLockContents !== rawLockContents) {
			try {
				if (!existsSync(CONFIG_LOCK_PATH)) {
					await fs.rename(staleLockPath, CONFIG_LOCK_PATH);
				}
			} catch {
				// best effort restore when a live lock was moved unexpectedly
			}
			return false;
		}
	} catch {
		try {
			if (!existsSync(CONFIG_LOCK_PATH)) {
				await fs.rename(staleLockPath, CONFIG_LOCK_PATH);
			}
		} catch {
			// best effort restore when stale-lock verification fails
		}
		return false;
	}

	try {
		await fs.unlink(staleLockPath);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		logWarn(`Failed to remove stale plugin config lock artifact ${staleLockPath}: ${message}`);
	}
	return true;
}

async function withPluginConfigLock<T>(fn: () => T | Promise<T>): Promise<T> {
	await fs.mkdir(dirname(CONFIG_PATH), { recursive: true });
	await cleanupStalePluginConfigLockArtifacts();
	const deadline = Date.now() + 2_000;
	while (true) {
		try {
			await fs.writeFile(CONFIG_LOCK_PATH, `${process.pid}`, { encoding: "utf-8", flag: "wx" });
			break;
		} catch (error) {
			const code = (error as NodeJS.ErrnoException).code;
			const retryableLockError =
				code === "EEXIST" || (process.platform === "win32" && (code === "EPERM" || code === "EBUSY"));
			if (!retryableLockError || Date.now() >= deadline) {
				throw error;
			}
			if (code === "EEXIST") {
				try {
					const rawLockContents = await fs.readFile(CONFIG_LOCK_PATH, "utf-8");
					if (await tryRecoverStalePluginConfigLock(rawLockContents)) {
						continue;
					}
				} catch {
					// best effort stale-lock recovery
				}
			}
			await sleepAsync(25);
		}
	}

	try {
		return await fn();
	} finally {
		try {
			await fs.unlink(CONFIG_LOCK_PATH);
		} catch {
			// best effort cleanup
		}
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

function parseStringEnv(value: string | undefined): string | undefined {
	if (value === undefined) return undefined;
	const trimmed = value.trim().toLowerCase();
	return trimmed.length > 0 ? trimmed : undefined;
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
	// istanbul ignore next -- dead code: all callers pass { min: ... }
	return candidate;
}

function resolveStringSetting<T extends string>(
	envName: string,
	configValue: T | undefined,
	defaultValue: T,
	allowedValues: ReadonlySet<string>,
): T {
	const envValue = parseStringEnv(process.env[envName]);
	if (envValue && allowedValues.has(envValue)) {
		return envValue as T;
	}
	if (configValue && allowedValues.has(configValue)) {
		return configValue;
	}
	return defaultValue;
}

export function getCodexMode(pluginConfig: PluginConfig): boolean {
	return resolveBooleanSetting("CODEX_MODE", pluginConfig.codexMode, true);
}

export function getRequestTransformMode(pluginConfig: PluginConfig): "native" | "legacy" {
	return resolveStringSetting(
		"CODEX_AUTH_REQUEST_TRANSFORM_MODE",
		pluginConfig.requestTransformMode,
		"native",
		REQUEST_TRANSFORM_MODES,
	);
}

export function getCodexTuiV2(pluginConfig: PluginConfig): boolean {
	return resolveBooleanSetting("CODEX_TUI_V2", pluginConfig.codexTuiV2, true);
}

export function getSyncFromCodexMultiAuthEnabled(pluginConfig: PluginConfig): boolean {
	return pluginConfig.experimental?.syncFromCodexMultiAuth?.enabled === true;
}

export async function setSyncFromCodexMultiAuthEnabled(enabled: boolean): Promise<void> {
	await savePluginConfigMutation((current) => {
		const experimental = isRecord(current.experimental) ? { ...current.experimental } : {};
		const syncSettings = isRecord(experimental.syncFromCodexMultiAuth)
			? { ...experimental.syncFromCodexMultiAuth }
			: {};

		syncSettings.enabled = enabled;
		experimental.syncFromCodexMultiAuth = syncSettings;
		current.experimental = experimental;
		return current;
	});
}

export function getCodexTuiColorProfile(
	pluginConfig: PluginConfig,
): "truecolor" | "ansi16" | "ansi256" {
	return resolveStringSetting(
		"CODEX_TUI_COLOR_PROFILE",
		pluginConfig.codexTuiColorProfile,
		"truecolor",
		TUI_COLOR_PROFILES,
	);
}

export function getCodexTuiGlyphMode(
	pluginConfig: PluginConfig,
): "ascii" | "unicode" | "auto" {
	return resolveStringSetting(
		"CODEX_TUI_GLYPHS",
		pluginConfig.codexTuiGlyphMode,
		"ascii",
		TUI_GLYPH_MODES,
	);
}

export function getFastSession(pluginConfig: PluginConfig): boolean {
	return resolveBooleanSetting(
		"CODEX_AUTH_FAST_SESSION",
		pluginConfig.fastSession,
		false,
	);
}

export function getBeginnerSafeMode(pluginConfig: PluginConfig): boolean {
	return resolveBooleanSetting(
		"CODEX_AUTH_BEGINNER_SAFE_MODE",
		pluginConfig.beginnerSafeMode,
		false,
	);
}

export function getFastSessionStrategy(pluginConfig: PluginConfig): "hybrid" | "always" {
	const env = (process.env.CODEX_AUTH_FAST_SESSION_STRATEGY ?? "").trim().toLowerCase();
	if (env === "always") return "always";
	if (env === "hybrid") return "hybrid";
	return pluginConfig.fastSessionStrategy === "always" ? "always" : "hybrid";
}

export function getFastSessionMaxInputItems(pluginConfig: PluginConfig): number {
	return resolveNumberSetting(
		"CODEX_AUTH_FAST_SESSION_MAX_INPUT_ITEMS",
		pluginConfig.fastSessionMaxInputItems,
		30,
		{ min: 8 },
	);
}

export function getRetryProfile(pluginConfig: PluginConfig): RetryProfile {
	return resolveStringSetting(
		"CODEX_AUTH_RETRY_PROFILE",
		pluginConfig.retryProfile,
		"balanced",
		RETRY_PROFILES,
	);
}

export function getRetryBudgetOverrides(
	pluginConfig: PluginConfig,
): RetryBudgetOverrides {
	const source = pluginConfig.retryBudgetOverrides;
	if (!isRecord(source)) return {};

	const normalized: RetryBudgetOverrides = {};
	const authRefresh = normalizeRetryBudgetValue(source.authRefresh);
	const network = normalizeRetryBudgetValue(source.network);
	const server = normalizeRetryBudgetValue(source.server);
	const rateLimitShort = normalizeRetryBudgetValue(source.rateLimitShort);
	const rateLimitGlobal = normalizeRetryBudgetValue(source.rateLimitGlobal);
	const emptyResponse = normalizeRetryBudgetValue(source.emptyResponse);

	if (authRefresh !== undefined) normalized.authRefresh = authRefresh;
	if (network !== undefined) normalized.network = network;
	if (server !== undefined) normalized.server = server;
	if (rateLimitShort !== undefined) normalized.rateLimitShort = rateLimitShort;
	if (rateLimitGlobal !== undefined) normalized.rateLimitGlobal = rateLimitGlobal;
	if (emptyResponse !== undefined) normalized.emptyResponse = emptyResponse;

	return normalized;
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

export function getUnsupportedCodexPolicy(
	pluginConfig: PluginConfig,
): UnsupportedCodexPolicy {
	const envPolicy = parseStringEnv(process.env.CODEX_AUTH_UNSUPPORTED_MODEL_POLICY);
	if (envPolicy && UNSUPPORTED_CODEX_POLICIES.has(envPolicy)) {
		return envPolicy as UnsupportedCodexPolicy;
	}

	const configPolicy =
		typeof pluginConfig.unsupportedCodexPolicy === "string"
			? pluginConfig.unsupportedCodexPolicy.toLowerCase()
			: undefined;
	if (configPolicy && UNSUPPORTED_CODEX_POLICIES.has(configPolicy)) {
		return configPolicy as UnsupportedCodexPolicy;
	}

	const legacyEnvFallback = parseBooleanEnv(
		process.env.CODEX_AUTH_FALLBACK_UNSUPPORTED_MODEL,
	);
	if (legacyEnvFallback !== undefined) {
		return legacyEnvFallback ? "fallback" : "strict";
	}

	if (typeof pluginConfig.fallbackOnUnsupportedCodexModel === "boolean") {
		return pluginConfig.fallbackOnUnsupportedCodexModel
			? "fallback"
			: "strict";
	}

	return "strict";
}

export function getFallbackOnUnsupportedCodexModel(pluginConfig: PluginConfig): boolean {
	return getUnsupportedCodexPolicy(pluginConfig) === "fallback";
}

export function getFallbackToGpt52OnUnsupportedGpt53(pluginConfig: PluginConfig): boolean {
	return resolveBooleanSetting(
		"CODEX_AUTH_FALLBACK_GPT53_TO_GPT52",
		pluginConfig.fallbackToGpt52OnUnsupportedGpt53,
		true,
	);
}

export function getUnsupportedCodexFallbackChain(
	pluginConfig: PluginConfig,
): Record<string, string[]> {
	const chain = pluginConfig.unsupportedCodexFallbackChain;
	if (!chain || typeof chain !== "object") {
		return {};
	}

	const normalizeModel = (value: string): string => {
		const trimmed = value.trim().toLowerCase();
		if (!trimmed) return "";
		const stripped = trimmed.includes("/")
			? (trimmed.split("/").pop() ?? trimmed)
			: trimmed;
		return stripped.replace(/-(none|minimal|low|medium|high|xhigh)$/i, "");
	};

	const normalized: Record<string, string[]> = {};
	for (const [key, value] of Object.entries(chain)) {
		if (typeof key !== "string" || !Array.isArray(value)) continue;
		const normalizedKey = normalizeModel(key);
		if (!normalizedKey) continue;

		const targets = value
			.map((target) => (typeof target === "string" ? normalizeModel(target) : ""))
			.filter((target) => target.length > 0);

		if (targets.length > 0) {
			normalized[normalizedKey] = targets;
		}
	}

	return normalized;
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

export function getParallelProbing(pluginConfig: PluginConfig): boolean {
	return resolveBooleanSetting(
		"CODEX_AUTH_PARALLEL_PROBING",
		pluginConfig.parallelProbing,
		false,
	);
}

export function getParallelProbingMaxConcurrency(pluginConfig: PluginConfig): number {
	return resolveNumberSetting(
		"CODEX_AUTH_PARALLEL_PROBING_MAX_CONCURRENCY",
		pluginConfig.parallelProbingMaxConcurrency,
		2,
		{ min: 1 },
	);
}

export function getEmptyResponseMaxRetries(pluginConfig: PluginConfig): number {
	return resolveNumberSetting(
		"CODEX_AUTH_EMPTY_RESPONSE_MAX_RETRIES",
		pluginConfig.emptyResponseMaxRetries,
		2,
		{ min: 0 },
	);
}

export function getEmptyResponseRetryDelayMs(pluginConfig: PluginConfig): number {
	return resolveNumberSetting(
		"CODEX_AUTH_EMPTY_RESPONSE_RETRY_DELAY_MS",
		pluginConfig.emptyResponseRetryDelayMs,
		1_000,
		{ min: 0 },
	);
}

export function getPidOffsetEnabled(pluginConfig: PluginConfig): boolean {
	return resolveBooleanSetting(
		"CODEX_AUTH_PID_OFFSET_ENABLED",
		pluginConfig.pidOffsetEnabled,
		false,
	);
}

export function getFetchTimeoutMs(pluginConfig: PluginConfig): number {
	return resolveNumberSetting(
		"CODEX_AUTH_FETCH_TIMEOUT_MS",
		pluginConfig.fetchTimeoutMs,
		60_000,
		{ min: 1_000 },
	);
}

export function getStreamStallTimeoutMs(pluginConfig: PluginConfig): number {
	return resolveNumberSetting(
		"CODEX_AUTH_STREAM_STALL_TIMEOUT_MS",
		pluginConfig.streamStallTimeoutMs,
		45_000,
		{ min: 1_000 },
	);
}
