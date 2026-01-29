import type { Auth, Provider, Model } from "@opencode-ai/sdk";

export interface PluginConfig {
	codexMode?: boolean;
	retryAllAccountsRateLimited?: boolean;
	retryAllAccountsMaxWaitMs?: number;
	retryAllAccountsMaxRetries?: number;
	tokenRefreshSkewMs?: number;
	rateLimitToastDebounceMs?: number;
	/** Duration for toast notifications in milliseconds (default: 5000) */
	toastDurationMs?: number;
	/** Use per-project account storage instead of global (default: true) */
	perProjectAccounts?: boolean;
	sessionRecovery?: boolean;
	autoResume?: boolean;
}

/**
 * User configuration structure from opencode.json
 */
export interface UserConfig {
	global: ConfigOptions;
	models: {
		[modelName: string]: {
			options?: ConfigOptions;
			variants?: Record<string, (ConfigOptions & { disabled?: boolean }) | undefined>;
			[key: string]: unknown;
		};
	};
}

/**
 * Configuration options for reasoning and text settings
 */
export interface ConfigOptions {
	reasoningEffort?: "none" | "minimal" | "low" | "medium" | "high" | "xhigh";
	reasoningSummary?: "auto" | "concise" | "detailed" | "off" | "on";
	textVerbosity?: "low" | "medium" | "high";
	include?: string[];
}

/**
 * Reasoning configuration for requests
 */
export interface ReasoningConfig {
	effort: "none" | "minimal" | "low" | "medium" | "high" | "xhigh";
	summary: "auto" | "concise" | "detailed" | "off" | "on";
}

/**
 * OAuth server information
 */
export interface OAuthServerInfo {
	port: number;
	ready: boolean;
	close: () => void;
	waitForCode: (state: string) => Promise<{ code: string } | null>;
}

/**
 * PKCE challenge and verifier
 */
export interface PKCEPair {
	challenge: string;
	verifier: string;
}

/**
 * Authorization flow result
 */
export interface AuthorizationFlow {
	pkce: PKCEPair;
	state: string;
	url: string;
}

/**
 * Token exchange success result
 */
export interface TokenSuccess {
	type: "success";
	access: string;
	refresh: string;
	expires: number;
	/** ID token from OAuth response - contains email and other identity claims */
	idToken?: string;
	/** Flag to identify this auth as multi-account (vs built-in single account) */
	multiAccount?: boolean;
}

/**
 * Token failure reason codes
 */
export type TokenFailureReason =
	| "http_error"
	| "invalid_response"
	| "network_error"
	| "missing_refresh"
	| "unknown";

/**
 * Token exchange failure result with optional detailed error info
 */
export interface TokenFailure {
	type: "failed";
	reason?: TokenFailureReason;
	statusCode?: number;
	message?: string;
}

/**
 * Token exchange result
 */
export type TokenResult = TokenSuccess | TokenFailure;

/**
 * Parsed authorization input
 */
export interface ParsedAuthInput {
	code?: string;
	state?: string;
}

/**
 * Source of the accountId used for ChatGPT requests.
 * - token: derived from access token claim
 * - id_token: derived from id_token claim
 * - org: selected from organizations/workspaces list
 * - manual: explicit override (env/user selection)
 */
export type AccountIdSource = "token" | "id_token" | "org" | "manual";

/**
 * JWT payload with ChatGPT account info
 */
export interface JWTPayload {
	"https://api.openai.com/auth"?: {
		chatgpt_account_id?: string;
		email?: string;
		chatgpt_user_email?: string;
	};
	organizations?: unknown;
	orgs?: unknown;
	accounts?: unknown;
	workspaces?: unknown;
	teams?: unknown;
	email?: string;
	preferred_username?: string;
	[key: string]: unknown;
}


/**
 * Message input item
 */
export interface InputItem {
	id?: string;
	type: string;
	role: string;
	content?: unknown;
	[key: string]: unknown;
}

/**
 * Request body structure
 */
export interface RequestBody {
	model: string;
	store?: boolean;
	stream?: boolean;
	instructions?: string;
	input?: InputItem[];
	tools?: unknown;
	reasoning?: Partial<ReasoningConfig>;
	text?: {
		verbosity?: "low" | "medium" | "high";
	};
	include?: string[];
	providerOptions?: {
		openai?: Partial<ConfigOptions> & { store?: boolean; include?: string[] };
		[key: string]: unknown;
	};
	/** Stable key to enable prompt-token caching on Codex backend */
	prompt_cache_key?: string;
	max_output_tokens?: number;
	max_completion_tokens?: number;
	[key: string]: unknown;
}

/**
 * SSE event data structure
 */
export interface SSEEventData {
	type: string;
	response?: unknown;
	[key: string]: unknown;
}

/**
 * Cache metadata for Codex instructions
 */
export interface CacheMetadata {
        etag: string | null;
        tag: string;
        lastChecked: number;
        url: string;
}

/**
 * GitHub release data
 */
export interface GitHubRelease {
	tag_name: string;
	[key: string]: unknown;
}

// Re-export SDK types for convenience
export type { Auth, Provider, Model };

export type OAuthAuthDetails = Extract<Auth, { type: "oauth" }>;
