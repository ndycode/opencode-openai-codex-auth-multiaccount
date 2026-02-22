import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type {
	AccountScopeMode,
	ConfigDoctorMode,
	HashlineBridgeHintsMode,
	JsonRepairMode,
	ModelCapabilitySyncMode,
	PolicyProfile,
	PluginConfig,
	RerouteNoticeMode,
	RetryPolicyMode,
	TokenRefreshSkewMode,
	ToolArgumentRecoveryMode,
} from "./types.js";
import { logWarn } from "./logger.js";
import { PluginConfigSchema, getValidationErrors } from "./schemas.js";

const CONFIG_PATH = join(homedir(), ".opencode", "openai-codex-auth-config.json");
const TUI_COLOR_PROFILES = new Set(["truecolor", "ansi16", "ansi256"]);
const TUI_GLYPH_MODES = new Set(["ascii", "unicode", "auto"]);
const REQUEST_TRANSFORM_MODES = new Set(["native", "legacy"]);
const UNSUPPORTED_CODEX_POLICIES = new Set(["strict", "fallback"]);
const HASHLINE_BRIDGE_HINT_MODES = new Set(["off", "hints", "strict", "auto"]);
const TOOL_ARGUMENT_RECOVERY_MODES = new Set(["off", "safe", "schema-safe"]);
const MODEL_CAPABILITY_SYNC_MODES = new Set(["off", "safe"]);
const RETRY_POLICY_MODES = new Set(["legacy", "route-matrix"]);
const REROUTE_NOTICE_MODES = new Set(["off", "log", "log+ui"]);
const JSON_REPAIR_MODES = new Set(["off", "safe"]);
const CONFIG_DOCTOR_MODES = new Set(["off", "warn"]);
const ACCOUNT_SCOPE_MODES = new Set(["global", "project", "worktree"]);
const TOKEN_REFRESH_SKEW_MODES = new Set(["static", "adaptive"]);
const POLICY_PROFILES = new Set(["stable", "balanced", "aggressive"]);

type PolicyDefaults = {
	hashlineBridgeHintsMode: HashlineBridgeHintsMode;
	toolArgumentRecoveryMode: ToolArgumentRecoveryMode;
	modelCapabilitySyncMode: ModelCapabilitySyncMode;
	retryPolicyMode: RetryPolicyMode;
	rerouteNoticeMode: RerouteNoticeMode;
	jsonRepairMode: JsonRepairMode;
	configDoctorMode: ConfigDoctorMode;
	accountScopeMode: AccountScopeMode;
	tokenRefreshSkewMode: TokenRefreshSkewMode;
};

const POLICY_PROFILE_DEFAULTS: Record<PolicyProfile, PolicyDefaults> = {
	stable: {
		hashlineBridgeHintsMode: "auto",
		toolArgumentRecoveryMode: "safe",
		modelCapabilitySyncMode: "safe",
		retryPolicyMode: "legacy",
		rerouteNoticeMode: "log",
		jsonRepairMode: "safe",
		configDoctorMode: "warn",
		accountScopeMode: "project",
		tokenRefreshSkewMode: "static",
	},
	balanced: {
		hashlineBridgeHintsMode: "hints",
		toolArgumentRecoveryMode: "safe",
		modelCapabilitySyncMode: "safe",
		retryPolicyMode: "route-matrix",
		rerouteNoticeMode: "log+ui",
		jsonRepairMode: "safe",
		configDoctorMode: "warn",
		accountScopeMode: "project",
		tokenRefreshSkewMode: "adaptive",
	},
	aggressive: {
		hashlineBridgeHintsMode: "strict",
		toolArgumentRecoveryMode: "schema-safe",
		modelCapabilitySyncMode: "safe",
		retryPolicyMode: "route-matrix",
		rerouteNoticeMode: "log+ui",
		jsonRepairMode: "safe",
		configDoctorMode: "warn",
		accountScopeMode: "worktree",
		tokenRefreshSkewMode: "adaptive",
	},
};

export type UnsupportedCodexPolicy = "strict" | "fallback";

/**
 * Default plugin configuration
 * CODEX_MODE is enabled by default for better Codex CLI parity
 */
const DEFAULT_CONFIG: PluginConfig = {
	codexMode: true,
	requestTransformMode: "native",
	toolArgumentRecoveryMode: "safe",
	modelCapabilitySyncMode: "safe",
	modelCapabilityCacheTtlMs: 600_000,
	retryPolicyMode: "legacy",
	rerouteNoticeMode: "log",
	jsonRepairMode: "safe",
	configDoctorMode: "warn",
	codexTuiV2: true,
	codexTuiColorProfile: "truecolor",
	codexTuiGlyphMode: "ascii",
	fastSession: false,
	fastSessionStrategy: "hybrid",
	fastSessionMaxInputItems: 30,
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

		const fileContent = readFileSync(CONFIG_PATH, "utf-8");
		const normalizedFileContent = stripUtf8Bom(fileContent);
		const userConfig = JSON.parse(normalizedFileContent) as unknown;
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

function stripUtf8Bom(content: string): string {
	return content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object";
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

export function getPolicyProfile(pluginConfig: PluginConfig): PolicyProfile {
	return resolveStringSetting(
		"CODEX_AUTH_POLICY_PROFILE",
		pluginConfig.policyProfile,
		"stable",
		POLICY_PROFILES,
	);
}

function getPolicyDefaults(pluginConfig: PluginConfig): PolicyDefaults {
	return POLICY_PROFILE_DEFAULTS[getPolicyProfile(pluginConfig)];
}

export function getCodexMode(pluginConfig: PluginConfig): boolean {
	return resolveBooleanSetting("CODEX_MODE", pluginConfig.codexMode, true);
}

/**
 * Resolve hashline hint mode with backward-compatible fallback:
 * - Preferred: CODEX_AUTH_HASHLINE_HINTS_MODE=off|hints|strict|auto
 * - Legacy env: CODEX_AUTH_HASHLINE_HINTS_BETA=0|1
 * - Preferred config: hashlineBridgeHintsMode
 * - Legacy config: hashlineBridgeHintsBeta
 */
export function getHashlineBridgeHintsMode(
	pluginConfig: PluginConfig,
): HashlineBridgeHintsMode {
	const profileDefaults = getPolicyDefaults(pluginConfig);
	const envMode = parseStringEnv(process.env.CODEX_AUTH_HASHLINE_HINTS_MODE);
	if (envMode && HASHLINE_BRIDGE_HINT_MODES.has(envMode)) {
		return envMode as HashlineBridgeHintsMode;
	}

	const legacyEnvBeta = parseBooleanEnv(process.env.CODEX_AUTH_HASHLINE_HINTS_BETA);
	if (legacyEnvBeta !== undefined) {
		return legacyEnvBeta ? "hints" : "off";
	}

	const configMode =
		typeof pluginConfig.hashlineBridgeHintsMode === "string"
			? pluginConfig.hashlineBridgeHintsMode.trim().toLowerCase()
			: undefined;
	if (configMode && HASHLINE_BRIDGE_HINT_MODES.has(configMode)) {
		return configMode as HashlineBridgeHintsMode;
	}

	if (typeof pluginConfig.hashlineBridgeHintsBeta === "boolean") {
		return pluginConfig.hashlineBridgeHintsBeta ? "hints" : "off";
	}

	return profileDefaults.hashlineBridgeHintsMode;
}

/**
 * Backward-compatible boolean helper.
 * Prefer getHashlineBridgeHintsMode() in new call sites.
 */
export function getHashlineBridgeHintsBeta(pluginConfig: PluginConfig): boolean {
	return getHashlineBridgeHintsMode(pluginConfig) !== "off";
}

export function getRequestTransformMode(pluginConfig: PluginConfig): "native" | "legacy" {
	return resolveStringSetting(
		"CODEX_AUTH_REQUEST_TRANSFORM_MODE",
		pluginConfig.requestTransformMode,
		"native",
		REQUEST_TRANSFORM_MODES,
	);
}

export function getToolArgumentRecoveryMode(
	pluginConfig: PluginConfig,
): ToolArgumentRecoveryMode {
	const profileDefaults = getPolicyDefaults(pluginConfig);
	return resolveStringSetting(
		"CODEX_AUTH_TOOL_ARGUMENT_RECOVERY_MODE",
		pluginConfig.toolArgumentRecoveryMode,
		profileDefaults.toolArgumentRecoveryMode,
		TOOL_ARGUMENT_RECOVERY_MODES,
	);
}

export function getModelCapabilitySyncMode(
	pluginConfig: PluginConfig,
): ModelCapabilitySyncMode {
	const profileDefaults = getPolicyDefaults(pluginConfig);
	return resolveStringSetting(
		"CODEX_AUTH_MODEL_CAPABILITY_SYNC_MODE",
		pluginConfig.modelCapabilitySyncMode,
		profileDefaults.modelCapabilitySyncMode,
		MODEL_CAPABILITY_SYNC_MODES,
	);
}

export function getModelCapabilityCacheTtlMs(pluginConfig: PluginConfig): number {
	return resolveNumberSetting(
		"CODEX_AUTH_MODEL_CAPABILITY_CACHE_TTL_MS",
		pluginConfig.modelCapabilityCacheTtlMs,
		600_000,
		{ min: 1_000 },
	);
}

export function getRetryPolicyMode(pluginConfig: PluginConfig): RetryPolicyMode {
	const profileDefaults = getPolicyDefaults(pluginConfig);
	return resolveStringSetting(
		"CODEX_AUTH_RETRY_POLICY_MODE",
		pluginConfig.retryPolicyMode,
		profileDefaults.retryPolicyMode,
		RETRY_POLICY_MODES,
	);
}

export function getRerouteNoticeMode(pluginConfig: PluginConfig): RerouteNoticeMode {
	const profileDefaults = getPolicyDefaults(pluginConfig);
	return resolveStringSetting(
		"CODEX_AUTH_REROUTE_NOTICE_MODE",
		pluginConfig.rerouteNoticeMode,
		profileDefaults.rerouteNoticeMode,
		REROUTE_NOTICE_MODES,
	);
}

export function getJsonRepairMode(pluginConfig: PluginConfig): JsonRepairMode {
	const profileDefaults = getPolicyDefaults(pluginConfig);
	return resolveStringSetting(
		"CODEX_AUTH_JSON_REPAIR_MODE",
		pluginConfig.jsonRepairMode,
		profileDefaults.jsonRepairMode,
		JSON_REPAIR_MODES,
	);
}

export function getConfigDoctorMode(pluginConfig: PluginConfig): ConfigDoctorMode {
	const profileDefaults = getPolicyDefaults(pluginConfig);
	return resolveStringSetting(
		"CODEX_AUTH_CONFIG_DOCTOR_MODE",
		pluginConfig.configDoctorMode,
		profileDefaults.configDoctorMode,
		CONFIG_DOCTOR_MODES,
	);
}

export function getCodexTuiV2(pluginConfig: PluginConfig): boolean {
	return resolveBooleanSetting("CODEX_TUI_V2", pluginConfig.codexTuiV2, true);
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

export function getTokenRefreshSkewMode(
	pluginConfig: PluginConfig,
): TokenRefreshSkewMode {
	const profileDefaults = getPolicyDefaults(pluginConfig);
	return resolveStringSetting(
		"CODEX_AUTH_TOKEN_REFRESH_SKEW_MODE",
		pluginConfig.tokenRefreshSkewMode,
		profileDefaults.tokenRefreshSkewMode,
		TOKEN_REFRESH_SKEW_MODES,
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
	return getAccountScopeMode(pluginConfig) !== "global";
}

export function getAccountScopeMode(
	pluginConfig: PluginConfig,
): AccountScopeMode {
	const profileDefaults = getPolicyDefaults(pluginConfig);
	const envMode = parseStringEnv(process.env.CODEX_AUTH_ACCOUNT_SCOPE_MODE);
	if (envMode && ACCOUNT_SCOPE_MODES.has(envMode)) {
		return envMode as AccountScopeMode;
	}

	const configMode =
		typeof pluginConfig.accountScopeMode === "string"
			? pluginConfig.accountScopeMode.trim().toLowerCase()
			: undefined;
	if (configMode && ACCOUNT_SCOPE_MODES.has(configMode)) {
		return configMode as AccountScopeMode;
	}

	const legacyEnvPerProject = parseBooleanEnv(
		process.env.CODEX_AUTH_PER_PROJECT_ACCOUNTS,
	);
	if (legacyEnvPerProject !== undefined) {
		return legacyEnvPerProject ? "project" : "global";
	}

	if (typeof pluginConfig.perProjectAccounts === "boolean") {
		return pluginConfig.perProjectAccounts ? "project" : "global";
	}

	return profileDefaults.accountScopeMode;
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

export function collectConfigDoctorWarnings(pluginConfig: PluginConfig): string[] {
	const warnings: string[] = [];

	if (
		typeof pluginConfig.hashlineBridgeHintsBeta === "boolean" &&
		typeof pluginConfig.hashlineBridgeHintsMode === "string"
	) {
		const legacyMode = pluginConfig.hashlineBridgeHintsBeta ? "hints" : "off";
		const explicitMode = pluginConfig.hashlineBridgeHintsMode.trim().toLowerCase();
		if (HASHLINE_BRIDGE_HINT_MODES.has(explicitMode) && explicitMode !== legacyMode) {
			warnings.push(
				`Conflicting hashline settings: hashlineBridgeHintsBeta=${String(pluginConfig.hashlineBridgeHintsBeta)} vs hashlineBridgeHintsMode="${pluginConfig.hashlineBridgeHintsMode}". Prefer hashlineBridgeHintsMode only.`,
			);
		}
	}

	if (
		typeof pluginConfig.modelCapabilityCacheTtlMs === "number" &&
		getModelCapabilitySyncMode(pluginConfig) === "off"
	) {
		warnings.push(
			`modelCapabilityCacheTtlMs is set but modelCapabilitySyncMode is off; TTL is ignored until capability sync is enabled.`,
		);
	}

	if (
		typeof pluginConfig.unsupportedCodexPolicy === "string" &&
		typeof pluginConfig.fallbackOnUnsupportedCodexModel === "boolean"
	) {
		const legacyPolicy = pluginConfig.fallbackOnUnsupportedCodexModel
			? "fallback"
			: "strict";
		const explicitPolicy = pluginConfig.unsupportedCodexPolicy.trim().toLowerCase();
		if (
			UNSUPPORTED_CODEX_POLICIES.has(explicitPolicy) &&
			explicitPolicy !== legacyPolicy
		) {
			warnings.push(
				`Conflicting unsupported-model settings: unsupportedCodexPolicy="${pluginConfig.unsupportedCodexPolicy}" vs fallbackOnUnsupportedCodexModel=${String(pluginConfig.fallbackOnUnsupportedCodexModel)}. Prefer unsupportedCodexPolicy only.`,
			);
		}
	}

	if (
		typeof pluginConfig.accountScopeMode === "string" &&
		typeof pluginConfig.perProjectAccounts === "boolean"
	) {
		const explicitScope = pluginConfig.accountScopeMode.trim().toLowerCase();
		if (ACCOUNT_SCOPE_MODES.has(explicitScope)) {
			const legacyScope = pluginConfig.perProjectAccounts ? "project" : "global";
			if (explicitScope !== legacyScope) {
				warnings.push(
					`Conflicting account scope settings: accountScopeMode="${pluginConfig.accountScopeMode}" vs perProjectAccounts=${String(pluginConfig.perProjectAccounts)}. Prefer accountScopeMode only.`,
				);
			}
		}
	}

	if (
		getRerouteNoticeMode(pluginConfig) === "log+ui" &&
		getToastDurationMs(pluginConfig) < 1500
	) {
		warnings.push(
			`rerouteNoticeMode="log+ui" with toastDurationMs < 1500 may hide reroute notices too quickly.`,
		);
	}

	return warnings;
}
