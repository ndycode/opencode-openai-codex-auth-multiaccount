import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SessionModelRef } from "../lib/persist-account-footer.js";

vi.mock("@opencode-ai/plugin/tool", () => {
	const makeSchema = () => ({
		optional: () => makeSchema(),
		describe: () => makeSchema(),
	});

	const tool = (definition: unknown) => definition;
	(tool as unknown as { schema: unknown }).schema = {
		number: () => makeSchema(),
		boolean: () => makeSchema(),
		string: () => makeSchema(),
	};

	return { tool };
});

vi.mock("../lib/auth/auth.js", () => ({
	createAuthorizationFlow: vi.fn(async () => ({
		pkce: { verifier: "test-verifier", challenge: "test-challenge" },
		state: "test-state",
		url: "https://auth.openai.com/test",
	})),
	exchangeAuthorizationCode: vi.fn(async () => ({
		type: "success" as const,
		access: "access-token",
		refresh: "refresh-token",
		expires: Date.now() + 3600_000,
		idToken: "id-token",
	})),
	parseAuthorizationInput: vi.fn((input: string) => {
		const codeMatch = input.match(/code=([^&]+)/);
		const stateMatch = input.match(/state=([^&#]+)/);
		return {
			code: codeMatch?.[1],
			state: stateMatch?.[1],
		};
	}),
	REDIRECT_URI: "http://127.0.0.1:1455/auth/callback",
}));

vi.mock("../lib/refresh-queue.js", () => ({
	queuedRefresh: vi.fn(async () => ({
		type: "success" as const,
		access: "refreshed-access",
		refresh: "refreshed-refresh",
		expires: Date.now() + 3600_000,
	})),
	getRefreshQueueMetrics: vi.fn(() => ({
		started: 0,
		deduplicated: 0,
		rotationReused: 0,
		succeeded: 0,
		failed: 0,
		exceptions: 0,
		rotated: 0,
		staleEvictions: 0,
		lastDurationMs: 0,
		lastFailureReason: null,
		pending: 0,
	})),
}));

vi.mock("../lib/auth/browser.js", () => ({
	openBrowserUrl: vi.fn(),
}));

vi.mock("../lib/auth/server.js", () => ({
	startLocalOAuthServer: vi.fn(async () => ({
		ready: true,
		close: vi.fn(),
		waitForCode: vi.fn(async () => ({ code: "auth-code" })),
	})),
}));

vi.mock("../lib/cli.js", () => ({
	promptLoginMode: vi.fn(async () => ({ mode: "add" })),
	promptAddAnotherAccount: vi.fn(async () => false),
}));

vi.mock("../lib/config.js", () => {
	const FALLBACK_PLUGIN_CONFIG = Symbol("fallbackPluginConfig");
	const markFallbackPluginConfig = <T extends Record<string, unknown>>(config: T): T => {
		Object.defineProperty(config, FALLBACK_PLUGIN_CONFIG, {
			value: true,
			enumerable: false,
		});
		return config;
	};
	const DEFAULT_CONFIG = markFallbackPluginConfig({});
	return {
		DEFAULT_CONFIG,
		getCodexMode: () => true,
		getRequestTransformMode: () => "native",
		getFastSession: () => false,
		getFastSessionStrategy: () => "hybrid",
		getFastSessionMaxInputItems: () => 30,
		getPersistAccountFooter: vi.fn(() => false),
		getPersistAccountFooterStyle: vi.fn(() => "label-masked-email"),
		getRetryProfile: () => "balanced",
		getRetryBudgetOverrides: () => ({}),
		getRateLimitToastDebounceMs: () => 5000,
		getRetryAllAccountsMaxRetries: vi.fn(() => 3),
		getRetryAllAccountsMaxWaitMs: vi.fn(() => 30000),
		getRetryAllAccountsRateLimited: vi.fn(() => true),
		getUnsupportedCodexPolicy: vi.fn(() => "fallback"),
		getFallbackOnUnsupportedCodexModel: vi.fn(() => true),
		getFallbackToGpt52OnUnsupportedGpt53: vi.fn(() => false),
		getUnsupportedCodexFallbackChain: () => ({}),
		getTokenRefreshSkewMs: () => 60000,
		getSessionRecovery: () => false,
		getAutoResume: () => false,
		getToastDurationMs: () => 5000,
		getPerProjectAccounts: vi.fn(() => false),
		getEmptyResponseMaxRetries: () => 2,
		getEmptyResponseRetryDelayMs: () => 1000,
		getPidOffsetEnabled: () => false,
		getFetchTimeoutMs: () => 60000,
		getStreamStallTimeoutMs: () => 45000,
		getCodexTuiV2: () => false,
		getCodexTuiColorProfile: () => "ansi16",
		getCodexTuiGlyphMode: () => "ascii",
		getBeginnerSafeMode: () => false,
		isFallbackPluginConfig: vi.fn(
			(config) =>
				!!config &&
				(config as Record<PropertyKey, unknown>)[FALLBACK_PLUGIN_CONFIG] === true,
		),
		// NOTE: loadPluginConfig returns a fresh {} by default (not marked as a
		// loader fallback). Tests that exercise the fallback marker should return
		// DEFAULT_CONFIG explicitly.
		loadPluginConfig: vi.fn(() => ({})),
	};
});

vi.mock("../lib/request/request-transformer.js", () => ({
	applyFastSessionDefaults: <T>(config: T) => config,
}));

vi.mock("../lib/logger.js", async () => {
	const actual = await vi.importActual<typeof import("../lib/logger.js")>(
		"../lib/logger.js",
	);
	return {
		...actual,
		initLogger: vi.fn(),
		logRequest: vi.fn(),
		logDebug: vi.fn(),
		logInfo: vi.fn(),
		logWarn: vi.fn(),
		logError: vi.fn(),
		setCorrelationId: vi.fn(() => "test-correlation-id"),
		clearCorrelationId: vi.fn(),
		createLogger: vi.fn(() => ({
			debug: vi.fn(),
			info: vi.fn(),
			warn: vi.fn(),
			error: vi.fn(),
			time: vi.fn(() => vi.fn(() => 0)),
			timeEnd: vi.fn(),
		})),
	};
});

vi.mock("../lib/auto-update-checker.js", () => ({
	checkAndNotify: vi.fn(async () => {}),
}));

vi.mock("../lib/context-overflow.js", () => ({
	handleContextOverflow: vi.fn(async () => ({ handled: false })),
}));

vi.mock("../lib/rotation.js", () => ({
	addJitter: (ms: number) => ms,
}));

vi.mock("../lib/prompts/codex.js", () => ({
	getModelFamily: (model: string) => {
		if (model.includes("codex-max")) return "codex-max";
		if (model.includes("codex")) return "codex";
		return "gpt-5.1";
	},
	getCodexInstructions: vi.fn(async () => "test instructions"),
	MODEL_FAMILIES: ["codex-max", "codex", "gpt-5.1"] as const,
	prewarmCodexInstructions: vi.fn(),
}));

vi.mock("../lib/prompts/opencode-codex.js", () => ({
	prewarmOpenCodeCodexPrompt: vi.fn(),
}));

vi.mock("../lib/recovery.js", () => ({
	createSessionRecoveryHook: vi.fn(),
	isRecoverableError: () => false,
	detectErrorType: () => "unknown",
	getRecoveryToastContent: () => ({ title: "Error", message: "Test" }),
}));

vi.mock("../lib/request/rate-limit-backoff.js", () => ({
	getRateLimitBackoff: () => ({ attempt: 1, delayMs: 1000 }),
	RATE_LIMIT_SHORT_RETRY_THRESHOLD_MS: 5000,
	resetRateLimitBackoff: vi.fn(),
}));

	vi.mock("../lib/request/fetch-helpers.js", () => ({
		extractRequestUrl: (input: unknown) => (typeof input === "string" ? input : String(input)),
		rewriteUrlForCodex: (url: string) => url,
		transformRequestForCodex: vi.fn(async (init: unknown) => ({
		updatedInit: init,
		body: { model: "gpt-5.1" },
	})),
		shouldRefreshToken: () => false,
		refreshAndUpdateToken: vi.fn(async (auth: unknown) => auth),
		createCodexHeaders: vi.fn(() => new Headers()),
		handleErrorResponse: vi.fn(async (response: Response) => ({ response })),
	getUnsupportedCodexModelInfo: vi.fn(() => ({ isUnsupported: false })),
	resolveUnsupportedCodexFallbackModel: vi.fn(() => undefined),
	shouldFallbackToGpt52OnUnsupportedGpt53: vi.fn(() => false),
	handleSuccessResponse: vi.fn(async (response: Response) => response),
}));

const mockStorage = {
	version: 3 as const,
	accounts: [] as Array<{
		accountId?: string;
		organizationId?: string;
		accountIdSource?: string;
		accountLabel?: string;
		email?: string;
		refreshToken: string;
		accessToken?: string;
		expiresAt?: number;
		enabled?: boolean;
		addedAt?: number;
		lastUsed?: number;
		coolingDownUntil?: number;
		cooldownReason?: string;
		rateLimitResetTimes?: Record<string, number>;
		lastSwitchReason?: string;
	}>,
	activeIndex: 0,
	activeIndexByFamily: {} as Record<string, number>,
};

const cloneAccount = (account: (typeof mockStorage.accounts)[number]) => structuredClone(account);

const cloneMockStorage = () => ({
	...mockStorage,
	accounts: mockStorage.accounts.map(cloneAccount),
	activeIndexByFamily: { ...mockStorage.activeIndexByFamily },
});

vi.mock("../lib/storage.js", () => ({
	getStoragePath: () => "/mock/path/accounts.json",
	loadAccounts: vi.fn(async () => cloneMockStorage()),
	saveAccounts: vi.fn(async (nextStorage: typeof mockStorage) => {
		mockStorage.version = nextStorage.version;
		mockStorage.accounts = nextStorage.accounts.map(cloneAccount);
		mockStorage.activeIndex = nextStorage.activeIndex;
		mockStorage.activeIndexByFamily = { ...nextStorage.activeIndexByFamily };
	}),
	withAccountStorageTransaction: vi.fn(
		async <T>(
			callback: (
				loadedStorage: typeof mockStorage,
				persist: (nextStorage: typeof mockStorage) => Promise<void>,
			) => Promise<T>,
		) => {
			const loadedStorage = cloneMockStorage();
			const persist = async (nextStorage: typeof mockStorage) => {
				mockStorage.version = nextStorage.version;
				mockStorage.accounts = nextStorage.accounts.map(cloneAccount);
				mockStorage.activeIndex = nextStorage.activeIndex;
				mockStorage.activeIndexByFamily = { ...nextStorage.activeIndexByFamily };
			};
			return await callback(loadedStorage, persist);
		},
	),
	clearAccounts: vi.fn(async () => {}),
	setStoragePath: vi.fn(),
	exportAccounts: vi.fn(async () => {}),
	importAccounts: vi.fn(async () => ({
		imported: 2,
		skipped: 1,
		total: 5,
		backupStatus: "created",
		backupPath: "/tmp/codex-pre-import-backup-20260101-000000000-deadbe.json",
	})),
	previewImportAccounts: vi.fn(async () => ({ imported: 2, skipped: 1, total: 5 })),
	createTimestampedBackupPath: vi.fn((prefix?: string) => `/tmp/${prefix ?? "codex-backup"}-20260101-000000.json`),
	loadFlaggedAccounts: vi.fn(async () => ({ version: 1, accounts: [] })),
	saveFlaggedAccounts: vi.fn(async () => {}),
	clearFlaggedAccounts: vi.fn(async () => {}),
	StorageError: class StorageError extends Error {
		hint: string;
		constructor(message: string, hint: string) {
			super(message);
			this.hint = hint;
		}
	},
	formatStorageErrorHint: () => "Check file permissions",
}));

vi.mock("../lib/accounts.js", () => {
	class MockAccountManager {
		private accounts = [
			{
				index: 0,
				accountId: "acc-1",
				email: "user1@example.com",
				refreshToken: "refresh-1",
			},
		];

		static async loadFromDisk() {
			return new MockAccountManager();
		}

		getAccountCount() {
			return this.accounts.length;
		}

		getCurrentOrNextForFamily() {
			return this.accounts[0] ?? null;
		}

		getCurrentOrNextForFamilyHybrid() {
			return this.accounts[0] ?? null;
		}

		getSelectionExplainability() {
			return this.accounts.map((account, index) => ({
				index,
				enabled: true,
				isCurrentForFamily: index === 0,
				eligible: true,
				reasons: ["eligible"],
				healthScore: 100,
				tokensAvailable: 50,
				lastUsed: Date.now(),
			}));
		}

		recordSuccess() {}
		recordRateLimit() {}
		recordFailure() {}

		toAuthDetails() {
			return {
				type: "oauth" as const,
				access: "access-token",
				refresh: "refresh-token",
				expires: Date.now() + 60_000,
			};
		}

		hasRefreshToken() {
			return true;
		}

		saveToDiskDebounced() {}
		updateFromAuth() {}
		clearAuthFailures() {}
		incrementAuthFailures() { return 1; }
		async saveToDisk() {}
		markAccountCoolingDown() {}
		markAccountsWithRefreshTokenCoolingDown() { return 1; }
		markRateLimited() {}
		markRateLimitedWithReason() {}
		consumeToken() { return true; }
		refundToken() {}
		markSwitched() {}
		removeAccount() {}
		removeAccountsWithSameRefreshToken() { return 1; }

		getMinWaitTimeForFamily() {
			return 0;
		}

		shouldShowAccountToast() {
			return false;
		}

		markToastShown() {}

		setActiveIndex(index: number) {
			return this.accounts[index] ?? null;
		}

		getAccountsSnapshot() {
			return this.accounts;
		}
	}

	return {
		AccountManager: MockAccountManager,
		getAccountIdCandidates: vi.fn(() => [
			{ accountId: "acc-1", source: "token" as const, label: "Test" },
		]),
		selectBestAccountCandidate: vi.fn(
			(candidates: Array<{ accountId: string }>) => candidates[0] ?? null,
		),
		extractAccountEmail: vi.fn(() => "user@example.com"),
		extractAccountId: vi.fn(() => "account-1"),
		resolveRequestAccountId: (_storedId: string | undefined, _source: string | undefined, tokenId: string | undefined) => tokenId,
		formatAccountLabel: (_account: unknown, index: number) => `Account ${index + 1}`,
		formatCooldown: () => null,
		formatWaitTime: (ms: number) => `${Math.round(ms / 1000)}s`,
		sanitizeEmail: (email: string) => email,
		shouldUpdateAccountIdFromToken: () => true,
		parseRateLimitReason: () => "unknown",
		lookupCodexCliTokensByEmail: vi.fn(async () => null),
	};
});

type ToolExecute<T = void> = { execute: (args: T) => Promise<string> };
type OptionalToolExecute<T> = { execute: (args?: T) => Promise<string> };
type PluginType = {
	event: (input: { event: { type: string; properties?: unknown } }) => Promise<void>;
	"chat.message": (
		input: {
			sessionID: string;
			model?: SessionModelRef;
		},
		output: { message: unknown; parts: unknown[] },
	) => Promise<void>;
	"experimental.chat.messages.transform": (
		input: Record<string, never>,
		output: {
			messages: Array<{
				info: {
					role: string;
					sessionID?: string;
					model?: Partial<SessionModelRef> & { variant?: string };
					variant?: string;
					thinking?: string;
				};
				parts: unknown[];
			}>;
		},
	) => Promise<void>;
	auth: {
		provider: string;
		methods: Array<{ label: string; type: string }>;
		loader: (getAuth: () => Promise<unknown>, provider: unknown) => Promise<{
			apiKey?: string;
			baseURL?: string;
			fetch?: (input: unknown, init?: unknown) => Promise<Response>;
		}>;
	};
	tool: {
		"codex-list": OptionalToolExecute<{ tag?: string }>;
		"codex-switch": OptionalToolExecute<{ index?: number }>;
		"codex-status": ToolExecute;
		"codex-limits": ToolExecute;
		"codex-metrics": ToolExecute;
		"codex-help": ToolExecute<{ topic?: string }>;
		"codex-setup": OptionalToolExecute<{ wizard?: boolean }>;
		"codex-doctor": OptionalToolExecute<{ deep?: boolean; fix?: boolean }>;
		"codex-next": ToolExecute;
		"codex-label": ToolExecute<{ index?: number; label: string }>;
		"codex-tag": ToolExecute<{ index?: number; tags: string }>;
		"codex-note": ToolExecute<{ index?: number; note: string }>;
		"codex-dashboard": ToolExecute;
		"codex-health": ToolExecute;
		"codex-remove": OptionalToolExecute<{ index?: number }>;
		"codex-refresh": ToolExecute;
		"codex-export": ToolExecute<{ path?: string; force?: boolean; timestamped?: boolean }>;
		"codex-import": ToolExecute<{ path: string; dryRun?: boolean }>;
	};
};

const createMockClient = () => ({
	tui: { showToast: vi.fn() },
	auth: { set: vi.fn() },
	session: { prompt: vi.fn() },
});

describe("OpenAIOAuthPlugin", () => {
	let plugin: PluginType;
	let mockClient: ReturnType<typeof createMockClient>;

	beforeEach(async () => {
		vi.clearAllMocks();
		mockClient = createMockClient();

		mockStorage.accounts = [];
		mockStorage.activeIndex = 0;
		mockStorage.activeIndexByFamily = {};

		const { OpenAIOAuthPlugin } = await import("../index.js");
		plugin = await OpenAIOAuthPlugin({ client: mockClient } as never) as unknown as PluginType;
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("plugin structure", () => {
		it("exports event handler", () => {
			expect(plugin.event).toBeDefined();
			expect(typeof plugin.event).toBe("function");
		});

		it("exports auth configuration", () => {
			expect(plugin.auth).toBeDefined();
			expect(plugin.auth.provider).toBe("openai");
		});

		it("exports tool definitions", () => {
			expect(plugin.tool).toBeDefined();
			expect(plugin.tool["codex-list"]).toBeDefined();
			expect(plugin.tool["codex-switch"]).toBeDefined();
			expect(plugin.tool["codex-status"]).toBeDefined();
			expect(plugin.tool["codex-limits"]).toBeDefined();
			expect(plugin.tool["codex-metrics"]).toBeDefined();
			expect(plugin.tool["codex-help"]).toBeDefined();
			expect(plugin.tool["codex-setup"]).toBeDefined();
			expect(plugin.tool["codex-doctor"]).toBeDefined();
			expect(plugin.tool["codex-next"]).toBeDefined();
			expect(plugin.tool["codex-label"]).toBeDefined();
			expect(plugin.tool["codex-tag"]).toBeDefined();
			expect(plugin.tool["codex-note"]).toBeDefined();
			expect(plugin.tool["codex-dashboard"]).toBeDefined();
			expect(plugin.tool["codex-health"]).toBeDefined();
			expect(plugin.tool["codex-remove"]).toBeDefined();
			expect(plugin.tool["codex-refresh"]).toBeDefined();
			expect(plugin.tool["codex-export"]).toBeDefined();
			expect(plugin.tool["codex-import"]).toBeDefined();
		});

		it("has two auth methods", () => {
			expect(plugin.auth.methods).toHaveLength(2);
			expect(plugin.auth.methods[0].label).toBe("ChatGPT Plus/Pro MULTI (Codex Subscription)");
			expect(plugin.auth.methods[1].label).toBe("ChatGPT Plus/Pro MULTI (Manual URL Paste)");
		});

		it("rejects manual OAuth callbacks with mismatched state", async () => {
			const authModule = await import("../lib/auth/auth.js");
			const manualMethod = plugin.auth.methods[1] as unknown as {
				authorize: () => Promise<{
					validate: (input: string) => string | undefined;
					callback: (input: string) => Promise<{ type: string; reason?: string; message?: string }>;
				}>;
			};

			const flow = await manualMethod.authorize();
			const invalidInput = "http://127.0.0.1:1455/auth/callback?code=abc123&state=wrong-state";

			expect(flow.validate(invalidInput)).toContain("state mismatch");
			const result = await flow.callback(invalidInput);
			expect(result.type).toBe("failed");
			expect(result.reason).toBe("invalid_response");
			expect(vi.mocked(authModule.exchangeAuthorizationCode)).not.toHaveBeenCalled();
		});
	});

	describe("event handler", () => {
		it("handles account.select event", async () => {
			await plugin.event({ event: { type: "account.select", properties: { index: 0 } } });
		});

		it("handles openai.account.select event", async () => {
			await plugin.event({ event: { type: "openai.account.select", properties: { index: 0 } } });
		});

		it("ignores events with different provider", async () => {
			await plugin.event({
				event: { type: "account.select", properties: { provider: "other", index: 0 } },
			});
		});

		it("handles events without properties", async () => {
			await plugin.event({ event: { type: "unknown.event" } });
		});
	});

	describe("auth loader", () => {
		it("returns SDK config for non-oauth auth when stored accounts exist", async () => {
			const getAuth = async () => ({ type: "apikey" as const, key: "test" });
			const result = await plugin.auth.loader(getAuth, {});
			expect(result.apiKey).toBeDefined();
			expect(result.baseURL).toBeDefined();
			expect(result.fetch).toBeDefined();
		});

		it("returns empty for non-oauth auth when no stored accounts exist", async () => {
			const accountsModule = await import("../lib/accounts.js");
			vi.spyOn(accountsModule.AccountManager, "loadFromDisk").mockResolvedValue({
				getAccountCount: () => 0,
				hasRefreshToken: () => false,
				saveToDisk: async () => {},
			} as unknown as InstanceType<typeof accountsModule.AccountManager>);

			const getAuth = async () => ({ type: "apikey" as const, key: "test" });
			const result = await plugin.auth.loader(getAuth, {});
			expect(result).toEqual({});
		});

		it("returns SDK config for oauth without multiAccount marker", async () => {
			const getAuth = async () => ({
				type: "oauth" as const,
				access: "a",
				refresh: "r",
				expires: Date.now() + 60_000,
			});
			const result = await plugin.auth.loader(getAuth, {});
			expect(result.apiKey).toBeDefined();
			expect(result.baseURL).toBeDefined();
			expect(result.fetch).toBeDefined();
		});

		it("returns SDK config for multiAccount oauth", async () => {
			const getAuth = async () => ({
				type: "oauth" as const,
				access: "a",
				refresh: "r",
				expires: Date.now() + 60_000,
				multiAccount: true,
			});
			const result = await plugin.auth.loader(getAuth, { options: {}, models: {} });
			expect(result.apiKey).toBeDefined();
			expect(result.baseURL).toBeDefined();
			expect(result.fetch).toBeDefined();
		});
	});

	describe("codex-list tool", () => {
		it("returns message when no accounts", async () => {
			mockStorage.accounts = [];
			const result = await plugin.tool["codex-list"].execute();
			expect(result).toContain("No Codex accounts configured");
			expect(result).toContain("opencode auth login");
		});

		it("lists accounts with status", async () => {
			mockStorage.accounts = [
				{ refreshToken: "r1", email: "user1@example.com", accountId: "acc-1" },
				{ refreshToken: "r2", email: "user2@example.com", accountId: "acc-2" },
			];
			const result = await plugin.tool["codex-list"].execute();
			expect(result).toContain("Codex Accounts (2)");
			expect(result).toContain("Account 1");
			expect(result).toContain("Account 2");
		});

		it("shows rate-limited status", async () => {
			mockStorage.accounts = [
				{
					refreshToken: "r1",
					email: "user@example.com",
					rateLimitResetTimes: { "codex": Date.now() + 60000 },
				},
			];
			const result = await plugin.tool["codex-list"].execute();
			expect(result).toContain("rate-limited");
		});

		it("shows cooldown status", async () => {
			mockStorage.accounts = [
				{
					refreshToken: "r1",
					email: "user@example.com",
					coolingDownUntil: Date.now() + 60000,
				},
			];
			const result = await plugin.tool["codex-list"].execute();
			expect(result).toContain("cooldown");
		});

		it("filters accounts by tag", async () => {
			mockStorage.accounts = [
				{ refreshToken: "r1", email: "user1@example.com", accountTags: ["work"] },
				{ refreshToken: "r2", email: "user2@example.com", accountTags: ["personal"] },
			];
			const result = await plugin.tool["codex-list"].execute({ tag: "work" });
			expect(result).toContain("user1@example.com");
			expect(result).not.toContain("user2@example.com");
		});
	});

	describe("codex-switch tool", () => {
		it("returns error when no accounts", async () => {
			mockStorage.accounts = [];
			const result = await plugin.tool["codex-switch"].execute({ index: 1 });
			expect(result).toContain("No Codex accounts configured");
		});

		it("returns guidance when index is omitted in non-interactive mode", async () => {
			mockStorage.accounts = [{ refreshToken: "r1", email: "user@example.com" }];
			const result = await plugin.tool["codex-switch"].execute();
			expect(result).toContain("Missing account number");
			expect(result).toContain("codex-switch index=2");
		});

		it("returns error for invalid index", async () => {
			mockStorage.accounts = [{ refreshToken: "r1" }];
			const result = await plugin.tool["codex-switch"].execute({ index: 5 });
			expect(result).toContain("Invalid account number");
		});

		it("switches to valid account", async () => {
			mockStorage.accounts = [
				{ refreshToken: "r1", email: "user1@example.com" },
				{ refreshToken: "r2", email: "user2@example.com" },
			];
			const result = await plugin.tool["codex-switch"].execute({ index: 2 });
			expect(result).toContain("Switched to account");
		});

		it("reloads account manager from disk when cached manager exists", async () => {
			const { AccountManager } = await import("../lib/accounts.js");
			const loadFromDiskSpy = vi.spyOn(AccountManager, "loadFromDisk");
			const getAuth = async () => ({
				type: "oauth" as const,
				access: "access-token",
				refresh: "refresh-token",
				expires: Date.now() + 60_000,
				multiAccount: true,
			});

			mockStorage.accounts = [
				{ refreshToken: "r1", email: "user1@example.com" },
				{ refreshToken: "r2", email: "user2@example.com" },
			];

			await plugin.auth.loader(getAuth, { options: {}, models: {} });
			loadFromDiskSpy.mockClear();

			await plugin.tool["codex-switch"].execute({ index: 2 });
			expect(loadFromDiskSpy).toHaveBeenCalledTimes(1);
		});
	});

	describe("codex-status tool", () => {
		it("returns error when no accounts", async () => {
			mockStorage.accounts = [];
			const result = await plugin.tool["codex-status"].execute();
			expect(result).toContain("No Codex accounts configured");
		});

		it("shows detailed status for accounts", async () => {
			mockStorage.accounts = [
				{ refreshToken: "r1", email: "user@example.com", lastUsed: Date.now() - 60000 },
			];
			mockStorage.activeIndexByFamily = { codex: 0 };
			const result = await plugin.tool["codex-status"].execute();
			expect(result).toContain("Account Status");
			expect(result).toContain("Active index by model family");
		});
	});

	describe("codex-limits tool", () => {
		let originalFetch: typeof globalThis.fetch;

		beforeEach(() => {
			originalFetch = globalThis.fetch;
			mockStorage.activeIndex = 0;
			mockStorage.activeIndexByFamily = {};
		});

		afterEach(() => {
			globalThis.fetch = originalFetch;
		});

		it("returns error when no accounts", async () => {
			mockStorage.accounts = [];
			const result = await plugin.tool["codex-limits"].execute();
			expect(result).toContain("No Codex accounts configured");
		});

		it("shows live usage windows from wham usage", async () => {
			mockStorage.accounts = [
				{
					refreshToken: "r1",
					accountId: "acc-1",
					email: "user@example.com",
					accessToken: "access-1",
					expiresAt: Date.now() + 3600_000,
				},
			];
			globalThis.fetch = vi.fn().mockResolvedValue(
				new Response(
					JSON.stringify({
						plan_type: "team",
						rate_limit: {
							primary_window: {
								used_percent: 13,
								limit_window_seconds: 18000,
								reset_at: Math.floor(Date.now() / 1000) + 3600,
							},
							secondary_window: {
								used_percent: 36,
								limit_window_seconds: 604800,
								reset_at: Math.floor(Date.now() / 1000) + 86400,
							},
						},
						code_review_rate_limit: {
							primary_window: {
								used_percent: 0,
								limit_window_seconds: 604800,
								reset_at: Math.floor(Date.now() / 1000) + 7200,
							},
						},
						credits: { unlimited: true, has_credits: true },
					}),
					{ status: 200, headers: { "content-type": "application/json" } },
				),
			);

			const result = await plugin.tool["codex-limits"].execute();

			expect(result).toContain("Codex limits");
			expect(result).toContain("5h limit: 87% left");
			expect(result).toContain("Weekly limit: 64% left");
			expect(result).toContain("Code review: 100% left");
			expect(result).toContain("Plan: team");
			expect(result).toContain("Credits: unlimited");
			expect(globalThis.fetch).toHaveBeenCalledWith(
				"https://chatgpt.com/backend-api/wham/usage",
				expect.objectContaining({ method: "GET" }),
			);
		});

		it("refreshes missing tokens before fetching usage", async () => {
			mockStorage.accounts = [
				{ refreshToken: "r1", accountId: "acc-1", email: "user@example.com" },
			];
			globalThis.fetch = vi.fn().mockResolvedValue(
				new Response(
					JSON.stringify({
						rate_limit: {
							primary_window: { used_percent: 0, limit_window_seconds: 18000, reset_at: Math.floor(Date.now() / 1000) + 1800 },
							secondary_window: { used_percent: 0, limit_window_seconds: 604800, reset_at: Math.floor(Date.now() / 1000) + 3600 },
						},
					}),
					{ status: 200, headers: { "content-type": "application/json" } },
				),
			);

			const result = await plugin.tool["codex-limits"].execute();

			expect(result).toContain("100% left");
			expect(mockStorage.accounts[0]?.accessToken).toBe("refreshed-access");
		});

		it("deduplicates accounts with same refreshToken and keeps the active marker", async () => {
			const { createCodexHeaders } = await import("../lib/request/fetch-helpers.js");
			mockStorage.accounts = [
				{
					refreshToken: "rt_same",
					accountId: "acc-1",
					organizationId: "org-1",
					email: "a@test.com",
					accessToken: "shared-access",
					expiresAt: Date.now() + 3600_000,
				},
				{
					refreshToken: "rt_same",
					accountId: "acc-2",
					organizationId: "org-2",
					email: "a@test.com",
					accessToken: "shared-access",
					expiresAt: Date.now() + 3600_000,
				},
				{
					refreshToken: "rt_other",
					accountId: "acc-3",
					email: "b@test.com",
					accessToken: "access-3",
					expiresAt: Date.now() + 3600_000,
				},
			];
			mockStorage.activeIndex = 1;
			mockStorage.activeIndexByFamily = { codex: 1 };
			globalThis.fetch = vi.fn().mockImplementation(async () =>
				new Response(
					JSON.stringify({
						rate_limit: {
							primary_window: { used_percent: 50, limit_window_seconds: 18000, reset_at: Math.floor(Date.now() / 1000) + 1800 },
							secondary_window: { used_percent: 50, limit_window_seconds: 604800, reset_at: Math.floor(Date.now() / 1000) + 86400 },
						},
					}),
					{ status: 200, headers: { "content-type": "application/json" } },
				),
			);
			vi.mocked(createCodexHeaders).mockClear();

			const result = await plugin.tool["codex-limits"].execute();

			expect(result).toContain("2 account");
			expect(globalThis.fetch).toHaveBeenCalledTimes(2);
			expect(result).toContain("Account 2 (a@test.com, id:acc-2) [active]:");
			expect(result.match(/Account 2 \(a@test\.com, id:acc-2\)/g)).toHaveLength(1);
			expect(result).not.toContain("Account 1 (a@test.com, id:acc-1):");
			expect(result).toContain("Account 3 (b@test.com, id:acc-3):");
			expect(result).not.toContain("Account 2 (a@test.com, id:acc-2):");
			expect(vi.mocked(createCodexHeaders)).toHaveBeenCalledWith(
				undefined,
				"acc-2",
				"shared-access",
				expect.objectContaining({ organizationId: "org-2" }),
			);
		});

		it("does not deduplicate accounts that are missing refreshToken", async () => {
			mockStorage.activeIndex = 0;
			mockStorage.activeIndexByFamily = {};
			mockStorage.accounts = [
				{
					refreshToken: "",
					accountId: "acc-1",
					email: "missing-1@test.com",
					accessToken: "access-1",
					expiresAt: Date.now() + 3600_000,
				},
				{
					refreshToken: "",
					accountId: "acc-2",
					email: "missing-2@test.com",
					accessToken: "access-2",
					expiresAt: Date.now() + 3600_000,
				},
				{
					refreshToken: "rt_other",
					accountId: "acc-3",
					email: "other@test.com",
					accessToken: "access-3",
					expiresAt: Date.now() + 3600_000,
				},
			];
			globalThis.fetch = vi.fn().mockImplementation(async () =>
				new Response(
					JSON.stringify({
						rate_limit: {
							primary_window: { used_percent: 25, limit_window_seconds: 18000, reset_at: Math.floor(Date.now() / 1000) + 1800 },
							secondary_window: { used_percent: 25, limit_window_seconds: 604800, reset_at: Math.floor(Date.now() / 1000) + 86400 },
						},
					}),
					{ status: 200, headers: { "content-type": "application/json" } },
				),
			);

			const result = await plugin.tool["codex-limits"].execute();

			expect(result).toContain("3 account");
			expect(globalThis.fetch).toHaveBeenCalledTimes(3);
			expect(result).toContain("Account 1 (missing-1@test.com, id:acc-1) [active]:");
			expect(result).toContain("Account 2 (missing-2@test.com, id:acc-2):");
			expect(result).toContain("Account 3 (other@test.com, id:acc-3):");
		});

		it("propagates refreshed credentials to duplicate stored accounts", async () => {
			const { loadAccounts } = await import("../lib/storage.js");
			const { queuedRefresh } = await import("../lib/refresh-queue.js");
			const rotatedExpires = Date.now() + 7200_000;
			vi.mocked(queuedRefresh).mockResolvedValueOnce({
				type: "success",
				access: "rotated-access",
				refresh: "rotated-refresh",
				expires: rotatedExpires,
			});
			mockStorage.accounts = [
				{
					refreshToken: "stale-refresh",
					accountId: "acc-1",
					email: "a@test.com",
					accessToken: "expired-access-1",
					expiresAt: Date.now() - 1000,
				},
				{
					refreshToken: "stale-refresh",
					accountId: "acc-2",
					email: "a@test.com",
					accessToken: "expired-access-2",
					expiresAt: Date.now() - 1000,
				},
			];
			globalThis.fetch = vi.fn().mockImplementation(async () =>
				new Response(
					JSON.stringify({
						rate_limit: {
							primary_window: { used_percent: 10, limit_window_seconds: 18000, reset_at: Math.floor(Date.now() / 1000) + 1800 },
							secondary_window: { used_percent: 10, limit_window_seconds: 604800, reset_at: Math.floor(Date.now() / 1000) + 86400 },
						},
					}),
					{ status: 200, headers: { "content-type": "application/json" } },
				),
			);

			await plugin.tool["codex-limits"].execute();

			expect(vi.mocked(queuedRefresh)).toHaveBeenCalledTimes(1);
			expect(vi.mocked(queuedRefresh)).toHaveBeenCalledWith("stale-refresh");
			const reloadedStorage = await vi.mocked(loadAccounts)();
			expect(reloadedStorage?.accounts.map((account) => account.refreshToken)).toEqual([
				"rotated-refresh",
				"rotated-refresh",
			]);
			expect(reloadedStorage?.accounts.map((account) => account.accessToken)).toEqual([
				"rotated-access",
				"rotated-access",
			]);
			expect(reloadedStorage?.accounts.map((account) => account.expiresAt)).toEqual([
				rotatedExpires,
				rotatedExpires,
			]);
		});

		it("updates the current account when transactional refresh fallback matches by identity", async () => {
			const { queuedRefresh } = await import("../lib/refresh-queue.js");
			const { loadAccounts, withAccountStorageTransaction } = await import("../lib/storage.js");
			const refreshedExpires = Date.now() + 7200_000;
			vi.mocked(queuedRefresh).mockResolvedValueOnce({
				type: "success",
				access: "single-access",
				refresh: "single-refresh",
				expires: refreshedExpires,
			});
			mockStorage.accounts = [
				{
					refreshToken: "stale-refresh",
					accountId: "acc-1",
					email: "solo@test.com",
					accessToken: "",
					expiresAt: Date.now() - 1000,
				},
			];
			vi.mocked(withAccountStorageTransaction).mockImplementationOnce(
				async (
					handler: (
						current: typeof mockStorage | null,
						persist: (storage: typeof mockStorage) => Promise<void>,
					) => Promise<boolean>,
				) =>
					await handler(
						{
							version: 3,
							accounts: [
								{
									refreshToken: "different-refresh",
									accountId: "acc-1",
									email: "solo@test.com",
								},
							],
							activeIndex: 0,
							activeIndexByFamily: {},
						},
						async (nextStorage) => {
							mockStorage.version = nextStorage.version;
							mockStorage.accounts = nextStorage.accounts.map((account) => structuredClone(account));
							mockStorage.activeIndex = nextStorage.activeIndex;
							mockStorage.activeIndexByFamily = { ...nextStorage.activeIndexByFamily };
						},
					),
			);
			globalThis.fetch = vi.fn().mockImplementation(async () =>
				new Response(
					JSON.stringify({
						rate_limit: {
							primary_window: { used_percent: 5, limit_window_seconds: 18000, reset_at: Math.floor(Date.now() / 1000) + 1800 },
							secondary_window: { used_percent: 5, limit_window_seconds: 604800, reset_at: Math.floor(Date.now() / 1000) + 86400 },
						},
					}),
					{ status: 200, headers: { "content-type": "application/json" } },
				),
			);

			await plugin.tool["codex-limits"].execute();

			expect(vi.mocked(queuedRefresh)).toHaveBeenCalledWith("stale-refresh");
			const reloadedStorage = await vi.mocked(loadAccounts)();
			expect(reloadedStorage?.accounts[0]?.refreshToken).toBe("single-refresh");
			expect(reloadedStorage?.accounts[0]?.accessToken).toBe("single-access");
			expect(reloadedStorage?.accounts[0]?.expiresAt).toBe(refreshedExpires);
		});

		it("updates only the single matching stored account during refresh propagation", async () => {
			const { queuedRefresh } = await import("../lib/refresh-queue.js");
			const { loadAccounts } = await import("../lib/storage.js");
			const refreshedExpires = Date.now() + 7200_000;
			vi.mocked(queuedRefresh).mockResolvedValueOnce({
				type: "success",
				access: "matched-access",
				refresh: "matched-refresh",
				expires: refreshedExpires,
			});
			mockStorage.accounts = [
				{
					refreshToken: "single-match",
					accountId: "acc-1",
					email: "match@test.com",
					accessToken: "",
					expiresAt: Date.now() - 1000,
				},
				{
					refreshToken: "other-refresh",
					accountId: "acc-2",
					email: "other@test.com",
					accessToken: "still-valid",
					expiresAt: Date.now() + 3600_000,
				},
			];
			globalThis.fetch = vi.fn().mockImplementation(async () =>
				new Response(
					JSON.stringify({
						rate_limit: {
							primary_window: { used_percent: 15, limit_window_seconds: 18000, reset_at: Math.floor(Date.now() / 1000) + 1800 },
							secondary_window: { used_percent: 15, limit_window_seconds: 604800, reset_at: Math.floor(Date.now() / 1000) + 86400 },
						},
					}),
					{ status: 200, headers: { "content-type": "application/json" } },
				),
			);

			await plugin.tool["codex-limits"].execute();

			expect(vi.mocked(queuedRefresh)).toHaveBeenCalledWith("single-match");
			const reloadedStorage = await vi.mocked(loadAccounts)();
			expect(reloadedStorage?.accounts[0]?.refreshToken).toBe("matched-refresh");
			expect(reloadedStorage?.accounts[0]?.accessToken).toBe("matched-access");
			expect(reloadedStorage?.accounts[0]?.expiresAt).toBe(refreshedExpires);
			expect(reloadedStorage?.accounts[1]?.refreshToken).toBe("other-refresh");
			expect(reloadedStorage?.accounts[1]?.accessToken).toBe("still-valid");
		});

		it("warns when refreshed credentials would otherwise fall back to a different account with the same email", async () => {
			const { queuedRefresh } = await import("../lib/refresh-queue.js");
			const { loadAccounts, withAccountStorageTransaction } = await import("../lib/storage.js");
			const loggerModule = await import("../lib/logger.js");
			const transactionStorage = {
				version: 3 as const,
				accounts: [
					{
						refreshToken: "different-refresh",
						accountId: "acc-other",
						organizationId: "org-a",
						email: "user@example.com",
						accessToken: "other-access",
						expiresAt: Date.now() + 3600_000,
					},
					{
						refreshToken: "different-refresh-2",
						accountId: "acc-other-2",
						organizationId: "org-b",
						email: "user@example.com",
						accessToken: "other-access-2",
						expiresAt: Date.now() + 3600_000,
					},
				],
				activeIndex: 0,
				activeIndexByFamily: {},
			};
			vi.mocked(queuedRefresh).mockResolvedValueOnce({
				type: "success",
				access: "orphaned-access",
				refresh: "orphaned-refresh",
				expires: Date.now() + 7200_000,
			});
			vi.mocked(withAccountStorageTransaction).mockImplementationOnce(
				async (
					handler: (
						current: typeof mockStorage | null,
						persist: (storage: typeof mockStorage) => Promise<void>,
					) => Promise<boolean>,
				) =>
					await handler(
						transactionStorage,
						async (nextStorage) => {
							mockStorage.version = nextStorage.version;
							mockStorage.accounts = nextStorage.accounts.map((account) => structuredClone(account));
							mockStorage.activeIndex = nextStorage.activeIndex;
							mockStorage.activeIndexByFamily = { ...nextStorage.activeIndexByFamily };
						},
					),
			);
			mockStorage.accounts = [
				{
					refreshToken: "stale-refresh",
					accountId: "acc-1",
					email: "user@example.com",
					accessToken: "",
					expiresAt: Date.now() - 1000,
				},
			];
			globalThis.fetch = vi.fn().mockImplementation(async () =>
				new Response(
					JSON.stringify({
						rate_limit: {
							primary_window: { used_percent: 0, limit_window_seconds: 18000, reset_at: Math.floor(Date.now() / 1000) + 1800 },
							secondary_window: { used_percent: 0, limit_window_seconds: 604800, reset_at: Math.floor(Date.now() / 1000) + 86400 },
						},
					}),
					{ status: 200, headers: { "content-type": "application/json" } },
				),
			);

			await plugin.tool["codex-limits"].execute();

			const warningCall = vi
				.mocked(loggerModule.logWarn)
				.mock.calls.find(([message]) =>
					typeof message === "string" &&
					message.includes("persistRefreshedCredentials could not find a matching stored account"),
				);
			expect(warningCall).toBeDefined();
			expect(warningCall?.[1]).toEqual(
				expect.objectContaining({
					accountId: "acc-1",
				}),
			);
			expect(warningCall?.[1]).not.toHaveProperty("email");
			expect(transactionStorage.accounts[0]).toMatchObject({
				accountId: "acc-other",
				refreshToken: "different-refresh",
				accessToken: "other-access",
			});
			expect(transactionStorage.accounts[1]).toMatchObject({
				accountId: "acc-other-2",
				refreshToken: "different-refresh-2",
				accessToken: "other-access-2",
			});
			const reloadedStorage = await vi.mocked(loadAccounts)();
			expect(reloadedStorage?.accounts[0]).toMatchObject({
				accountId: "acc-1",
				refreshToken: "stale-refresh",
				accessToken: "",
			});
		});

		it("reports missing refresh tokens instead of attempting a blank-token refresh", async () => {
			const { queuedRefresh } = await import("../lib/refresh-queue.js");
			mockStorage.accounts = [
				{
					refreshToken: "",
					accountId: "acc-1",
					email: "missing-refresh@test.com",
					accessToken: "",
					expiresAt: Date.now() - 1000,
				},
			];

			const result = await plugin.tool["codex-limits"].execute();

			expect(result).toContain("Error: Cannot refresh: account has no refresh token");
			expect(vi.mocked(queuedRefresh)).not.toHaveBeenCalled();
		});

		it("redacts upstream auth material from usage fetch errors", async () => {
			mockStorage.accounts = [
				{
					refreshToken: "r1",
					accountId: "acc-1",
					email: "user@example.com",
					accessToken: "access-1",
					expiresAt: Date.now() + 3600_000,
				},
			];
			globalThis.fetch = vi.fn().mockResolvedValue(
				new Response(
					"upstream said Authorization: Bearer secret-token and jwt eyJabc.eyJdef.sig and sk-abcdefghijklmnopqrstuvwx and sk-live_abcd.efgh:ijklmnopqrst and deadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
					{ status: 401, headers: { "content-type": "text/plain" } },
				),
			);

			const result = await plugin.tool["codex-limits"].execute();

			expect(result).toContain("Error: HTTP 401:");
			expect(result).toContain("Bearer [redacted]");
			expect(result).toContain("[redacted-token]");
			expect(result).not.toContain("secret-token");
			expect(result).not.toContain("eyJabc.eyJdef.sig");
			expect(result).not.toContain("sk-abcdefghijklmnopqrstuvwx");
			expect(result).not.toContain("sk-live_abcd.efgh:ijklmnopqrst");
			expect(result).not.toContain("deadbeefdeadbeefdeadbeefdeadbeefdeadbeef");
		});

		it("surfaces usage fetch timeouts without leaking raw abort errors", async () => {
			vi.useFakeTimers();
			mockStorage.accounts = [
				{
					refreshToken: "r1",
					accountId: "acc-1",
					email: "user@example.com",
					accessToken: "access-1",
					expiresAt: Date.now() + 3600_000,
				},
			];
			try {
				globalThis.fetch = vi.fn().mockImplementation(async (_input, init) => {
					const signal = init?.signal as AbortSignal | undefined;
					return {
						ok: false,
						status: 504,
						headers: new Headers({ "content-type": "text/plain" }),
						text: async () =>
							await new Promise<string>((_resolve, reject) => {
								signal?.addEventListener(
									"abort",
									() => reject(new DOMException("The operation was aborted.", "AbortError")),
									{ once: true },
								);
							}),
					} as Response;
				});

				const resultPromise = plugin.tool["codex-limits"].execute();
				await vi.runAllTimersAsync();
				const result = await resultPromise;

				expect(result).toContain("Error: Usage request timed out");
				expect(result).not.toContain("AbortError");
				expect(result).not.toContain("DOMException");
			} finally {
				vi.useRealTimers();
			}
		});

		it("surfaces usage fetch timeouts before response headers arrive", async () => {
			vi.useFakeTimers();
			mockStorage.accounts = [
				{
					refreshToken: "r1",
					accountId: "acc-1",
					email: "user@example.com",
					accessToken: "access-1",
					expiresAt: Date.now() + 3600_000,
				},
			];
			try {
				globalThis.fetch = vi.fn().mockImplementation(async (_input, init) =>
					await new Promise<Response>((_resolve, reject) => {
						const signal = init?.signal as AbortSignal | undefined;
						signal?.addEventListener(
							"abort",
							() => reject(new DOMException("The operation was aborted.", "AbortError")),
							{ once: true },
						);
					}),
				);

				const resultPromise = plugin.tool["codex-limits"].execute();
				await vi.runAllTimersAsync();
				const result = await resultPromise;

				expect(result).toContain("Error: Usage request timed out");
				expect(result).not.toContain("AbortError");
				expect(result).not.toContain("DOMException");
			} finally {
				vi.useRealTimers();
			}
		});

		it("surfaces usage fetch timeouts during successful response body reads", async () => {
			vi.useFakeTimers();
			mockStorage.accounts = [
				{
					refreshToken: "r1",
					accountId: "acc-1",
					email: "user@example.com",
					accessToken: "access-1",
					expiresAt: Date.now() + 3600_000,
				},
			];
			try {
				globalThis.fetch = vi.fn().mockImplementation(async (_input, init) => {
					const signal = init?.signal as AbortSignal | undefined;
					return {
						ok: true,
						status: 200,
						headers: new Headers({ "content-type": "application/json" }),
						json: async () =>
							await new Promise<unknown>((_resolve, reject) => {
								signal?.addEventListener(
									"abort",
									() => reject(new DOMException("The operation was aborted.", "AbortError")),
									{ once: true },
								);
							}),
					} as Response;
				});

				const resultPromise = plugin.tool["codex-limits"].execute();
				await vi.runAllTimersAsync();
				const result = await resultPromise;

				expect(result).toContain("Error: Usage request timed out");
				expect(result).not.toContain("AbortError");
				expect(result).not.toContain("DOMException");
			} finally {
				vi.useRealTimers();
			}
		});

		it("preserves non-abort text read failures from unsuccessful responses", async () => {
			mockStorage.accounts = [
				{
					refreshToken: "r1",
					accountId: "acc-1",
					email: "user@example.com",
					accessToken: "access-1",
					expiresAt: Date.now() + 3600_000,
				},
			];
			globalThis.fetch = vi.fn().mockImplementation(async () => ({
				ok: false,
				status: 502,
				headers: new Headers({ "content-type": "text/plain" }),
				text: async () => {
					throw new Error("body read failed");
				},
			} as Response));

			const result = await plugin.tool["codex-limits"].execute();

			expect(result).toContain("Error: body read failed");
			expect(result).not.toContain("Usage request timed out");
		});

		it("preserves non-abort json read failures from successful responses", async () => {
			mockStorage.accounts = [
				{
					refreshToken: "r1",
					accountId: "acc-1",
					email: "user@example.com",
					accessToken: "access-1",
					expiresAt: Date.now() + 3600_000,
				},
			];
			globalThis.fetch = vi.fn().mockImplementation(async () => ({
				ok: true,
				status: 200,
				headers: new Headers({ "content-type": "application/json" }),
				json: async () => {
					throw new Error("body read failed");
				},
			} as Response));

			const result = await plugin.tool["codex-limits"].execute();

			expect(result).toContain("Error: body read failed");
			expect(result).not.toContain("Usage request timed out");
		});
	});

	describe("codex-metrics tool", () => {
		it("shows runtime metrics", async () => {
			const result = await plugin.tool["codex-metrics"].execute();
			expect(result).toContain("Codex Plugin Metrics");
			expect(result).toContain("Total upstream requests");
		});
	});

	describe("codex-help tool", () => {
		it("shows the default help overview", async () => {
			const result = await plugin.tool["codex-help"].execute({ topic: "" });
			expect(result).toContain("Codex Help");
			expect(result).toContain("Quickstart");
			expect(result).toContain("codex-doctor");
			expect(result).toContain("codex-setup --wizard");
		});

		it("filters by topic", async () => {
			const result = await plugin.tool["codex-help"].execute({ topic: "backup" });
			expect(result).toContain("Backup and migration");
			expect(result).toContain("codex-export");
		});

		it("handles unknown topics", async () => {
			const result = await plugin.tool["codex-help"].execute({ topic: "unknown-topic" });
			expect(result).toContain("Unknown topic");
			expect(result).toContain("Available topics");
		});
	});

	describe("codex-setup tool", () => {
		it("shows checklist with login guidance when no accounts exist", async () => {
			mockStorage.accounts = [];
			const result = await plugin.tool["codex-setup"].execute();
			expect(result).toContain("Setup Checklist");
			expect(result).toContain("opencode auth login");
			expect(result).toContain("codex-setup --wizard");
		});

		it("shows healthy account progress when account exists", async () => {
			mockStorage.accounts = [{ refreshToken: "r1", email: "user@example.com" }];
			const result = await plugin.tool["codex-setup"].execute();
			expect(result).toContain("Healthy accounts");
			expect(result).toContain("Recommended next step");
		});

		it("falls back to checklist when wizard is requested in non-interactive test environment", async () => {
			mockStorage.accounts = [{ refreshToken: "r1", email: "user@example.com" }];
			const result = await plugin.tool["codex-setup"].execute({ wizard: true });
			expect(result).toContain("Interactive wizard mode is unavailable");
			expect(result).toContain("Showing checklist view instead");
			expect(result).toContain("Setup Checklist");
		});
	});

	describe("codex-doctor tool", () => {
		it("reports diagnostics when no accounts exist", async () => {
			mockStorage.accounts = [];
			const result = await plugin.tool["codex-doctor"].execute({ deep: false });
			expect(result).toContain("Codex Doctor");
			expect(result).toContain("No accounts are configured");
		});

		it("includes technical snapshot in deep mode", async () => {
			mockStorage.accounts = [{ refreshToken: "r1", email: "user@example.com" }];
			const result = await plugin.tool["codex-doctor"].execute({ deep: true });
			expect(result).toContain("Technical snapshot");
			expect(result).toContain("Storage:");
		});

		it("applies safe auto-fixes when fix mode is enabled", async () => {
			mockStorage.accounts = [{ refreshToken: "r1", email: "user@example.com" }];
			const result = await plugin.tool["codex-doctor"].execute({ fix: true });
			expect(result).toContain("Auto-fix");
			expect(result).toContain("Refreshed");
		});

		it("reports when no eligible account exists for auto-switch during fix mode", async () => {
			mockStorage.accounts = [{ refreshToken: "r1", email: "user@example.com" }];
			const { AccountManager } = await import("../lib/accounts.js");
			vi.spyOn(AccountManager, "loadFromDisk").mockResolvedValue({
				getSelectionExplainability: () => [
					{
						index: 0,
						enabled: true,
						isCurrentForFamily: true,
						eligible: false,
						reasons: ["rate-limited"],
						healthScore: 0,
						tokensAvailable: 0,
						lastUsed: Date.now(),
					},
				],
			} as unknown as InstanceType<typeof AccountManager>);

			const result = await plugin.tool["codex-doctor"].execute({ fix: true });
			expect(result).toContain("Auto-fix");
			expect(result).toContain("No eligible account available for auto-switch");
		});
	});

	describe("codex-next tool", () => {
		it("recommends login when no accounts exist", async () => {
			mockStorage.accounts = [];
			const result = await plugin.tool["codex-next"].execute();
			expect(result).toContain("opencode auth login");
		});

		it("recommends dashboard for healthy setup", async () => {
			mockStorage.accounts = [{ refreshToken: "r1", email: "user@example.com" }];
			const result = await plugin.tool["codex-next"].execute();
			expect(result).toContain("codex-dashboard");
		});
	});

	describe("codex-label tool", () => {
		it("returns error when no accounts", async () => {
			mockStorage.accounts = [];
			const result = await plugin.tool["codex-label"].execute({ index: 1, label: "Work" });
			expect(result).toContain("No Codex accounts configured");
		});

		it("returns guidance when index is omitted in non-interactive mode", async () => {
			mockStorage.accounts = [{ refreshToken: "r1", email: "user@example.com" }];
			const result = await plugin.tool["codex-label"].execute({ label: "Work" });
			expect(result).toContain("Missing account number");
			expect(result).toContain("codex-label index=2 label=\"Work\"");
		});

		it("returns error for invalid account index", async () => {
			mockStorage.accounts = [{ refreshToken: "r1", email: "user@example.com" }];
			const result = await plugin.tool["codex-label"].execute({ index: 9, label: "Work" });
			expect(result).toContain("Invalid account number");
		});

		it("sets a label on the selected account", async () => {
			mockStorage.accounts = [{ refreshToken: "r1", email: "user@example.com" }];
			const result = await plugin.tool["codex-label"].execute({ index: 1, label: "Work Laptop" });
			expect(result).toContain("Set label");
			expect(mockStorage.accounts[0]?.accountLabel).toBe("Work Laptop");
		});

		it("clears a label when blank input is provided", async () => {
			mockStorage.accounts = [
				{ refreshToken: "r1", email: "user@example.com", accountLabel: "Personal" },
			];
			const result = await plugin.tool["codex-label"].execute({ index: 1, label: "   " });
			expect(result).toContain("Cleared label");
			expect(mockStorage.accounts[0]?.accountLabel).toBeUndefined();
		});
	});

	describe("codex-tag tool", () => {
		it("sets tags for an account", async () => {
			mockStorage.accounts = [{ refreshToken: "r1", email: "user@example.com" }];
			const result = await plugin.tool["codex-tag"].execute({ index: 1, tags: "work, team-a" });
			expect(result).toContain("Updated tags");
			expect(mockStorage.accounts[0]?.accountTags).toEqual(["work", "team-a"]);
		});

		it("returns guidance when index is omitted in non-interactive mode", async () => {
			mockStorage.accounts = [{ refreshToken: "r1", email: "user@example.com" }];
			const result = await plugin.tool["codex-tag"].execute({ tags: "work" });
			expect(result).toContain("Missing account number");
			expect(result).toContain("codex-tag index=2 tags=\"work,team-a\"");
		});
	});

	describe("codex-note tool", () => {
		it("sets and clears account note", async () => {
			mockStorage.accounts = [{ refreshToken: "r1", email: "user@example.com" }];
			const setResult = await plugin.tool["codex-note"].execute({ index: 1, note: "Primary laptop" });
			expect(setResult).toContain("Saved note");
			expect(mockStorage.accounts[0]?.accountNote).toBe("Primary laptop");
			const clearResult = await plugin.tool["codex-note"].execute({ index: 1, note: " " });
			expect(clearResult).toContain("Cleared note");
			expect(mockStorage.accounts[0]?.accountNote).toBeUndefined();
		});

		it("returns guidance when index is omitted in non-interactive mode", async () => {
			mockStorage.accounts = [{ refreshToken: "r1", email: "user@example.com" }];
			const result = await plugin.tool["codex-note"].execute({ note: "Primary" });
			expect(result).toContain("Missing account number");
			expect(result).toContain("codex-note index=2 note=\"weekday primary\"");
		});
	});

	describe("codex-health tool", () => {
		it("returns error when no accounts", async () => {
			mockStorage.accounts = [];
			const result = await plugin.tool["codex-health"].execute();
			expect(result).toContain("No Codex accounts configured");
		});

		it("checks health of accounts", async () => {
			mockStorage.accounts = [
				{ refreshToken: "r1", email: "user@example.com" },
			];
			const result = await plugin.tool["codex-health"].execute();
			expect(result).toContain("Health Check");
			expect(result).toContain("Healthy");
		});
	});

	describe("codex-remove tool", () => {
		it("returns error when no accounts", async () => {
			mockStorage.accounts = [];
			const result = await plugin.tool["codex-remove"].execute({ index: 1 });
			expect(result).toContain("No Codex accounts configured");
		});

		it("returns guidance when index is omitted in non-interactive mode", async () => {
			mockStorage.accounts = [{ refreshToken: "r1", email: "user@example.com" }];
			const result = await plugin.tool["codex-remove"].execute();
			expect(result).toContain("Missing account number");
			expect(result).toContain("codex-remove index=2");
		});

		it("returns error for invalid index", async () => {
			mockStorage.accounts = [{ refreshToken: "r1" }];
			const result = await plugin.tool["codex-remove"].execute({ index: 5 });
			expect(result).toContain("Invalid account number");
		});

		it("removes valid account", async () => {
			mockStorage.accounts = [
				{ refreshToken: "r1", email: "user1@example.com" },
				{ refreshToken: "r2", email: "user2@example.com" },
			];
			const result = await plugin.tool["codex-remove"].execute({ index: 1 });
			expect(result).toContain("Removed");
			expect(mockStorage.accounts).toHaveLength(1);
		});

		it("handles removal of last account", async () => {
			mockStorage.accounts = [{ refreshToken: "r1", email: "user@example.com" }];
			const result = await plugin.tool["codex-remove"].execute({ index: 1 });
			expect(result).toContain("Removed");
			expect(result).toContain("No accounts remaining");
		});
	});

	describe("codex-refresh tool", () => {
		it("returns error when no accounts", async () => {
			mockStorage.accounts = [];
			const result = await plugin.tool["codex-refresh"].execute();
			expect(result).toContain("No Codex accounts configured");
		});

		it("refreshes accounts", async () => {
			mockStorage.accounts = [
				{ refreshToken: "r1", email: "user@example.com" },
			];
			const result = await plugin.tool["codex-refresh"].execute();
			expect(result).toContain("Refreshing");
			expect(result).toContain("Refreshed");
		});
	});

	describe("codex-export tool", () => {
		it("exports accounts to file", async () => {
			mockStorage.accounts = [{ refreshToken: "r1" }];
			const storageModule = await import("../lib/storage.js");
			const result = await plugin.tool["codex-export"].execute({
				path: "/tmp/backup.json",
			});
			expect(result).toContain("Exported");
			expect(storageModule.exportAccounts).toHaveBeenCalledWith("/tmp/backup.json", true);
		});

		it("exports to timestamped path when path is omitted", async () => {
			mockStorage.accounts = [{ refreshToken: "r1" }];
			const storageModule = await import("../lib/storage.js");
			const result = await plugin.tool["codex-export"].execute({});
			expect(result).toContain("Exported");
			expect(result).toContain("codex-backup");
			expect(storageModule.createTimestampedBackupPath).toHaveBeenCalledWith();
			expect(storageModule.exportAccounts).toHaveBeenCalledWith(
				"/tmp/codex-backup-20260101-000000.json",
				true,
			);
		});

		it("uses non-timestamped default path when timestamped=false", async () => {
			mockStorage.accounts = [{ refreshToken: "r1" }];
			const storageModule = await import("../lib/storage.js");
			const result = await plugin.tool["codex-export"].execute({ timestamped: false });
			expect(result).toContain("codex-backup.json");
			expect(storageModule.createTimestampedBackupPath).not.toHaveBeenCalled();
			expect(storageModule.exportAccounts).toHaveBeenCalledWith("codex-backup.json", true);
		});
	});

	describe("codex-import tool", () => {
		it("imports accounts from file", async () => {
			const storageModule = await import("../lib/storage.js");
			const result = await plugin.tool["codex-import"].execute({
				path: "/tmp/backup.json",
			});
			expect(result).toContain("Import complete");
			expect(result).toContain("New accounts: 2");
			expect(result).toContain(
				"Auto-backup: /tmp/codex-pre-import-backup-20260101-000000000-deadbe.json",
			);
			expect(storageModule.importAccounts).toHaveBeenCalledWith("/tmp/backup.json", {
				preImportBackupPrefix: "codex-pre-import-backup",
				backupMode: "required",
			});
		});

		it("supports dry-run preview mode", async () => {
			const storageModule = await import("../lib/storage.js");
			const result = await plugin.tool["codex-import"].execute({
				path: "/tmp/backup.json",
				dryRun: true,
			});
			expect(result).toContain("Import preview");
			expect(storageModule.previewImportAccounts).toHaveBeenCalledWith("/tmp/backup.json");
			expect(storageModule.importAccounts).not.toHaveBeenCalled();
			expect(storageModule.exportAccounts).not.toHaveBeenCalled();
			expect(storageModule.createTimestampedBackupPath).not.toHaveBeenCalled();
		});

		it("skips pre-import backup when no accounts exist yet", async () => {
			mockStorage.accounts = [];
			const storageModule = await import("../lib/storage.js");
			vi.mocked(storageModule.importAccounts).mockResolvedValueOnce({
				imported: 2,
				skipped: 1,
				total: 5,
				backupStatus: "skipped",
			});

			const result = await plugin.tool["codex-import"].execute({
				path: "/tmp/backup.json",
			});
			expect(result).toContain("Import complete");
			expect(result).toContain("Auto-backup: skipped");
			expect(storageModule.exportAccounts).not.toHaveBeenCalled();
			expect(storageModule.importAccounts).toHaveBeenCalledWith("/tmp/backup.json", {
				preImportBackupPrefix: "codex-pre-import-backup",
				backupMode: "required",
			});
		});

		it("fails import when required pre-import backup cannot be created", async () => {
			mockStorage.accounts = [{ refreshToken: "r1" }];
			const storageModule = await import("../lib/storage.js");
			vi.mocked(storageModule.importAccounts).mockRejectedValueOnce(
				new Error("Pre-import backup failed: backup locked by antivirus"),
			);

			const result = await plugin.tool["codex-import"].execute({
				path: "/tmp/backup.json",
			});

			expect(result).toContain("Import failed");
			expect(result).toContain("Pre-import backup failed");
		});

		it("delegates backup+apply sequencing to storage import to avoid race windows", async () => {
			mockStorage.accounts = [{ refreshToken: "s1" }];
			const storageModule = await import("../lib/storage.js");
			const observedSnapshots: string[] = [];
			vi.mocked(storageModule.importAccounts).mockImplementationOnce(
				async (_path, _options) => {
					observedSnapshots.push(
						mockStorage.accounts.map((account) => account.refreshToken).join(","),
					);
					mockStorage.accounts = [{ refreshToken: "s2" }];
					observedSnapshots.push(
						mockStorage.accounts.map((account) => account.refreshToken).join(","),
					);
					return {
						imported: 1,
						skipped: 0,
						total: 1,
						backupStatus: "created",
						backupPath:
							"/tmp/codex-pre-import-backup-20260101-000000000-deadbe.json",
					};
				},
			);

			const result = await plugin.tool["codex-import"].execute({
				path: "/tmp/backup.json",
			});

			expect(result).toContain("Import complete");
			expect(result).toContain(
				"Auto-backup: /tmp/codex-pre-import-backup-20260101-000000000-deadbe.json",
			);
			expect(storageModule.exportAccounts).not.toHaveBeenCalled();
			expect(storageModule.importAccounts).toHaveBeenCalledWith("/tmp/backup.json", {
				preImportBackupPrefix: "codex-pre-import-backup",
				backupMode: "required",
			});
			expect(observedSnapshots).toEqual(["s1", "s2"]);
		});
	});
});

describe("OpenAIOAuthPlugin edge cases", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockStorage.accounts = [];
		mockStorage.activeIndex = 0;
		mockStorage.activeIndexByFamily = {};
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("handles event handler errors gracefully", async () => {
		const mockClient = createMockClient();

		const { OpenAIOAuthPlugin } = await import("../index.js");
		const plugin = await OpenAIOAuthPlugin({ client: mockClient } as never) as unknown as PluginType;

		await plugin.event({ event: { type: "account.select", properties: { index: "not-a-number" } } });
	});

	it("handles storage errors in codex-switch", async () => {
		const { saveAccounts } = await import("../lib/storage.js");
		vi.mocked(saveAccounts).mockRejectedValueOnce(new Error("Write failed"));

		mockStorage.accounts = [{ refreshToken: "r1", email: "user@example.com" }];

		const mockClient = createMockClient();

		const { OpenAIOAuthPlugin } = await import("../index.js");
		const plugin = await OpenAIOAuthPlugin({ client: mockClient } as never) as unknown as PluginType;

		const result = await plugin.tool["codex-switch"].execute({ index: 1 });
		expect(result).toContain("failed to persist");
	});

	it("handles export errors", async () => {
		const { exportAccounts } = await import("../lib/storage.js");
		vi.mocked(exportAccounts).mockRejectedValueOnce(new Error("Export failed"));

		const mockClient = createMockClient();

		const { OpenAIOAuthPlugin } = await import("../index.js");
		const plugin = await OpenAIOAuthPlugin({ client: mockClient } as never) as unknown as PluginType;

		const result = await plugin.tool["codex-export"].execute({
			path: "/tmp/backup.json",
		});
		expect(result).toContain("Export failed");
	});

	it("handles import errors", async () => {
		const { importAccounts } = await import("../lib/storage.js");
		vi.mocked(importAccounts).mockRejectedValueOnce(new Error("Import failed"));

		const mockClient = createMockClient();

		const { OpenAIOAuthPlugin } = await import("../index.js");
		const plugin = await OpenAIOAuthPlugin({ client: mockClient } as never) as unknown as PluginType;

		const result = await plugin.tool["codex-import"].execute({
			path: "/tmp/backup.json",
		});
		expect(result).toContain("Import failed");
	});

	it("handles health check failures", async () => {
		const { queuedRefresh } = await import("../lib/refresh-queue.js");
		vi.mocked(queuedRefresh).mockRejectedValueOnce(new Error("Network error"));

		mockStorage.accounts = [{ refreshToken: "r1", email: "user@example.com" }];

		const mockClient = createMockClient();

		const { OpenAIOAuthPlugin } = await import("../index.js");
		const plugin = await OpenAIOAuthPlugin({ client: mockClient } as never) as unknown as PluginType;

		const result = await plugin.tool["codex-health"].execute();
		expect(result).toContain("Error");
		expect(result).toContain("0 healthy, 1 unhealthy");
	});

	it("handles refresh failures", async () => {
		const { queuedRefresh } = await import("../lib/refresh-queue.js");
		vi.mocked(queuedRefresh).mockResolvedValueOnce({
			type: "failed" as const,
			reason: "http_error",
			message: "Token expired",
		});

		mockStorage.accounts = [{ refreshToken: "r1", email: "user@example.com" }];

		const mockClient = createMockClient();

		const { OpenAIOAuthPlugin } = await import("../index.js");
		const plugin = await OpenAIOAuthPlugin({ client: mockClient } as never) as unknown as PluginType;

		const result = await plugin.tool["codex-refresh"].execute();
		expect(result).toContain("Failed");
	});

	it("handles refresh throwing errors", async () => {
		const { queuedRefresh } = await import("../lib/refresh-queue.js");
		vi.mocked(queuedRefresh).mockRejectedValueOnce(new Error("Network timeout"));

		mockStorage.accounts = [{ refreshToken: "r1", email: "user@example.com" }];

		const mockClient = createMockClient();

		const { OpenAIOAuthPlugin } = await import("../index.js");
		const plugin = await OpenAIOAuthPlugin({ client: mockClient } as never) as unknown as PluginType;

		const result = await plugin.tool["codex-refresh"].execute();
		expect(result).toContain("Error");
		expect(result).toContain("Network timeout");
	});

	it("handles storage errors in codex-remove", async () => {
		const { saveAccounts } = await import("../lib/storage.js");
		vi.mocked(saveAccounts).mockRejectedValueOnce(new Error("Write failed"));

		mockStorage.accounts = [
			{ refreshToken: "r1", email: "user1@example.com" },
			{ refreshToken: "r2", email: "user2@example.com" },
		];

		const mockClient = createMockClient();

		const { OpenAIOAuthPlugin } = await import("../index.js");
		const plugin = await OpenAIOAuthPlugin({ client: mockClient } as never) as unknown as PluginType;

		const result = await plugin.tool["codex-remove"].execute({ index: 1 });
		expect(result).toContain("failed to persist");
	});

	it("adjusts activeIndex when removing account before it", async () => {
		// When activeIndex=2 and we remove index 0 (1-based: 1), the remaining accounts
		// have length 2. Since activeIndex (2) >= length (2), it resets to 0.
		mockStorage.accounts = [
			{ refreshToken: "r1", email: "user1@example.com" },
			{ refreshToken: "r2", email: "user2@example.com" },
			{ refreshToken: "r3", email: "user3@example.com" },
		];
		mockStorage.activeIndex = 2;
		mockStorage.activeIndexByFamily = { codex: 2 };

		const mockClient = createMockClient();

		const { OpenAIOAuthPlugin } = await import("../index.js");
		const plugin = await OpenAIOAuthPlugin({ client: mockClient } as never) as unknown as PluginType;

		await plugin.tool["codex-remove"].execute({ index: 1 });
		// After removing account at 0-based index 0, length is 2.
		// activeIndex (2) >= length (2), so it resets to 0
		expect(mockStorage.activeIndex).toBe(0);
		expect(mockStorage.activeIndexByFamily.codex).toBe(0);
	});

	it("resets activeIndex when removing active account at end", async () => {
		mockStorage.accounts = [
			{ refreshToken: "r1", email: "user1@example.com" },
			{ refreshToken: "r2", email: "user2@example.com" },
		];
		mockStorage.activeIndex = 1;
		mockStorage.activeIndexByFamily = { codex: 1 };

		const mockClient = createMockClient();

		const { OpenAIOAuthPlugin } = await import("../index.js");
		const plugin = await OpenAIOAuthPlugin({ client: mockClient } as never) as unknown as PluginType;

		await plugin.tool["codex-remove"].execute({ index: 2 });
		expect(mockStorage.activeIndex).toBe(0);
	});
});

describe("OpenAIOAuthPlugin fetch handler", () => {
	let originalFetch: typeof globalThis.fetch;
	let originalThreadId: string | undefined;

	beforeEach(async () => {
		vi.resetModules();
		vi.clearAllMocks();
		const configModule = await import("../lib/config.js");
		vi.mocked(configModule.getPersistAccountFooter).mockReturnValue(false);
		vi.mocked(configModule.getPersistAccountFooterStyle).mockReturnValue(
			"label-masked-email",
		);
		vi.mocked(configModule.getRetryAllAccountsMaxRetries).mockReturnValue(3);
		vi.mocked(configModule.getRetryAllAccountsMaxWaitMs).mockReturnValue(30000);
		vi.mocked(configModule.getRetryAllAccountsRateLimited).mockReturnValue(true);
		vi.mocked(configModule.getUnsupportedCodexPolicy).mockReturnValue("fallback");
		vi.mocked(configModule.getFallbackOnUnsupportedCodexModel).mockReturnValue(true);
		vi.mocked(configModule.getFallbackToGpt52OnUnsupportedGpt53).mockReturnValue(false);
		vi.mocked(configModule.loadPluginConfig).mockReturnValue({});
		mockStorage.accounts = [
			{
				accountId: "acc-1",
				email: "user@example.com",
				refreshToken: "refresh-1",
			},
		];
		mockStorage.activeIndex = 0;
		mockStorage.activeIndexByFamily = {};
		originalThreadId = process.env.CODEX_THREAD_ID;
		delete process.env.CODEX_THREAD_ID;
		originalFetch = globalThis.fetch;
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
		if (originalThreadId === undefined) {
			delete process.env.CODEX_THREAD_ID;
		} else {
			process.env.CODEX_THREAD_ID = originalThreadId;
		}
		vi.restoreAllMocks();
	});

	const setupPlugin = async () => {
		const mockClient = createMockClient();
		const { OpenAIOAuthPlugin } = await import("../index.js");
		const plugin = await OpenAIOAuthPlugin({ client: mockClient } as never) as unknown as PluginType;

		const getAuth = async () => ({
			type: "oauth" as const,
			access: "access-token",
			refresh: "refresh-token",
			expires: Date.now() + 60_000,
			multiAccount: true,
		});

		const sdk = await plugin.auth.loader(getAuth, { options: {}, models: {} });
		return { plugin, sdk, mockClient };
	};

	const createPersistedAccountRequestBody = (
		promptCacheKey?: string,
		model = "gpt-5.1",
	) =>
		promptCacheKey
			? { model, prompt_cache_key: promptCacheKey }
			: { model };

	const enablePersistedFooter = async (
		style: "label-masked-email" | "full-email" | "label-only",
	) => {
		const configModule = await import("../lib/config.js");
		vi.mocked(configModule.getPersistAccountFooter).mockReturnValue(true);
		vi.mocked(configModule.getPersistAccountFooterStyle).mockReturnValue(style);
	};

	const disablePersistedFooter = async () => {
		const configModule = await import("../lib/config.js");
		vi.mocked(configModule.getPersistAccountFooter).mockReturnValue(false);
	};

	const sendPersistedAccountRequest = async (
		sdk: Awaited<ReturnType<typeof setupPlugin>>["sdk"],
		promptCacheKey?: string,
		model = "gpt-5.1",
	) => {
		const fetchHelpers = await import("../lib/request/fetch-helpers.js");
		const requestBody = createPersistedAccountRequestBody(promptCacheKey, model);
		vi.mocked(fetchHelpers.transformRequestForCodex).mockResolvedValueOnce({
			updatedInit: {
				method: "POST",
				body: JSON.stringify(requestBody),
			},
			body: requestBody,
		});

		globalThis.fetch = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ content: "ok" }), { status: 200 }),
		);

		return await sdk.fetch!("https://api.openai.com/v1/chat", {
			method: "POST",
			body: JSON.stringify(requestBody),
		});
	};

	const expectedMaskedIndicator = "us***@***.com [1/1]";
	const expectedFullIndicator = "user@example.com [1/1]";
	const expectedLabelOnlyIndicator = "Account 1 [id:ount-1] [1/1]";

	const buildMessageTransformOutput = (
		sessionID: string,
		modelID = "gpt-5.1",
	): Parameters<PluginType["experimental.chat.messages.transform"]>[1] => ({
		messages: [
			{
				info: {
					role: "user",
					sessionID,
					model: { providerID: "openai", modelID },
				},
				parts: [],
			},
		],
	});

	const readPersistedAccountIndicator = async (
		plugin: PluginType,
		sessionID: string,
		modelID = "gpt-5.1",
	) => {
		const output = buildMessageTransformOutput(sessionID, modelID);
		await plugin["experimental.chat.messages.transform"]({}, output);
		return {
			variant:
				output.messages[0]?.info.model?.variant ??
				output.messages[0]?.info.variant,
			thinking: output.messages[0]?.info.thinking,
		};
	};

	it("returns success response for successful fetch", async () => {
		globalThis.fetch = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ content: "test" }), { status: 200 }),
		);

		const { sdk } = await setupPlugin();
		const response = await sdk.fetch!("https://api.openai.com/v1/chat", {
			method: "POST",
			body: JSON.stringify({ model: "gpt-5.1" }),
		});

		expect(response.status).toBe(200);
	});

	it("decorates the last user message with a masked-email indicator after the first successful response", async () => {
		await enablePersistedFooter("label-masked-email");
		const { plugin, sdk } = await setupPlugin();

		await sendPersistedAccountRequest(sdk, "session-masked");

		expect((await readPersistedAccountIndicator(plugin, "session-masked")).variant).toBe(
			expectedMaskedIndicator,
		);
	});

	it("decorates the last user message with a full-email indicator when configured", async () => {
		await enablePersistedFooter("full-email");
		const { plugin, sdk } = await setupPlugin();

		await sendPersistedAccountRequest(sdk, "session-full");

		expect((await readPersistedAccountIndicator(plugin, "session-full")).variant).toBe(
			expectedFullIndicator,
		);
	});

	it("does not reload account storage on the successful footer hot path", async () => {
		await enablePersistedFooter("full-email");
		mockStorage.accounts = [
			{ accountId: "acc-1", email: "user@example.com", refreshToken: "refresh-token" },
			{ accountId: "acc-2", email: "user2@example.com", refreshToken: "refresh-2" },
		];
		const storageModule = await import("../lib/storage.js");
		const { sdk } = await setupPlugin();

		await sendPersistedAccountRequest(sdk, "session-warmup");
		vi.mocked(storageModule.loadAccounts).mockClear();

		await sendPersistedAccountRequest(sdk, "session-no-read");

		expect(storageModule.loadAccounts).not.toHaveBeenCalled();
	});

	it("does not add storage reads during loader init when footer counts are enabled", async () => {
		const storageModule = await import("../lib/storage.js");
		const getAuth = async () => ({
			type: "oauth" as const,
			access: "access-token",
			refresh: "refresh-token",
			expires: Date.now() + 60_000,
			multiAccount: true,
		});
		const runLoaderAndCountStorageReads = async (): Promise<number> => {
			const mockClient = createMockClient();
			const { OpenAIOAuthPlugin } = await import("../index.js");
			const plugin = await OpenAIOAuthPlugin({ client: mockClient } as never) as unknown as PluginType;
			vi.mocked(storageModule.loadAccounts).mockClear();
			await plugin.auth.loader(getAuth, { options: {}, models: {} });
			return vi.mocked(storageModule.loadAccounts).mock.calls.length;
		};

		await disablePersistedFooter();
		const baselineReadCount = await runLoaderAndCountStorageReads();

		await enablePersistedFooter("full-email");
		const footerReadCount = await runLoaderAndCountStorageReads();

		expect(footerReadCount).toBe(baselineReadCount);
	});

	it("uses the live account count when the cached footer hint is stale", async () => {
		await enablePersistedFooter("full-email");
		mockStorage.accounts = [
			{ accountId: "acc-1", email: "user@example.com", refreshToken: "refresh-token" },
			{ accountId: "acc-2", email: "user2@example.com", refreshToken: "refresh-2" },
		];
		const accountsModule = await import("../lib/accounts.js");
		const manager = await accountsModule.AccountManager.loadFromDisk() as unknown as {
			accounts: Array<{
				index: number;
				accountId: string;
				email: string;
				refreshToken: string;
			}>;
		};
		manager.accounts = [
			{ index: 0, accountId: "acc-1", email: "user@example.com", refreshToken: "refresh-token" },
			{ index: 1, accountId: "acc-2", email: "user2@example.com", refreshToken: "refresh-2" },
		];
		vi.spyOn(accountsModule.AccountManager, "loadFromDisk").mockResolvedValue(manager as never);
		const { plugin, sdk } = await setupPlugin();

		await sendPersistedAccountRequest(sdk, "session-live-count");
		manager.accounts = [
			{ index: 0, accountId: "acc-1", email: "user@example.com", refreshToken: "refresh-token" },
		];

		await sendPersistedAccountRequest(sdk, "session-live-count");

		expect((await readPersistedAccountIndicator(plugin, "session-live-count")).variant).toBe(
			expectedFullIndicator,
		);
	});

	it("falls back to the persisted account count hint when the live count transiently drops to zero", async () => {
		await enablePersistedFooter("full-email");
		mockStorage.accounts = [
			{ accountId: "acc-1", email: "user@example.com", refreshToken: "refresh-token" },
			{ accountId: "acc-2", email: "user2@example.com", refreshToken: "refresh-2" },
		];
		const accountsModule = await import("../lib/accounts.js");
		const manager = await accountsModule.AccountManager.loadFromDisk() as unknown as {
			accounts: Array<{
				index: number;
				accountId: string;
				email: string;
				refreshToken: string;
			}>;
			getAccountCount: () => number;
		};
		manager.accounts = [
			{ index: 0, accountId: "acc-1", email: "user@example.com", refreshToken: "refresh-token" },
			{ index: 1, accountId: "acc-2", email: "user2@example.com", refreshToken: "refresh-2" },
		];
		vi.spyOn(accountsModule.AccountManager, "loadFromDisk").mockResolvedValue(manager as never);
		const { plugin, sdk } = await setupPlugin();
		vi.spyOn(manager, "getAccountCount")
			.mockImplementationOnce(() => 2)
			.mockImplementation(() => 0);

		await sendPersistedAccountRequest(sdk, "session-count-hint");

		expect((await readPersistedAccountIndicator(plugin, "session-count-hint")).variant).toBe(
			"user@example.com [1/2]",
		);
	});

	it("keeps the manual-switch account count hint available for a later zero-count fetch", async () => {
		await enablePersistedFooter("full-email");
		mockStorage.accounts = [
			{ accountId: "acc-1", email: "user@example.com", refreshToken: "refresh-token" },
			{ accountId: "acc-2", email: "user2@example.com", refreshToken: "refresh-2" },
		];
		const accountsModule = await import("../lib/accounts.js");
		const manager = await accountsModule.AccountManager.loadFromDisk() as unknown as {
			accounts: Array<{
				index: number;
				accountId: string;
				email: string;
				refreshToken: string;
			}>;
			getAccountCount: () => number;
		};
		manager.accounts = [
			{ index: 0, accountId: "acc-1", email: "user@example.com", refreshToken: "refresh-token" },
			{ index: 1, accountId: "acc-2", email: "user2@example.com", refreshToken: "refresh-2" },
		];
		vi.spyOn(accountsModule.AccountManager, "loadFromDisk").mockResolvedValue(manager as never);
		const { plugin, sdk } = await setupPlugin();
		vi.spyOn(manager, "getAccountCount").mockImplementation(() => 0);

		await plugin.event({
			event: { type: "account.select", properties: { index: 1 } },
		});
		await sendPersistedAccountRequest(sdk, "session-count-hint-after-switch");

		expect(
			(await readPersistedAccountIndicator(plugin, "session-count-hint-after-switch")).variant,
		).toBe("user@example.com [1/2]");
	});

	it("decorates the last user message with a label-only indicator when configured", async () => {
		await enablePersistedFooter("label-only");
		const { plugin, sdk } = await setupPlugin();

		await sendPersistedAccountRequest(sdk, "session-label");

		expect((await readPersistedAccountIndicator(plugin, "session-label")).variant).toBe(
			expectedLabelOnlyIndicator,
		);
	});

	it("keeps the label-only indicator stable across manual account switches", async () => {
		await enablePersistedFooter("label-only");
		mockStorage.accounts = [
			{ accountId: "acc-1", email: "user@example.com", refreshToken: "refresh-token" },
			{ accountId: "acc-2", email: "user2@example.com", refreshToken: "refresh-2" },
		];
		const accountsModule = await import("../lib/accounts.js");
		vi.mocked(accountsModule.extractAccountId).mockImplementation((token) => {
			if (token === "token-2") return "account-2";
			if (token) return "account-1";
			return undefined;
		});
		type TestManagedAccount = {
			index: number;
			accountId: string;
			email: string;
			refreshToken: string;
			accessToken?: string;
		};
		const previousManager = await accountsModule.AccountManager.loadFromDisk() as unknown as {
			accounts: TestManagedAccount[];
		};
		const reloadedManager = await accountsModule.AccountManager.loadFromDisk() as typeof previousManager;
		previousManager.accounts = [
			{
				index: 0,
				accountId: "account-1",
				email: "user@example.com",
				refreshToken: "refresh-token",
				accessToken: "token-1",
			},
			{
				index: 1,
				accountId: "account-2",
				email: "user2@example.com",
				refreshToken: "refresh-2",
				accessToken: "token-2",
			},
		];
		reloadedManager.accounts = [
			{ index: 0, accountId: "acc-1", email: "user@example.com", refreshToken: "refresh-token" },
			{ index: 1, accountId: "acc-2", email: "user2@example.com", refreshToken: "refresh-2" },
		];
		vi.spyOn(accountsModule.AccountManager, "loadFromDisk")
			.mockResolvedValueOnce(previousManager as never)
			.mockResolvedValueOnce(reloadedManager as never);

		const { plugin, sdk } = await setupPlugin();
		await sendPersistedAccountRequest(sdk, "session-label-switch");

		await plugin.event({
			event: { type: "account.select", properties: { index: 1 } },
		});

		expect((await readPersistedAccountIndicator(plugin, "session-label-switch")).variant).toBe(
			"Account 2 [id:ount-2] [2/2]",
		);
	});

	it("skips persisted indicators when the request has no session key", async () => {
		await enablePersistedFooter("label-masked-email");
		const { plugin, sdk } = await setupPlugin();
		await plugin["chat.message"](
			{
				sessionID: "session-no-key",
				model: { providerID: "openai", modelID: "gpt-5.1" },
			},
			{ message: {}, parts: [] },
		);

		await sendPersistedAccountRequest(sdk);

		expect((await readPersistedAccountIndicator(plugin, "session-no-key")).variant).toBeUndefined();
	});

	it("decorates live user chat.message output with the visible account indicator without leaking to thinking", async () => {
		await enablePersistedFooter("full-email");
		const { plugin, sdk } = await setupPlugin();
		await sendPersistedAccountRequest(sdk, "session-chat-message", "gpt-5.4");

		const output = {
			message: {
				role: "user",
				model: { providerID: "openai", modelID: "gpt-5.4" },
			},
			parts: [],
		};
		await plugin["chat.message"](
			{
				sessionID: "session-chat-message",
				model: { providerID: "openai", modelID: "gpt-5.4" },
			},
			output,
		);

		expect((output.message as { variant?: string }).variant).toBe(expectedFullIndicator);
		expect((output.message as { thinking?: string }).thinking).toBeUndefined();
		expect((output.message as { model?: { modelID?: string } }).model?.modelID).toBe("gpt-5.4");
		expect((output.message as { model?: { variant?: string } }).model?.variant).toBe(
			expectedFullIndicator,
		);
		expect((await readPersistedAccountIndicator(plugin, "session-chat-message")).thinking).toBeUndefined();
	});

	it("uses CODEX_THREAD_ID as the footer session key when it differs from prompt_cache_key", async () => {
		await enablePersistedFooter("full-email");
		process.env.CODEX_THREAD_ID = "env-session";
		const { plugin, sdk } = await setupPlugin();

		await sendPersistedAccountRequest(sdk, "session-explicit");

		expect((await readPersistedAccountIndicator(plugin, "env-session")).variant).toBe(
			expectedFullIndicator,
		);
	});

	it("falls back to CODEX_THREAD_ID in the transform hook when the message session is missing", async () => {
		await enablePersistedFooter("full-email");
		process.env.CODEX_THREAD_ID = "env-fallback";
		const { plugin, sdk } = await setupPlugin();

		await sendPersistedAccountRequest(sdk);

		const output: Parameters<PluginType["experimental.chat.messages.transform"]>[1] = {
			messages: [
				{
					info: {
						role: "user",
						model: { providerID: "openai", modelID: "gpt-5.1" },
					},
					parts: [],
				},
			],
		};
		await plugin["experimental.chat.messages.transform"]({}, output);

		expect(
			output.messages[0]?.info.model?.variant ?? output.messages[0]?.info.variant,
		).toBe(expectedFullIndicator);
	});

	it("ignores transform outputs when there are no messages", async () => {
		await enablePersistedFooter("full-email");
		const { plugin } = await setupPlugin();

		const output: Parameters<PluginType["experimental.chat.messages.transform"]>[1] = {
			messages: [],
		};

		await expect(
			plugin["experimental.chat.messages.transform"]({}, output),
		).resolves.toBeUndefined();
		expect(output.messages).toEqual([]);
	});

	it("ignores transform outputs when no user message is present", async () => {
		await enablePersistedFooter("full-email");
		const { plugin, sdk } = await setupPlugin();

		await sendPersistedAccountRequest(sdk, "session-assistant-only");

		const output: Parameters<PluginType["experimental.chat.messages.transform"]>[1] = {
			messages: [
				{
					info: {
						role: "assistant",
						sessionID: "session-assistant-only",
						model: { providerID: "openai", modelID: "gpt-5.1" },
					},
					parts: [],
				},
			],
		};

		await expect(
			plugin["experimental.chat.messages.transform"]({}, output),
		).resolves.toBeUndefined();
		expect(output.messages[0]?.info.variant).toBeUndefined();
		expect(output.messages[0]?.info.model?.variant).toBeUndefined();
	});

	it("prefers CODEX_THREAD_ID over a non-empty transform session id when looking up the footer", async () => {
		await enablePersistedFooter("full-email");
		process.env.CODEX_THREAD_ID = "env-transform-priority";
		const { plugin, sdk } = await setupPlugin();

		await sendPersistedAccountRequest(sdk, "session-explicit");

		const output: Parameters<PluginType["experimental.chat.messages.transform"]>[1] = {
			messages: [
				{
					info: {
						role: "user",
						sessionID: "session-different",
						model: { providerID: "openai", modelID: "gpt-5.1" },
					},
					parts: [],
				},
			],
		};
		await plugin["experimental.chat.messages.transform"]({}, output);

		expect(
			output.messages[0]?.info.model?.variant ?? output.messages[0]?.info.variant,
		).toBe(expectedFullIndicator);
	});

	it("falls back to CODEX_THREAD_ID in chat.message when the session id is empty", async () => {
		await enablePersistedFooter("full-email");
		process.env.CODEX_THREAD_ID = "env-chat-message";
		const { plugin, sdk } = await setupPlugin();

		await sendPersistedAccountRequest(sdk);

		const output = {
			message: {
				role: "user",
				model: { providerID: "openai", modelID: "gpt-5.4" },
			},
			parts: [],
		};
		await plugin["chat.message"](
			{
				sessionID: "",
				model: { providerID: "openai", modelID: "gpt-5.4" },
			},
			output,
		);

		expect((output.message as { variant?: string }).variant).toBe(expectedFullIndicator);
		expect((output.message as { model?: { variant?: string } }).model?.variant).toBe(
			expectedFullIndicator,
		);
	});

	it("prefers CODEX_THREAD_ID over a non-empty chat.message session id when looking up the footer", async () => {
		await enablePersistedFooter("full-email");
		process.env.CODEX_THREAD_ID = "env-chat-priority";
		const { plugin, sdk } = await setupPlugin();

		await sendPersistedAccountRequest(sdk, "session-explicit");

		const output = {
			message: {
				role: "user",
				model: { providerID: "openai", modelID: "gpt-5.4" },
			},
			parts: [],
		};
		await plugin["chat.message"](
			{
				sessionID: "session-different",
				model: { providerID: "openai", modelID: "gpt-5.4" },
			},
			output,
		);

		expect((output.message as { variant?: string }).variant).toBe(expectedFullIndicator);
		expect((output.message as { model?: { variant?: string } }).model?.variant).toBe(
			expectedFullIndicator,
		);
	});

	it("does not apply a persisted footer when prompt_cache_key and hook session ids differ without CODEX_THREAD_ID", async () => {
		await enablePersistedFooter("full-email");
		const { plugin, sdk } = await setupPlugin();

		await sendPersistedAccountRequest(sdk, "session-request-only");

		const transformOutput = buildMessageTransformOutput("session-hook-only");
		await plugin["experimental.chat.messages.transform"]({}, transformOutput);
		expect(transformOutput.messages[0]?.info.variant).toBeUndefined();
		expect(transformOutput.messages[0]?.info.model?.variant).toBeUndefined();

		const liveOutput = {
			message: {
				role: "user",
				model: { providerID: "openai", modelID: "gpt-5.4" },
			},
			parts: [],
		};
		await plugin["chat.message"](
			{
				sessionID: "session-hook-only",
				model: { providerID: "openai", modelID: "gpt-5.4" },
			},
			liveOutput,
		);

		expect((liveOutput.message as { variant?: string }).variant).toBeUndefined();
		expect(
			(liveOutput.message as { model?: { variant?: string } }).model?.variant,
		).toBeUndefined();
	});

	it("does not set the chat.message indicator when role is missing", async () => {
		await enablePersistedFooter("full-email");
		const { plugin, sdk } = await setupPlugin();

		await sendPersistedAccountRequest(sdk, "session-chat-message-missing-role");

		const output = {
			message: {},
			parts: [],
		};

		await expect(
			plugin["chat.message"](
				{
					sessionID: "session-chat-message-missing-role",
					model: { providerID: "openai", modelID: "gpt-5.4" },
				},
				output,
			),
		).resolves.toBeUndefined();

		expect((output.message as { variant?: string }).variant).toBeUndefined();
		expect(
			(output.message as { model?: { variant?: string } }).model?.variant,
		).toBeUndefined();
	});

	it("uses input.model as the fallback chat.message model when model info is absent", async () => {
		await enablePersistedFooter("full-email");
		const { plugin, sdk } = await setupPlugin();

		await sendPersistedAccountRequest(sdk, "session-chat-message-no-model");

		const output = {
			message: { role: "user" },
			parts: [],
		};

		await expect(
			plugin["chat.message"](
				{
					sessionID: "session-chat-message-no-model",
					model: { providerID: "openai", modelID: "gpt-5.4" },
				},
				output,
			),
		).resolves.toBeUndefined();

		expect((output.message as { variant?: string }).variant).toBe(expectedFullIndicator);
		expect(
			(output.message as { model?: { providerID?: string } }).model?.providerID,
		).toBe("openai");
		expect(
			(output.message as { model?: { modelID?: string } }).model?.modelID,
		).toBe("gpt-5.4");
		expect((output.message as { model?: { variant?: string } }).model?.variant).toBe(
			expectedFullIndicator,
		);
	});

	it("does not set the chat.message indicator on assistant messages", async () => {
		await enablePersistedFooter("full-email");
		const { plugin, sdk } = await setupPlugin();

		await sendPersistedAccountRequest(sdk, "session-chat-message-assistant");

		const output = {
			message: {
				role: "assistant",
				model: { providerID: "openai", modelID: "gpt-5.4" },
			},
			parts: [],
		};

		await expect(
			plugin["chat.message"](
				{
					sessionID: "session-chat-message-assistant",
					model: { providerID: "openai", modelID: "gpt-5.4" },
				},
				output,
			),
		).resolves.toBeUndefined();

		expect((output.message as { variant?: string }).variant).toBeUndefined();
		expect(
			(output.message as { model?: { variant?: string } }).model?.variant,
		).toBeUndefined();
	});

	it("fills model.variant in the transform hook even when the stored message has no model info", async () => {
		await enablePersistedFooter("full-email");
		process.env.CODEX_THREAD_ID = "env-model-less";
		const { plugin, sdk } = await setupPlugin();

		await sendPersistedAccountRequest(sdk);

		const output: Parameters<PluginType["experimental.chat.messages.transform"]>[1] = {
			messages: [
				{
					info: {
						role: "user",
					},
					parts: [],
				},
			],
		};
		await plugin["experimental.chat.messages.transform"]({}, output);

		expect(output.messages[0]?.info.variant).toBe(expectedFullIndicator);
		expect(
			(output.messages[0]?.info.model as { variant?: string } | undefined)?.variant,
		).toBe(expectedFullIndicator);
	});

	it("preserves partial model info in the transform hook while still setting model.variant", async () => {
		await enablePersistedFooter("full-email");
		const { plugin, sdk } = await setupPlugin();
		await sendPersistedAccountRequest(sdk, "session-partial-model");

		const output: Parameters<PluginType["experimental.chat.messages.transform"]>[1] = {
			messages: [
				{
					info: {
						role: "user",
						sessionID: "session-partial-model",
						model: { providerID: "openai" },
					},
					parts: [],
				},
			],
		};
		await plugin["experimental.chat.messages.transform"]({}, output);

		expect(output.messages[0]?.info.variant).toBe(expectedFullIndicator);
		expect(output.messages[0]?.info.model?.providerID).toBe("openai");
		expect(output.messages[0]?.info.model?.modelID).toBeUndefined();
		expect(output.messages[0]?.info.model?.variant).toBe(expectedFullIndicator);
	});

	it("stops applying persisted indicators after the footer is disabled", async () => {
		await enablePersistedFooter("full-email");
		const { plugin, sdk } = await setupPlugin();
		await sendPersistedAccountRequest(sdk, "session-footer-toggle");

		expect((await readPersistedAccountIndicator(plugin, "session-footer-toggle")).variant).toBe(
			expectedFullIndicator,
		);

		await disablePersistedFooter();
		await sendPersistedAccountRequest(sdk, "session-footer-toggle");

		const liveOutput = {
			message: {
				role: "user",
				model: { providerID: "openai", modelID: "gpt-5.4" },
			},
			parts: [],
		};
		await plugin["chat.message"](
			{
				sessionID: "session-footer-toggle",
				model: { providerID: "openai", modelID: "gpt-5.4" },
			},
			liveOutput,
		);

		expect((await readPersistedAccountIndicator(plugin, "session-footer-toggle")).variant).toBeUndefined();
		expect((liveOutput.message as { variant?: string }).variant).toBeUndefined();
		expect(
			(liveOutput.message as { model?: { variant?: string } }).model?.variant,
		).toBeUndefined();
	});

	it("clears the persisted account count hint when the footer is disabled", async () => {
		await enablePersistedFooter("full-email");
		mockStorage.accounts = [
			{ accountId: "acc-1", email: "user@example.com", refreshToken: "refresh-token" },
			{ accountId: "acc-2", email: "user2@example.com", refreshToken: "refresh-2" },
		];
		const accountsModule = await import("../lib/accounts.js");
		const manager = await accountsModule.AccountManager.loadFromDisk() as unknown as {
			accounts: Array<{
				index: number;
				accountId: string;
				email: string;
				refreshToken: string;
			}>;
			getAccountCount: () => number;
		};
		manager.accounts = [
			{ index: 0, accountId: "acc-1", email: "user@example.com", refreshToken: "refresh-token" },
			{ index: 1, accountId: "acc-2", email: "user2@example.com", refreshToken: "refresh-2" },
		];
		vi.spyOn(accountsModule.AccountManager, "loadFromDisk").mockResolvedValue(manager as never);
		const { plugin, sdk } = await setupPlugin();
		vi.spyOn(manager, "getAccountCount")
			.mockImplementationOnce(() => 2)
			.mockImplementation(() => 0);

		await sendPersistedAccountRequest(sdk, "session-count-hint-prime");
		expect((await readPersistedAccountIndicator(plugin, "session-count-hint-prime")).variant).toBe(
			"user@example.com [1/2]",
		);

		await disablePersistedFooter();
		await sendPersistedAccountRequest(sdk, "session-count-hint-disabled");

		await enablePersistedFooter("full-email");
		await sendPersistedAccountRequest(sdk, "session-count-hint-reset");

		expect((await readPersistedAccountIndicator(plugin, "session-count-hint-reset")).variant).toBe(
			expectedFullIndicator,
		);
	});

	it("suppresses account-switch info toasts when the footer is enabled and refreshes the visible indicator", async () => {
		await enablePersistedFooter("full-email");
		mockStorage.accounts = [
			{ accountId: "acc-1", email: "user@example.com", refreshToken: "refresh-token" },
			{ accountId: "acc-2", email: "user2@example.com", refreshToken: "refresh-2" },
		];
		const accountsModule = await import("../lib/accounts.js");
		const manager = await accountsModule.AccountManager.loadFromDisk() as unknown as {
			accounts: Array<{
				index: number;
				accountId: string;
				email: string;
				refreshToken: string;
			}>;
		};
		manager.accounts = [
			{ index: 0, accountId: "acc-1", email: "user@example.com", refreshToken: "refresh-token" },
			{ index: 1, accountId: "acc-2", email: "user2@example.com", refreshToken: "refresh-2" },
		];
		vi.spyOn(accountsModule.AccountManager, "loadFromDisk").mockResolvedValue(manager as never);
		const configModule = await import("../lib/config.js");

		const { plugin, sdk, mockClient } = await setupPlugin();
		await sendPersistedAccountRequest(sdk, "session-switch");
		const configReadCountBeforeSwitch =
			vi.mocked(configModule.loadPluginConfig).mock.calls.length;
		mockClient.tui.showToast.mockClear();

		expect((await readPersistedAccountIndicator(plugin, "session-switch")).variant).toBe(
			"user@example.com [1/2]",
		);

		await plugin.event({
			event: { type: "account.select", properties: { index: 1 } },
		});

		expect(mockClient.tui.showToast).not.toHaveBeenCalledWith({
			body: {
				message: "Switched to account 2",
				variant: "info",
			},
		});
		expect(vi.mocked(configModule.loadPluginConfig)).toHaveBeenCalledTimes(
			configReadCountBeforeSwitch,
		);
		expect((await readPersistedAccountIndicator(plugin, "session-switch")).variant).toBe(
			"user2@example.com [2/2]",
		);
	});

	it("syncs account-switch footer behavior after a fetch refresh enables it", async () => {
		await disablePersistedFooter();
		mockStorage.accounts = [
			{ accountId: "acc-1", email: "user@example.com", refreshToken: "refresh-token" },
			{ accountId: "acc-2", email: "user2@example.com", refreshToken: "refresh-2" },
		];

		const { plugin, sdk, mockClient } = await setupPlugin();

		await enablePersistedFooter("full-email");
		await sendPersistedAccountRequest(sdk, "session-switch-sync");
		mockClient.tui.showToast.mockClear();

		await plugin.event({
			event: { type: "account.select", properties: { index: 1 } },
		});

		expect(mockClient.tui.showToast).not.toHaveBeenCalledWith({
			body: {
				message: "Switched to account 2",
				variant: "info",
			},
		});
		expect(
			(await readPersistedAccountIndicator(plugin, "session-switch-sync")).variant,
		).toBe("user2@example.com [2/2]");
	});

	it("does not show the switch toast before the first footer session exists", async () => {
		await enablePersistedFooter("full-email");
		mockStorage.accounts = [
			{ accountId: "acc-1", email: "user@example.com", refreshToken: "refresh-token" },
			{ accountId: "acc-2", email: "user2@example.com", refreshToken: "refresh-2" },
		];

		const { plugin, mockClient } = await setupPlugin();
		mockClient.tui.showToast.mockClear();

		await plugin.event({
			event: { type: "account.select", properties: { index: 1 } },
		});

		expect(mockClient.tui.showToast).not.toHaveBeenCalledWith({
			body: {
				message: "Switched to account 2",
				variant: "info",
			},
		});
	});

	it("does not let UI-only config refreshes reset the loader-synced footer state", async () => {
		await enablePersistedFooter("full-email");
		mockStorage.accounts = [
			{ accountId: "acc-1", email: "user@example.com", refreshToken: "refresh-token" },
			{ accountId: "acc-2", email: "user2@example.com", refreshToken: "refresh-2" },
		];
		const configModule = await import("../lib/config.js");
		const { plugin, sdk, mockClient } = await setupPlugin();

		await sendPersistedAccountRequest(sdk, "session-ui-refresh");
		mockClient.tui.showToast.mockClear();

		vi.mocked(configModule.getPersistAccountFooter).mockReturnValue(false);
		await plugin.tool["codex-list"].execute();
		await enablePersistedFooter("full-email");

		await plugin.event({
			event: { type: "account.select", properties: { index: 1 } },
		});

		expect(mockClient.tui.showToast).not.toHaveBeenCalledWith({
			body: {
				message: "Switched to account 2",
				variant: "info",
			},
		});
		expect((await readPersistedAccountIndicator(plugin, "session-ui-refresh")).variant).toBe(
			"user2@example.com [2/2]",
		);
	});

	it("reuses the loader-synced config for UI-only tool renders", async () => {
		const configModule = await import("../lib/config.js");
		const { plugin } = await setupPlugin();

		vi.mocked(configModule.loadPluginConfig).mockClear();
		vi.mocked(configModule.loadPluginConfig).mockImplementation(() => {
			throw new Error("config locked");
		});

		await expect(plugin.tool["codex-list"].execute()).resolves.toContain("Codex Accounts");
		expect(configModule.loadPluginConfig).not.toHaveBeenCalled();
	});

	it("does not let authorize flows reset the loader-synced footer state", async () => {
		mockStorage.accounts = [
			{ accountId: "acc-1", email: "user@example.com", refreshToken: "refresh-token" },
			{ accountId: "acc-2", email: "user2@example.com", refreshToken: "refresh-2" },
		];
		const configModule = await import("../lib/config.js");
		const healthyConfig = { source: "healthy-config" };
		vi.mocked(configModule.loadPluginConfig).mockReturnValue(healthyConfig);
		vi.mocked(configModule.getPersistAccountFooter).mockImplementation(
			(config) => config === healthyConfig,
		);
		vi.mocked(configModule.getPersistAccountFooterStyle).mockReturnValue("full-email");
		const { plugin, sdk, mockClient } = await setupPlugin();
		const autoMethod = plugin.auth.methods[0] as unknown as {
			authorize: (inputs?: Record<string, string>) => Promise<{ instructions: string }>;
		};
		const manualMethod = plugin.auth.methods[1] as unknown as {
			authorize: () => Promise<{ instructions: string }>;
		};

		await sendPersistedAccountRequest(sdk, "session-authorize-refresh");
		mockClient.tui.showToast.mockClear();

		vi.mocked(configModule.loadPluginConfig).mockReturnValue(configModule.DEFAULT_CONFIG);
		await autoMethod.authorize({ loginMode: "add", accountCount: "1" });
		await manualMethod.authorize();
		mockClient.tui.showToast.mockClear();

		await plugin.event({
			event: { type: "account.select", properties: { index: 1 } },
		});

		expect(mockClient.tui.showToast).not.toHaveBeenCalledWith({
			body: {
				message: "Switched to account 2",
				variant: "info",
			},
		});
	});

	it("uses the latest perProjectAccounts setting when authorize writes storage", async () => {
		const configModule = await import("../lib/config.js");
		const storageModule = await import("../lib/storage.js");
		const loaderConfig = { source: "loader-config" };
		const authorizeConfig = { source: "authorize-config" };

		vi.mocked(configModule.loadPluginConfig).mockReturnValue(loaderConfig);
		vi.mocked(configModule.getPerProjectAccounts).mockImplementation(
			(config) => config === authorizeConfig,
		);

		const { plugin } = await setupPlugin();
		const autoMethod = plugin.auth.methods[0] as unknown as {
			authorize: (inputs?: Record<string, string>) => Promise<unknown>;
		};
		const manualMethod = plugin.auth.methods[1] as unknown as {
			authorize: () => Promise<unknown>;
		};

		vi.mocked(storageModule.setStoragePath).mockClear();
		vi.mocked(configModule.loadPluginConfig).mockReturnValue(authorizeConfig);

		await autoMethod.authorize({ loginMode: "add", accountCount: "1" });
		expect(storageModule.setStoragePath).toHaveBeenCalledWith(process.cwd());

		vi.mocked(storageModule.setStoragePath).mockClear();
		await manualMethod.authorize();
		expect(storageModule.setStoragePath).toHaveBeenCalledWith(process.cwd());
	});

	it("falls back to the cached authorize storage config when the fresh refresh throws", async () => {
		const configModule = await import("../lib/config.js");
		const storageModule = await import("../lib/storage.js");
		const loggerModule = await import("../lib/logger.js");
		const loaderConfig = { source: "loader-config" };

		vi.mocked(configModule.loadPluginConfig).mockReturnValue(loaderConfig);
		vi.mocked(configModule.getPerProjectAccounts).mockImplementation(
			(config) => config === loaderConfig,
		);

		const { plugin } = await setupPlugin();
		const autoMethod = plugin.auth.methods[0] as unknown as {
			authorize: (inputs?: Record<string, string>) => Promise<unknown>;
		};
		const manualMethod = plugin.auth.methods[1] as unknown as {
			authorize: () => Promise<unknown>;
		};

		vi.mocked(storageModule.setStoragePath).mockClear();
		vi.mocked(loggerModule.logWarn).mockClear();
		vi.mocked(configModule.loadPluginConfig).mockImplementation(() => {
			throw new Error("config locked");
		});

		await expect(autoMethod.authorize({ loginMode: "add", accountCount: "1" })).resolves.toBeDefined();
		expect(storageModule.setStoragePath).toHaveBeenCalledWith(process.cwd());
		expect(loggerModule.logWarn).toHaveBeenCalledWith(
			expect.stringContaining("Falling back to cached authorize storage config"),
		);

		vi.mocked(storageModule.setStoragePath).mockClear();
		await expect(manualMethod.authorize()).resolves.toBeDefined();
		expect(storageModule.setStoragePath).toHaveBeenCalledWith(process.cwd());
	});

	it("falls back to the cached authorize storage config when the fresh refresh returns DEFAULT_CONFIG", async () => {
		const configModule = await import("../lib/config.js");
		const storageModule = await import("../lib/storage.js");
		const loggerModule = await import("../lib/logger.js");
		const loaderConfig = { source: "loader-config" };

		vi.mocked(configModule.loadPluginConfig).mockReturnValue(loaderConfig);
		vi.mocked(configModule.getPerProjectAccounts).mockImplementation(
			(config) => config === loaderConfig,
		);

		const { plugin } = await setupPlugin();
		const autoMethod = plugin.auth.methods[0] as unknown as {
			authorize: (inputs?: Record<string, string>) => Promise<unknown>;
		};
		const manualMethod = plugin.auth.methods[1] as unknown as {
			authorize: () => Promise<unknown>;
		};

		vi.mocked(storageModule.setStoragePath).mockClear();
		vi.mocked(loggerModule.logWarn).mockClear();
		vi.mocked(configModule.loadPluginConfig).mockReturnValue(configModule.DEFAULT_CONFIG);

		await expect(autoMethod.authorize({ loginMode: "add", accountCount: "1" })).resolves.toBeDefined();
		expect(storageModule.setStoragePath).toHaveBeenCalledWith(process.cwd());
		expect(loggerModule.logWarn).toHaveBeenCalledWith(
			"Falling back to cached authorize storage config after config loader returned defaults.",
		);

		vi.mocked(storageModule.setStoragePath).mockClear();
		await expect(manualMethod.authorize()).resolves.toBeDefined();
		expect(storageModule.setStoragePath).toHaveBeenCalledWith(process.cwd());
	});

	it("reuses the cold-start authorize config instead of re-reading config twice", async () => {
		const configModule = await import("../lib/config.js");
		const storageModule = await import("../lib/storage.js");
		const coldStartConfig = { source: "cold-start-config" };

		vi.mocked(configModule.loadPluginConfig).mockReturnValue(coldStartConfig);
		vi.mocked(configModule.getPerProjectAccounts).mockImplementation(
			(config) => config === coldStartConfig,
		);

		const { plugin } = await setupPlugin();
		const autoMethod = plugin.auth.methods[0] as unknown as {
			authorize: (inputs?: Record<string, string>) => Promise<unknown>;
		};

		vi.mocked(configModule.loadPluginConfig).mockClear();
		vi.mocked(storageModule.setStoragePath).mockClear();

		await expect(autoMethod.authorize({ loginMode: "add", accountCount: "1" })).resolves.toBeDefined();

		expect(configModule.loadPluginConfig).toHaveBeenCalledTimes(1);
		expect(storageModule.setStoragePath).toHaveBeenCalledWith(process.cwd());
	});

	it("retries a pre-loader authorize refresh when the first authorize config falls back to defaults", async () => {
		const configModule = await import("../lib/config.js");
		const storageModule = await import("../lib/storage.js");
		const recoveredConfig = { source: "recovered-config" };

		vi.mocked(configModule.loadPluginConfig)
			.mockReturnValueOnce(configModule.DEFAULT_CONFIG)
			.mockReturnValueOnce(configModule.DEFAULT_CONFIG)
			.mockReturnValueOnce(recoveredConfig);
		vi.mocked(configModule.getPerProjectAccounts).mockImplementation(
			(config) => config === recoveredConfig,
		);

		const mockClient = createMockClient();
		const { OpenAIOAuthPlugin } = await import("../index.js");
		const plugin = await OpenAIOAuthPlugin({ client: mockClient } as never) as unknown as PluginType;
		const autoMethod = plugin.auth.methods[0] as unknown as {
			authorize: (inputs?: Record<string, string>) => Promise<unknown>;
		};

		vi.mocked(storageModule.setStoragePath).mockClear();

		await expect(autoMethod.authorize({ loginMode: "add", accountCount: "1" })).resolves.toBeDefined();

		expect(configModule.loadPluginConfig).toHaveBeenCalledTimes(3);
		expect(storageModule.setStoragePath).toHaveBeenCalledWith(process.cwd());
	});

	it("recovers footer runtime state after a cold-start authorize fallback refresh", async () => {
		mockStorage.accounts = [
			{ accountId: "acc-1", email: "user@example.com", refreshToken: "refresh-token" },
			{ accountId: "acc-2", email: "user2@example.com", refreshToken: "refresh-2" },
		];
		const configModule = await import("../lib/config.js");
		const recoveredConfig = { source: "recovered-footer-config" };

		vi.mocked(configModule.loadPluginConfig)
			.mockReturnValueOnce(configModule.DEFAULT_CONFIG)
			.mockReturnValueOnce(recoveredConfig);
		vi.mocked(configModule.getPersistAccountFooter).mockImplementation(
			(config) => config === recoveredConfig,
		);
		vi.mocked(configModule.getPersistAccountFooterStyle).mockReturnValue("full-email");

		const mockClient = createMockClient();
		const { OpenAIOAuthPlugin } = await import("../index.js");
		const plugin = await OpenAIOAuthPlugin({ client: mockClient } as never) as unknown as PluginType;
		const autoMethod = plugin.auth.methods[0] as unknown as {
			authorize: (inputs?: Record<string, string>) => Promise<unknown>;
		};

		await expect(autoMethod.authorize({ loginMode: "add", accountCount: "1" })).resolves.toBeDefined();
		mockClient.tui.showToast.mockClear();

		await plugin.event({
			event: { type: "account.select", properties: { index: 1 } },
		});

		expect(
			mockClient.tui.showToast.mock.calls.some(([payload]) => {
				const body = (payload as { body?: { message?: string; variant?: string } })
					?.body;
				return body?.variant === "info" && body.message === "Switched to account 2";
			}),
		).toBe(false);
	});

	it("shows the account-switch info toast when the footer is disabled", async () => {
		await disablePersistedFooter();
		mockStorage.accounts = [
			{ accountId: "acc-1", email: "user@example.com", refreshToken: "refresh-token" },
			{ accountId: "acc-2", email: "user2@example.com", refreshToken: "refresh-2" },
		];

		const { plugin, mockClient } = await setupPlugin();
		mockClient.tui.showToast.mockClear();

		await plugin.event({
			event: { type: "account.select", properties: { index: 1 } },
		});

		expect(mockClient.tui.showToast).toHaveBeenCalledWith({
			body: {
				message: "Switched to account 2",
				variant: "info",
			},
		});
	});

	it("keeps the newer account indicator when an in-flight response completes after a manual switch", async () => {
		await enablePersistedFooter("full-email");
		mockStorage.accounts = [
			{ accountId: "acc-1", email: "user@example.com", refreshToken: "refresh-token" },
			{ accountId: "acc-2", email: "user2@example.com", refreshToken: "refresh-2" },
		];

		const { plugin, sdk, mockClient } = await setupPlugin();
		await sendPersistedAccountRequest(sdk, "session-stale");
		mockClient.tui.showToast.mockClear();

		let resolveFetch: ((response: Response) => void) | undefined;
		let markFetchStarted: (() => void) | undefined;
		const fetchStarted = new Promise<void>((resolve) => {
			markFetchStarted = resolve;
		});
		globalThis.fetch = vi.fn().mockImplementation(
			() =>
				new Promise<Response>((resolve) => {
					resolveFetch = resolve;
					markFetchStarted?.();
				}),
		);

		const pendingResponse = sdk.fetch!("https://api.openai.com/v1/chat", {
			method: "POST",
			body: JSON.stringify({ model: "gpt-5.1", prompt_cache_key: "session-stale" }),
		});

		await fetchStarted;

		await plugin.event({
			event: { type: "account.select", properties: { index: 1 } },
		});

		resolveFetch?.(new Response(JSON.stringify({ content: "ok" }), { status: 200 }));
		await pendingResponse;

		expect((await readPersistedAccountIndicator(plugin, "session-stale")).variant).toBe(
			"user2@example.com [2/2]",
		);
	});

	it("keeps the higher revision when same-session responses resolve out of order", async () => {
		await enablePersistedFooter("full-email");
		mockStorage.accounts = [
			{ accountId: "acc-1", email: "user@example.com", refreshToken: "refresh-token" },
			{ accountId: "acc-2", email: "user2@example.com", refreshToken: "refresh-2" },
		];
		const accountsModule = await import("../lib/accounts.js");
		const fetchHelpers = await import("../lib/request/fetch-helpers.js");
		const manager = await accountsModule.AccountManager.loadFromDisk() as unknown as {
			accounts: Array<{
				index: number;
				accountId: string;
				email: string;
				refreshToken: string;
			}>;
			toAuthDetails: (account: {
				index: number;
				refreshToken: string;
			}) => {
				type: "oauth";
				access: string;
				refresh: string;
				expires: number;
			};
		};
		manager.accounts = [
			{ index: 0, accountId: "acc-1", email: "user@example.com", refreshToken: "refresh-token" },
			{ index: 1, accountId: "acc-2", email: "user2@example.com", refreshToken: "refresh-2" },
		];
		vi.spyOn(accountsModule.AccountManager, "loadFromDisk").mockResolvedValue(manager as never);
		vi.mocked(accountsModule.extractAccountEmail).mockImplementation((accessToken?: string) =>
			accessToken === "access-token-2" ? "user2@example.com" : "user@example.com",
		);
		manager.toAuthDetails = (account) => ({
			type: "oauth",
			access: account.index === 1 ? "access-token-2" : "access-token-1",
			refresh: account.refreshToken,
			expires: Date.now() + 60_000,
		});
		vi.mocked(fetchHelpers.transformRequestForCodex).mockImplementation(
			async (init, _url, _config, _codexMode, parsedBody) => ({
				updatedInit: init,
				body: parsedBody,
			}),
		);

		const { plugin, sdk } = await setupPlugin();
		const requestBody = JSON.stringify({
			model: "gpt-5.1",
			prompt_cache_key: "session-same-revision",
		});
		const fetchResolvers: Array<(response: Response) => void> = [];
		let releaseFirstFetch: (() => void) | undefined;
		const firstFetchStarted = new Promise<void>((resolve) => {
			releaseFirstFetch = resolve;
		});
		let releaseSecondFetch: (() => void) | undefined;
		const secondFetchStarted = new Promise<void>((resolve) => {
			releaseSecondFetch = resolve;
		});
		let fetchCallIndex = 0;

		globalThis.fetch = vi.fn().mockImplementation(
			() =>
				new Promise<Response>((resolve) => {
					fetchResolvers[fetchCallIndex] = resolve;
					if (fetchCallIndex === 0) {
						releaseFirstFetch?.();
					} else {
						releaseSecondFetch?.();
					}
					fetchCallIndex += 1;
				}),
		);

		const requestA = sdk.fetch!("https://api.openai.com/v1/chat", {
			method: "POST",
			body: requestBody,
		});
		await firstFetchStarted;

		manager.accounts = [
			{ index: 1, accountId: "acc-2", email: "user2@example.com", refreshToken: "refresh-2" },
			{ index: 0, accountId: "acc-1", email: "user@example.com", refreshToken: "refresh-token" },
		];

		const requestB = sdk.fetch!("https://api.openai.com/v1/chat", {
			method: "POST",
			body: requestBody,
		});
		await secondFetchStarted;

		fetchResolvers[1]?.(new Response(JSON.stringify({ content: "ok" }), { status: 200 }));
		await requestB;
		fetchResolvers[0]?.(new Response(JSON.stringify({ content: "ok" }), { status: 200 }));
		await requestA;

		expect(
			(await readPersistedAccountIndicator(plugin, "session-same-revision")).variant,
		).toBe("user2@example.com [2/2]");
	});

	it("evicts the oldest persisted indicator after a full refresh when a new session overflows the cap", async () => {
		await enablePersistedFooter("full-email");
		mockStorage.accounts = [
			{ accountId: "acc-1", email: "user@example.com", refreshToken: "refresh-token" },
			{ accountId: "acc-2", email: "user2@example.com", refreshToken: "refresh-2" },
		];
		const { MAX_PERSISTED_ACCOUNT_INDICATORS } = await import("../index.js");
		const sessionIDs = Array.from(
			{ length: MAX_PERSISTED_ACCOUNT_INDICATORS },
			(_, index) => `session-overflow-${index}`,
		);

		const { plugin, sdk } = await setupPlugin();
		for (const sessionID of sessionIDs) {
			await sendPersistedAccountRequest(sdk, sessionID);
		}

		await plugin.event({
			event: { type: "account.select", properties: { index: 1 } },
		});

		await sendPersistedAccountRequest(sdk, "session-overflow-new");

		expect((await readPersistedAccountIndicator(plugin, sessionIDs[0]!)).variant).toBeUndefined();
		expect((await readPersistedAccountIndicator(plugin, sessionIDs[1]!)).variant).toBe(
			"user2@example.com [2/2]",
		);
		expect((await readPersistedAccountIndicator(plugin, "session-overflow-new")).variant).toBeDefined();
	});

	it("shows the account-use info toast when the footer is disabled", async () => {
		await disablePersistedFooter();
		mockStorage.accounts = [
			{ accountId: "acc-1", email: "user@example.com", refreshToken: "refresh-token" },
			{ accountId: "acc-2", email: "user2@example.com", refreshToken: "refresh-2" },
		];
		const accountsModule = await import("../lib/accounts.js");
		const manager = await accountsModule.AccountManager.loadFromDisk() as unknown as {
			accounts: Array<{
				index: number;
				accountId: string;
				email: string;
				refreshToken: string;
			}>;
		};
		manager.accounts = [
			{ index: 0, accountId: "acc-1", email: "user@example.com", refreshToken: "refresh-token" },
			{ index: 1, accountId: "acc-2", email: "user2@example.com", refreshToken: "refresh-2" },
		];
		vi.spyOn(accountsModule.AccountManager, "loadFromDisk").mockResolvedValue(manager as never);
		vi.spyOn(accountsModule, "formatAccountLabel").mockImplementation(
			(account: { email?: string }, index: number) =>
				account.email ?? `Account ${index + 1}`,
		);
		vi.spyOn(accountsModule.AccountManager.prototype, "shouldShowAccountToast").mockReturnValue(true);

		const { sdk, mockClient } = await setupPlugin();
		mockClient.tui.showToast.mockClear();

		await sendPersistedAccountRequest(sdk, "session-using-shown");

		expect(mockClient.tui.showToast).toHaveBeenCalledWith({
			body: {
				message: "Using user@example.com (1/2)",
				variant: "info",
			},
		});
	});

	it("suppresses the account-use info toast when the footer is enabled", async () => {
		await enablePersistedFooter("full-email");
		mockStorage.accounts = [
			{ accountId: "acc-1", email: "user@example.com", refreshToken: "refresh-token" },
			{ accountId: "acc-2", email: "user2@example.com", refreshToken: "refresh-2" },
		];
		const accountsModule = await import("../lib/accounts.js");
		const manager = await accountsModule.AccountManager.loadFromDisk() as unknown as {
			accounts: Array<{
				index: number;
				accountId: string;
				email: string;
				refreshToken: string;
			}>;
		};
		manager.accounts = [
			{ index: 0, accountId: "acc-1", email: "user@example.com", refreshToken: "refresh-token" },
			{ index: 1, accountId: "acc-2", email: "user2@example.com", refreshToken: "refresh-2" },
		];
		vi.spyOn(accountsModule.AccountManager, "loadFromDisk").mockResolvedValue(manager as never);
		vi.spyOn(accountsModule, "formatAccountLabel").mockImplementation(
			(account: { email?: string }, index: number) =>
				account.email ?? `Account ${index + 1}`,
		);
		vi.spyOn(accountsModule.AccountManager.prototype, "shouldShowAccountToast").mockReturnValue(true);

		const { sdk, mockClient } = await setupPlugin();
		mockClient.tui.showToast.mockClear();

		await sendPersistedAccountRequest(sdk, "session-using-hidden");

		expect(mockClient.tui.showToast).not.toHaveBeenCalledWith({
			body: {
				message: "Using user@example.com (1/2)",
				variant: "info",
			},
		});
	});

	it("handles network errors and rotates to next account", async () => {
		globalThis.fetch = vi.fn().mockRejectedValue(new Error("Network timeout"));

		const { sdk } = await setupPlugin();
		const response = await sdk.fetch!("https://api.openai.com/v1/chat", {
			method: "POST",
			body: JSON.stringify({ model: "gpt-5.1" }),
		});

		expect(response.status).toBe(503);
		expect(await response.text()).toContain("server errors or auth issues");
	});

	it("cools down the account when grouped auth removal removes zero entries", async () => {
		const fetchHelpers = await import("../lib/request/fetch-helpers.js");
		const { AccountManager } = await import("../lib/accounts.js");
		const { ACCOUNT_LIMITS } = await import("../lib/constants.js");

		vi.spyOn(fetchHelpers, "shouldRefreshToken").mockReturnValue(true);
		vi.mocked(fetchHelpers.refreshAndUpdateToken).mockRejectedValue(
			new Error("Token expired"),
		);
		const incrementAuthFailuresSpy = vi
			.spyOn(AccountManager.prototype, "incrementAuthFailures")
			.mockReturnValue(ACCOUNT_LIMITS.MAX_AUTH_FAILURES_BEFORE_REMOVAL);
		const removeGroupedAccountsSpy = vi
			.spyOn(AccountManager.prototype, "removeAccountsWithSameRefreshToken")
			.mockReturnValue(0);
		const markAccountsWithRefreshTokenCoolingDownSpy = vi.spyOn(
			AccountManager.prototype,
			"markAccountsWithRefreshTokenCoolingDown",
		);

		globalThis.fetch = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ content: "should-not-fetch" }), { status: 200 }),
		);

		const { sdk } = await setupPlugin();
		const response = await sdk.fetch!("https://api.openai.com/v1/chat", {
			method: "POST",
			body: JSON.stringify({ model: "gpt-5.1" }),
		});

		expect(response.status).toBe(503);
		expect(globalThis.fetch).not.toHaveBeenCalled();
		expect(incrementAuthFailuresSpy).toHaveBeenCalledTimes(1);
		expect(removeGroupedAccountsSpy).toHaveBeenCalledTimes(1);
		expect(markAccountsWithRefreshTokenCoolingDownSpy).toHaveBeenCalledWith(
			"refresh-1",
			ACCOUNT_LIMITS.AUTH_FAILURE_COOLDOWN_MS,
			"auth-failure",
		);
	});

	it("skips fetch when local token bucket is depleted", async () => {
		const { AccountManager } = await import("../lib/accounts.js");
		const consumeSpy = vi.spyOn(AccountManager.prototype, "consumeToken").mockReturnValue(false);
		globalThis.fetch = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ content: "should-not-be-returned" }), { status: 200 }),
		);

		const { sdk, mockClient } = await setupPlugin();
		mockClient.tui.showToast.mockClear();
		const response = await sdk.fetch!("https://api.openai.com/v1/chat", {
			method: "POST",
			body: JSON.stringify({ model: "gpt-5.1" }),
		});

		expect(globalThis.fetch).not.toHaveBeenCalled();
		expect(response.status).toBe(503);
		expect(await response.text()).toContain("server errors or auth issues");
		expect(mockClient.tui.showToast).toHaveBeenCalledWith({
			body: {
				message: "All 1 account(s) failed (server errors or auth issues). Check account health with `codex-health`.",
				variant: "error",
				duration: 5000,
			},
		});
		consumeSpy.mockRestore();
	});

	it("still returns a terminal 503 when the TUI toast channel throws", async () => {
		const { AccountManager } = await import("../lib/accounts.js");
		const consumeSpy = vi.spyOn(AccountManager.prototype, "consumeToken").mockReturnValue(false);
		globalThis.fetch = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ content: "should-not-be-returned" }), { status: 200 }),
		);

		const { sdk, mockClient } = await setupPlugin();
		mockClient.tui.showToast.mockRejectedValue(new Error("tui closed"));

		const response = await sdk.fetch!("https://api.openai.com/v1/chat", {
			method: "POST",
			body: JSON.stringify({ model: "gpt-5.1" }),
		});

		expect(globalThis.fetch).not.toHaveBeenCalled();
		expect(response.status).toBe(503);
		expect(await response.text()).toContain("server errors or auth issues");
		consumeSpy.mockRestore();
	});

	it("uses a warning toast for all-accounts rate-limit terminal responses", async () => {
		const { AccountManager } = await import("../lib/accounts.js");
		const configModule = await import("../lib/config.js");
		vi.mocked(configModule.getRetryAllAccountsRateLimited).mockReturnValue(false);
		const consumeSpy = vi.spyOn(AccountManager.prototype, "consumeToken").mockReturnValue(false);
		const waitSpy = vi
			.spyOn(AccountManager.prototype, "getMinWaitTimeForFamily")
			.mockReturnValue(60_000);
		globalThis.fetch = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ content: "should-not-be-returned" }), { status: 200 }),
		);

		const { sdk, mockClient } = await setupPlugin();
		mockClient.tui.showToast.mockClear();
		const response = await sdk.fetch!("https://api.openai.com/v1/chat", {
			method: "POST",
			body: JSON.stringify({ model: "gpt-5.1" }),
		});

		expect(globalThis.fetch).not.toHaveBeenCalled();
		expect(response.status).toBe(429);
		expect(mockClient.tui.showToast).toHaveBeenCalledWith({
			body: {
				message: "All 1 account(s) are rate-limited. Try again in 60s or add another account with `opencode auth login`.",
				variant: "warning",
				duration: 5000,
			},
		});

		waitSpy.mockRestore();
		consumeSpy.mockRestore();
	});

	it("falls back from gpt-5.4-pro to gpt-5.4 when unsupported fallback is enabled", async () => {
		const configModule = await import("../lib/config.js");
		const fetchHelpers = await import("../lib/request/fetch-helpers.js");

		vi.mocked(configModule.getFallbackOnUnsupportedCodexModel).mockReturnValueOnce(true);
		vi.mocked(configModule.getFallbackToGpt52OnUnsupportedGpt53).mockReturnValueOnce(false);
		vi.mocked(fetchHelpers.transformRequestForCodex).mockResolvedValueOnce({
			updatedInit: {
				method: "POST",
				body: JSON.stringify({ model: "gpt-5.4-pro" }),
			},
			body: { model: "gpt-5.4-pro" },
		});
		vi.mocked(fetchHelpers.handleErrorResponse).mockResolvedValueOnce({
			response: new Response(
				JSON.stringify({
					error: {
						code: "model_not_supported_with_chatgpt_account",
						message:
							"The 'gpt-5.4-pro' model is not supported when using Codex with a ChatGPT account.",
					},
				}),
				{ status: 400 },
			),
			rateLimit: undefined,
			errorBody: {
				error: {
					code: "model_not_supported_with_chatgpt_account",
					message:
						"The 'gpt-5.4-pro' model is not supported when using Codex with a ChatGPT account.",
				},
			},
		});
		vi.mocked(fetchHelpers.resolveUnsupportedCodexFallbackModel).mockReturnValueOnce("gpt-5.4");

		globalThis.fetch = vi
			.fn()
			.mockResolvedValueOnce(new Response("bad", { status: 400 }))
			.mockResolvedValueOnce(new Response(JSON.stringify({ content: "ok" }), { status: 200 }));

		const { sdk } = await setupPlugin();
		const response = await sdk.fetch!("https://api.openai.com/v1/chat", {
			method: "POST",
			body: JSON.stringify({ model: "gpt-5.4-pro" }),
		});

		expect(response.status).toBe(200);
		expect(globalThis.fetch).toHaveBeenCalledTimes(2);
		const firstInit = vi.mocked(globalThis.fetch).mock.calls[0]?.[1] as RequestInit;
		const secondInit = vi.mocked(globalThis.fetch).mock.calls[1]?.[1] as RequestInit;
		expect(JSON.parse(firstInit.body as string).model).toBe("gpt-5.4-pro");
		expect(JSON.parse(secondInit.body as string).model).toBe("gpt-5.4");
	});

	it("falls back from gpt-5.3-codex to gpt-5.2-codex when unsupported fallback is enabled", async () => {
		const configModule = await import("../lib/config.js");
		const fetchHelpers = await import("../lib/request/fetch-helpers.js");

		vi.mocked(configModule.getFallbackOnUnsupportedCodexModel).mockReturnValueOnce(true);
		vi.mocked(configModule.getFallbackToGpt52OnUnsupportedGpt53).mockReturnValueOnce(true);
		vi.mocked(fetchHelpers.transformRequestForCodex).mockResolvedValueOnce({
			updatedInit: {
				method: "POST",
				body: JSON.stringify({ model: "gpt-5.3-codex" }),
			},
			body: { model: "gpt-5.3-codex" },
		});
		vi.mocked(fetchHelpers.handleErrorResponse).mockResolvedValueOnce({
			response: new Response(
				JSON.stringify({
					error: {
						code: "model_not_supported_with_chatgpt_account",
						message:
							"The 'gpt-5.3-codex' model is not supported when using Codex with a ChatGPT account.",
					},
				}),
				{ status: 400 },
			),
			rateLimit: undefined,
			errorBody: {
				error: {
					code: "model_not_supported_with_chatgpt_account",
					message:
						"The 'gpt-5.3-codex' model is not supported when using Codex with a ChatGPT account.",
				},
			},
		});
		vi.mocked(fetchHelpers.resolveUnsupportedCodexFallbackModel).mockReturnValueOnce("gpt-5.2-codex");

		globalThis.fetch = vi
			.fn()
			.mockResolvedValueOnce(new Response("bad", { status: 400 }))
			.mockResolvedValueOnce(new Response(JSON.stringify({ content: "ok" }), { status: 200 }));

		const { sdk } = await setupPlugin();
		const response = await sdk.fetch!("https://api.openai.com/v1/chat", {
			method: "POST",
			body: JSON.stringify({ model: "gpt-5.3-codex" }),
		});

		expect(response.status).toBe(200);
		expect(globalThis.fetch).toHaveBeenCalledTimes(2);
		const firstInit = vi.mocked(globalThis.fetch).mock.calls[0]?.[1] as RequestInit;
		const secondInit = vi.mocked(globalThis.fetch).mock.calls[1]?.[1] as RequestInit;
		expect(JSON.parse(firstInit.body as string).model).toBe("gpt-5.3-codex");
		expect(JSON.parse(secondInit.body as string).model).toBe("gpt-5.2-codex");
	});

		it("cascades Spark fallback from gpt-5.3-codex-spark -> gpt-5.3-codex -> gpt-5.2-codex", async () => {
			const configModule = await import("../lib/config.js");
			const fetchHelpers = await import("../lib/request/fetch-helpers.js");

		vi.mocked(configModule.getFallbackOnUnsupportedCodexModel).mockReturnValueOnce(true);
		vi.mocked(configModule.getFallbackToGpt52OnUnsupportedGpt53).mockReturnValueOnce(true);
		vi.mocked(fetchHelpers.transformRequestForCodex).mockResolvedValueOnce({
			updatedInit: {
				method: "POST",
				body: JSON.stringify({ model: "gpt-5.3-codex-spark" }),
			},
			body: { model: "gpt-5.3-codex-spark" },
		});
		vi.mocked(fetchHelpers.handleErrorResponse)
			.mockResolvedValueOnce({
				response: new Response(JSON.stringify({ error: { code: "model_not_supported_with_chatgpt_account" } }), { status: 400 }),
				rateLimit: undefined,
				errorBody: {
					error: {
						code: "model_not_supported_with_chatgpt_account",
						message:
							"The 'gpt-5.3-codex-spark' model is not supported when using Codex with a ChatGPT account.",
					},
				},
			})
			.mockResolvedValueOnce({
				response: new Response(JSON.stringify({ error: { code: "model_not_supported_with_chatgpt_account" } }), { status: 400 }),
				rateLimit: undefined,
				errorBody: {
					error: {
						code: "model_not_supported_with_chatgpt_account",
						message:
							"The 'gpt-5.3-codex' model is not supported when using Codex with a ChatGPT account.",
					},
				},
			});
		vi.mocked(fetchHelpers.resolveUnsupportedCodexFallbackModel)
			.mockReturnValueOnce("gpt-5.3-codex")
			.mockReturnValueOnce("gpt-5.2-codex");

		globalThis.fetch = vi
			.fn()
			.mockResolvedValueOnce(new Response("bad", { status: 400 }))
			.mockResolvedValueOnce(new Response("still bad", { status: 400 }))
			.mockResolvedValueOnce(new Response(JSON.stringify({ content: "ok" }), { status: 200 }));

		const { sdk } = await setupPlugin();
		const response = await sdk.fetch!("https://api.openai.com/v1/chat", {
			method: "POST",
			body: JSON.stringify({ model: "gpt-5.3-codex-spark" }),
		});

		expect(response.status).toBe(200);
		expect(globalThis.fetch).toHaveBeenCalledTimes(3);
		const firstInit = vi.mocked(globalThis.fetch).mock.calls[0]?.[1] as RequestInit;
		const secondInit = vi.mocked(globalThis.fetch).mock.calls[1]?.[1] as RequestInit;
		const thirdInit = vi.mocked(globalThis.fetch).mock.calls[2]?.[1] as RequestInit;
		expect(JSON.parse(firstInit.body as string).model).toBe("gpt-5.3-codex-spark");
			expect(JSON.parse(secondInit.body as string).model).toBe("gpt-5.3-codex");
			expect(JSON.parse(thirdInit.body as string).model).toBe("gpt-5.2-codex");
		});

		it("restarts account traversal after fallback model switch", async () => {
			const configModule = await import("../lib/config.js");
			const fetchHelpers = await import("../lib/request/fetch-helpers.js");
			const { AccountManager } = await import("../lib/accounts.js");

			const accountOne = {
				index: 0,
				accountId: "acc-1",
				email: "user1@example.com",
				refreshToken: "refresh-1",
			};
			const accountTwo = {
				index: 1,
				accountId: "acc-2",
				email: "user2@example.com",
				refreshToken: "refresh-2",
			};

			let legacySelection = 0;
			let fallbackSelection = 0;
			const customManager = {
				getAccountCount: () => 2,
				getCurrentOrNextForFamilyHybrid: (_family: string, currentModel?: string) => {
					if (currentModel === "gpt-5-codex") {
						if (fallbackSelection === 0) {
							fallbackSelection++;
							return accountOne;
						}
						if (fallbackSelection === 1) {
							fallbackSelection++;
							return accountTwo;
						}
						return null;
					}
					if (legacySelection === 0) {
						legacySelection++;
						return accountOne;
					}
					if (legacySelection === 1) {
						legacySelection++;
						return accountTwo;
					}
					return null;
				},
				getSelectionExplainability: () => [
					{
						index: 0,
						enabled: true,
						isCurrentForFamily: true,
						eligible: true,
						reasons: ["eligible"],
						healthScore: 100,
						tokensAvailable: 50,
						lastUsed: Date.now(),
					},
					{
						index: 1,
						enabled: true,
						isCurrentForFamily: false,
						eligible: true,
						reasons: ["eligible"],
						healthScore: 100,
						tokensAvailable: 50,
						lastUsed: Date.now(),
					},
				],
				toAuthDetails: (account: { accountId?: string }) => ({
					type: "oauth" as const,
					access: `access-${account.accountId ?? "unknown"}`,
					refresh: "refresh-token",
					expires: Date.now() + 60_000,
				}),
				hasRefreshToken: () => true,
				saveToDiskDebounced: () => {},
				updateFromAuth: () => {},
				clearAuthFailures: () => {},
				incrementAuthFailures: () => 1,
				markAccountCoolingDown: () => {},
				markRateLimitedWithReason: () => {},
				recordRateLimit: () => {},
				consumeToken: () => true,
				refundToken: () => {},
				markSwitched: () => {},
				removeAccount: () => {},
				recordFailure: () => {},
				recordSuccess: () => {},
				getMinWaitTimeForFamily: () => 0,
				shouldShowAccountToast: () => false,
				markToastShown: () => {},
				setActiveIndex: () => accountOne,
				getAccountsSnapshot: () => [accountOne, accountTwo],
			};
			vi.spyOn(AccountManager, "loadFromDisk").mockResolvedValueOnce(customManager as never);

			vi.mocked(configModule.getFallbackOnUnsupportedCodexModel).mockReturnValueOnce(true);
			vi.mocked(configModule.getFallbackToGpt52OnUnsupportedGpt53).mockReturnValueOnce(true);
			vi.mocked(fetchHelpers.transformRequestForCodex).mockResolvedValueOnce({
				updatedInit: {
					method: "POST",
					body: JSON.stringify({ model: "gpt-5.3-codex" }),
				},
				body: { model: "gpt-5.3-codex" },
			});
			vi.mocked(fetchHelpers.createCodexHeaders).mockImplementation(
				(_init, _accountId, accessToken) =>
					new Headers({ "x-test-access-token": String(accessToken) }),
			);
			vi.mocked(fetchHelpers.handleErrorResponse).mockImplementation(async (response) => {
				const errorBody = await response.clone().json().catch(() => ({}));
				return { response, rateLimit: undefined, errorBody };
			});
			vi.mocked(fetchHelpers.getUnsupportedCodexModelInfo).mockImplementation((errorBody: unknown) => {
				const message = (errorBody as { error?: { message?: string } })?.error?.message ?? "";
				if (!/not supported when using codex with a chatgpt account/i.test(message)) {
					return { isUnsupported: false };
				}
				const match = message.match(/'([^']+)'/);
				return {
					isUnsupported: true,
					unsupportedModel: match?.[1],
					message,
					code: "model_not_supported_with_chatgpt_account",
				};
			});
			vi.mocked(fetchHelpers.resolveUnsupportedCodexFallbackModel).mockImplementation(({ requestedModel }) => {
				return requestedModel === "gpt-5.3-codex" ? "gpt-5-codex" : undefined;
			});

			globalThis.fetch = vi.fn(async (_url, init) => {
				const body =
					init && typeof init.body === "string"
						? (JSON.parse(init.body) as { model?: string })
						: {};
				const headers = new Headers(init?.headers);
				const accessToken = headers.get("x-test-access-token");

				if (body.model === "gpt-5.3-codex") {
					return new Response(
						JSON.stringify({
							error: {
								code: "model_not_supported_with_chatgpt_account",
								message:
									"The 'gpt-5.3-codex' model is not supported when using Codex with a ChatGPT account.",
							},
						}),
						{ status: 400 },
					);
				}

				if (body.model === "gpt-5-codex" && accessToken === "access-account-1") {
					return new Response(JSON.stringify({ content: "ok" }), { status: 200 });
				}

				return new Response(
					JSON.stringify({
						error: {
							code: "model_not_supported_with_chatgpt_account",
							message:
								"The 'gpt-5-codex' model is not supported when using Codex with a ChatGPT account.",
						},
					}),
					{ status: 400 },
				);
			});

			const { sdk } = await setupPlugin();
			const response = await sdk.fetch!("https://api.openai.com/v1/chat", {
				method: "POST",
				body: JSON.stringify({ model: "gpt-5.3-codex" }),
			});

			const fetchCalls = vi.mocked(globalThis.fetch).mock.calls.map((call) => {
				const init = call[1] as RequestInit;
				const body =
					typeof init.body === "string"
						? (JSON.parse(init.body) as { model?: string })
						: {};
				const headers = new Headers(init.headers);
				return {
					model: body.model,
					accessToken: headers.get("x-test-access-token"),
				};
			});
			expect(fetchCalls).toEqual([
				{ model: "gpt-5.3-codex", accessToken: "access-acc-1" },
				{ model: "gpt-5.3-codex", accessToken: "access-acc-2" },
				{ model: "gpt-5-codex", accessToken: "access-account-1" },
			]);
			expect(response.status).toBe(200);
		});

		it("handles empty body in request", async () => {
			globalThis.fetch = vi.fn().mockResolvedValue(
				new Response(JSON.stringify({ content: "test" }), { status: 200 }),
		);

		const { sdk } = await setupPlugin();
		const response = await sdk.fetch!("https://api.openai.com/v1/chat", {});

		expect(response.status).toBe(200);
	});

	it("handles malformed JSON body gracefully", async () => {
		globalThis.fetch = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ content: "test" }), { status: 200 }),
		);

		const { sdk } = await setupPlugin();
		const response = await sdk.fetch!("https://api.openai.com/v1/chat", {
			method: "POST",
			body: "not-valid-json{",
		});

		expect(response.status).toBe(200);
	});

	it("handles abort signal during fetch", async () => {
		globalThis.fetch = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ content: "test" }), { status: 200 }),
		);

		const { sdk } = await setupPlugin();
		const controller = new AbortController();

		const response = await sdk.fetch!("https://api.openai.com/v1/chat", {
			method: "POST",
			body: JSON.stringify({ model: "gpt-5.1" }),
			signal: controller.signal,
		});

		expect(response.status).toBe(200);
	});

	it("handles streaming request (stream=true in body)", async () => {
		globalThis.fetch = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ content: "test" }), { status: 200 }),
		);

		const { sdk } = await setupPlugin();
		const response = await sdk.fetch!("https://api.openai.com/v1/chat", {
			method: "POST",
			body: JSON.stringify({ model: "gpt-5.1", stream: true }),
		});

		expect(response.status).toBe(200);
	});
});

describe("OpenAIOAuthPlugin resolveAccountSelection", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockStorage.accounts = [];
		mockStorage.activeIndex = 0;
		mockStorage.activeIndexByFamily = {};
		delete process.env.CODEX_AUTH_ACCOUNT_ID;
	});

	afterEach(() => {
		vi.restoreAllMocks();
		delete process.env.CODEX_AUTH_ACCOUNT_ID;
	});

	it("uses CODEX_AUTH_ACCOUNT_ID environment override", async () => {
		process.env.CODEX_AUTH_ACCOUNT_ID = "override-account-12345";

		mockStorage.accounts = [
			{ accountId: "acc-1", email: "user@example.com", refreshToken: "refresh-1" },
		];

		const mockClient = createMockClient();
		const { OpenAIOAuthPlugin } = await import("../index.js");
		const plugin = await OpenAIOAuthPlugin({ client: mockClient } as never) as unknown as PluginType;

		const getAuth = async () => ({
			type: "oauth" as const,
			access: "access-token",
			refresh: "refresh-token",
			expires: Date.now() + 60_000,
			multiAccount: true,
		});

		const sdk = await plugin.auth.loader(getAuth, { options: {}, models: {} });
		expect(sdk.fetch).toBeDefined();
	});

	it("uses short CODEX_AUTH_ACCOUNT_ID override", async () => {
		process.env.CODEX_AUTH_ACCOUNT_ID = "short";

		mockStorage.accounts = [
			{ accountId: "acc-1", email: "user@example.com", refreshToken: "refresh-1" },
		];

		const mockClient = createMockClient();
		const { OpenAIOAuthPlugin } = await import("../index.js");
		const plugin = await OpenAIOAuthPlugin({ client: mockClient } as never) as unknown as PluginType;

		const getAuth = async () => ({
			type: "oauth" as const,
			access: "access-token",
			refresh: "refresh-token",
			expires: Date.now() + 60_000,
			multiAccount: true,
		});

		const sdk = await plugin.auth.loader(getAuth, { options: {}, models: {} });
		expect(sdk.fetch).toBeDefined();
	});
});

describe("OpenAIOAuthPlugin persistAccountPool", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockStorage.accounts = [];
		mockStorage.activeIndex = 0;
		mockStorage.activeIndexByFamily = {};
		delete process.env.CODEX_AUTH_ACCOUNT_ID;
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("handles existing account update by refreshToken", async () => {
		mockStorage.accounts = [
			{
				accountId: "acc-1",
				email: "old@example.com",
				refreshToken: "refresh-1",
				addedAt: Date.now() - 100000,
			},
		];

		const mockClient = createMockClient();
		const { OpenAIOAuthPlugin } = await import("../index.js");
		await OpenAIOAuthPlugin({ client: mockClient } as never);

		expect(mockStorage.accounts).toHaveLength(1);
	});

	it("handles existing account update by accountId", async () => {
		mockStorage.accounts = [
			{
				accountId: "acc-existing",
				email: "old@example.com",
				refreshToken: "old-refresh",
				addedAt: Date.now() - 100000,
			},
		];

		const mockClient = createMockClient();
		const { OpenAIOAuthPlugin } = await import("../index.js");
		await OpenAIOAuthPlugin({ client: mockClient } as never);

		expect(mockStorage.accounts).toHaveLength(1);
	});

	it("persists distinct organization candidates from a single login while keeping best candidate primary", async () => {
		const accountsModule = await import("../lib/accounts.js");
		const authModule = await import("../lib/auth/auth.js");

		vi.mocked(authModule.exchangeAuthorizationCode).mockResolvedValueOnce({
			type: "success",
			access: "access-multi",
			refresh: "refresh-multi",
			expires: Date.now() + 300_000,
			idToken: "id-multi",
		});
		vi.mocked(accountsModule.getAccountIdCandidates).mockReturnValueOnce([
			{ accountId: "token-personal", source: "token", label: "Token Personal [id:sonal]", organizationId: "org-personal" },
			{ accountId: "org-default", source: "org", label: "Workspace Alpha [id:fault]", organizationId: "org-default" },
			{ accountId: "id-secondary", source: "id_token", label: "Workspace Beta [id:ndary]", organizationId: "org-secondary" },
		]);
		vi.mocked(accountsModule.selectBestAccountCandidate).mockImplementationOnce((candidates) =>
			candidates.find((candidate) => candidate.accountId === "org-default") ?? candidates[0],
		);

		const mockClient = createMockClient();
		const { OpenAIOAuthPlugin } = await import("../index.js");
		const plugin = await OpenAIOAuthPlugin({ client: mockClient } as never) as unknown as PluginType;
		const autoMethod = plugin.auth.methods[0] as unknown as {
			authorize: (inputs?: Record<string, string>) => Promise<{ instructions: string }>;
		};

		await autoMethod.authorize({ loginMode: "add", accountCount: "1" });

		expect(mockStorage.accounts).toHaveLength(3);
		expect(mockStorage.accounts.map((account) => account.accountId)).toEqual([
			"org-default",
			"token-personal",
			"id-secondary",
		]);
		expect(mockStorage.accounts.map((account) => account.accountIdSource)).toEqual([
			"org",
			"token",
			"id_token",
		]);
		expect(mockStorage.accounts.map((account) => account.accountLabel)).toEqual([
			"Workspace Alpha [id:fault]",
			"Token Personal [id:sonal]",
			"Workspace Beta [id:ndary]",
		]);
		expect(mockStorage.activeIndex).toBe(0);

		const persistedOrgIds = mockStorage.accounts
			.map((account) => account.organizationId)
			.filter((organizationId): organizationId is string => typeof organizationId === "string");
		// Personal identities are left intact while team org duplicates are collapsed.
		expect(persistedOrgIds).toEqual(["org-default", "org-personal", "org-secondary"]);
	});

	it("keeps non-primary candidates persisted even when best candidate differs", async () => {
		const accountsModule = await import("../lib/accounts.js");
		const authModule = await import("../lib/auth/auth.js");

		vi.mocked(authModule.exchangeAuthorizationCode).mockResolvedValueOnce({
			type: "success",
			access: "access-two",
			refresh: "refresh-two",
			expires: Date.now() + 300_000,
			idToken: "id-two",
		});
		vi.mocked(accountsModule.getAccountIdCandidates).mockReturnValueOnce([
			{ accountId: "token-first", source: "token", label: "Token First [id:first]", organizationId: "org-token" },
			{ accountId: "org-preferred", source: "org", label: "Org Preferred [id:ferred]", organizationId: "org-preferred" },
		]);
		vi.mocked(accountsModule.selectBestAccountCandidate).mockImplementationOnce((candidates) =>
			candidates.find((candidate) => candidate.accountId === "org-preferred") ?? candidates[0],
		);

		const mockClient = createMockClient();
		const { OpenAIOAuthPlugin } = await import("../index.js");
		const plugin = await OpenAIOAuthPlugin({ client: mockClient } as never) as unknown as PluginType;
		const autoMethod = plugin.auth.methods[0] as unknown as {
			authorize: (inputs?: Record<string, string>) => Promise<{ instructions: string }>;
		};

		await autoMethod.authorize({ loginMode: "add", accountCount: "1" });

		expect(mockStorage.accounts.map((account) => account.accountId)).toEqual([
			"org-preferred",
			"token-first",
		]);
		expect(mockStorage.accounts[1]?.accountIdSource).toBe("token");
		expect(mockStorage.accounts.map((account) => account.organizationId)).toEqual([
			"org-preferred",
			"org-token",
		]);
	});

	it("preserves duplicate organization candidates when accountId differs", async () => {
		const accountsModule = await import("../lib/accounts.js");
		const authModule = await import("../lib/auth/auth.js");

		vi.mocked(authModule.exchangeAuthorizationCode).mockResolvedValueOnce({
			type: "success",
			access: "access-org-dup",
			refresh: "refresh-org-dup",
			expires: Date.now() + 300_000,
			idToken: "id-org-dup",
		});
		vi.mocked(accountsModule.getAccountIdCandidates).mockReturnValueOnce([
			{
				accountId: "org-variant-a",
				organizationId: "organization-shared",
				source: "org",
				label: "Org Shared A [id:ared-a]",
			},
			{
				accountId: "org-variant-b",
				organizationId: "organization-shared",
				source: "org",
				label: "Org Shared B [id:ared-b]",
			},
			{ accountId: "token-personal", source: "token", label: "Token [id:sonal]" },
		]);
		vi.mocked(accountsModule.selectBestAccountCandidate).mockImplementationOnce((candidates) =>
			candidates.find((candidate) => candidate.accountId === "org-variant-a") ?? candidates[0],
		);

		const mockClient = createMockClient();
		const { OpenAIOAuthPlugin } = await import("../index.js");
		const plugin = await OpenAIOAuthPlugin({ client: mockClient } as never) as unknown as PluginType;
		const autoMethod = plugin.auth.methods[0] as unknown as {
			authorize: (inputs?: Record<string, string>) => Promise<{ instructions: string }>;
		};

		await autoMethod.authorize({ loginMode: "add", accountCount: "1" });

		const organizationEntries = mockStorage.accounts.filter(
			(account) => account.organizationId === "organization-shared",
		);
		expect(organizationEntries).toHaveLength(2);
		const organizationAccountIds = organizationEntries.map((account) => account.accountId).sort();
		expect(organizationAccountIds).toEqual(["org-variant-a", "org-variant-b"]);
		expect(mockStorage.accounts).toHaveLength(3);
		expect(mockStorage.accounts.some((account) => account.accountId === "token-personal")).toBe(true);
	});

	it("preserves org/no-org shared-refresh entries with different accountId values from a single login", async () => {
		const accountsModule = await import("../lib/accounts.js");
		const authModule = await import("../lib/auth/auth.js");

		// Simulate a single OAuth login that produces an org candidate + a token candidate.
		// Both share the same refresh token (same human account).
		// Since accountId values differ, both should be preserved.
		vi.mocked(authModule.exchangeAuthorizationCode).mockResolvedValueOnce({
			type: "success",
			access: "access-holly",
			refresh: "refresh-holly-shared",
			expires: Date.now() + 300_000,
			idToken: "id-holly",
		});
		vi.mocked(accountsModule.getAccountIdCandidates).mockReturnValueOnce([
			{
				accountId: "org-QA1bZCn6zb57FT6TXLZWMPO3",
				organizationId: "org-QA1bZCn6zb57FT6TXLZWMPO3",
				source: "org",
				label: "Personal (role:owner) [id:ZWMPO3]",
				isPersonal: true,
			},
			{
				accountId: "e4692e53-2f30-42a0-b8df-3a685d3c2a4a",
				source: "token",
				label: "Token account [id:3c2a4a]",
				isDefault: true,
			},
		]);
		vi.mocked(accountsModule.selectBestAccountCandidate).mockImplementationOnce((candidates) =>
			candidates.find((c) => c.source === "org") ?? candidates[0],
		);

		const mockClient = createMockClient();
		const { OpenAIOAuthPlugin } = await import("../index.js");
		const plugin = await OpenAIOAuthPlugin({ client: mockClient } as never) as unknown as PluginType;
		const autoMethod = plugin.auth.methods[0] as unknown as {
			authorize: (inputs?: Record<string, string>) => Promise<{ instructions: string }>;
		};

		await autoMethod.authorize({ loginMode: "add", accountCount: "1" });

		// accountId values differ ("org-QA1bZCn6zb57FT6TXLZWMPO3" vs "e4692e53-2f30-42a0-b8df-3a685d3c2a4a")
		// so both entries should be preserved despite sharing the same refreshToken.
		expect(mockStorage.accounts).toHaveLength(2);
		const accountIds = mockStorage.accounts.map((account) => account.accountId);
		expect(accountIds).toContain("org-QA1bZCn6zb57FT6TXLZWMPO3");
		expect(accountIds).toContain("e4692e53-2f30-42a0-b8df-3a685d3c2a4a");
		expect(mockStorage.accounts.every((account) => account.refreshToken === "refresh-holly-shared")).toBe(true);
	});

	it("updates a unique org-scoped entry when later login lacks organization metadata", async () => {
		const accountsModule = await import("../lib/accounts.js");
		const authModule = await import("../lib/auth/auth.js");

		vi.mocked(authModule.exchangeAuthorizationCode)
			.mockResolvedValueOnce({
				type: "success",
				access: "access-org-initial",
				refresh: "refresh-unique",
				expires: Date.now() + 300_000,
				idToken: "id-org-initial",
			})
			.mockResolvedValueOnce({
				type: "success",
				access: "access-no-org-update",
				refresh: "refresh-unique",
				expires: Date.now() + 300_000,
				idToken: "id-no-org-update",
			});
		vi.mocked(accountsModule.getAccountIdCandidates)
			.mockReturnValueOnce([
				{
					accountId: "shared-account",
					organizationId: "org-unique",
					source: "org",
					label: "Workspace Unique [id:nique]",
				},
			])
			.mockReturnValueOnce([]);
		vi.mocked(accountsModule.selectBestAccountCandidate).mockImplementation(
			(candidates) => candidates[0],
		);
		vi.mocked(accountsModule.extractAccountId).mockImplementation((accessToken) =>
			accessToken === "access-no-org-update" ? "shared-account" : "account-1",
		);

		const mockClient = createMockClient();
		const { OpenAIOAuthPlugin } = await import("../index.js");
		const plugin = (await OpenAIOAuthPlugin({
			client: mockClient,
		} as never)) as unknown as PluginType;
		const autoMethod = plugin.auth.methods[0] as unknown as {
			authorize: (inputs?: Record<string, string>) => Promise<{ instructions: string }>;
		};

		await autoMethod.authorize({ loginMode: "add", accountCount: "1" });
		await autoMethod.authorize({ loginMode: "add", accountCount: "1" });

		expect(mockStorage.accounts).toHaveLength(1);
		expect(mockStorage.accounts[0]?.organizationId).toBe("org-unique");
		expect(mockStorage.accounts[0]?.accountId).toBe("shared-account");
		expect(mockStorage.accounts[0]?.accessToken).toBe("access-no-org-update");
	});

	it("preserves org-scoped variants when organizationId differs despite shared account/refresh context", async () => {
		const accountsModule = await import("../lib/accounts.js");
		const authModule = await import("../lib/auth/auth.js");

		mockStorage.accounts = [
			{
				organizationId: "org-a",
				accountId: "shared-account",
				email: "user@example.com",
				refreshToken: "shared-refresh",
				addedAt: Date.now() - 20_000,
				lastUsed: Date.now() - 20_000,
			},
			{
				organizationId: "org-b",
				accountId: "shared-account",
				email: "user@example.com",
				refreshToken: "shared-refresh",
				addedAt: Date.now() - 10_000,
				lastUsed: Date.now() - 10_000,
			},
		];

		vi.mocked(authModule.exchangeAuthorizationCode).mockResolvedValueOnce({
			type: "success",
			access: "access-ambiguous",
			refresh: "shared-refresh",
			expires: Date.now() + 300_000,
			idToken: "id-ambiguous",
		});
		vi.mocked(accountsModule.getAccountIdCandidates).mockReturnValueOnce([]);
		vi.mocked(accountsModule.extractAccountId).mockImplementation((accessToken) =>
			accessToken === "access-ambiguous" ? "shared-account" : "account-1",
		);

		const mockClient = createMockClient();
		const { OpenAIOAuthPlugin } = await import("../index.js");
		const plugin = (await OpenAIOAuthPlugin({
			client: mockClient,
		} as never)) as unknown as PluginType;
		const autoMethod = plugin.auth.methods[0] as unknown as {
			authorize: (inputs?: Record<string, string>) => Promise<{ instructions: string }>;
		};

		await autoMethod.authorize({ loginMode: "add", accountCount: "1" });

		expect(mockStorage.accounts).toHaveLength(2);
		const orgScopedEntries = mockStorage.accounts.filter((account) => account.organizationId);
		expect(orgScopedEntries).toHaveLength(2);
		expect(orgScopedEntries.map((account) => account.organizationId).sort()).toEqual([
			"org-a",
			"org-b",
		]);
		expect(orgScopedEntries.some((account) => account.accessToken === "access-ambiguous")).toBe(true);
		expect(mockStorage.activeIndex).toBe(0);
		expect(mockStorage.activeIndexByFamily).toEqual({});
	});

	it("preserves entries with different accountId values even when they share the same refresh token (org-scoped vs no-org)", async () => {
		const accountsModule = await import("../lib/accounts.js");
		const authModule = await import("../lib/auth/auth.js");

		mockStorage.accounts = [
			{
				accountId: "other-a",
				email: "other-a@example.com",
				refreshToken: "refresh-a",
				addedAt: 1,
				lastUsed: 1,
			},
			{
				accountId: "org-shared",
				organizationId: "org-keep",
				email: "org@example.com",
				refreshToken: "shared-refresh",
				addedAt: 5,
				lastUsed: 5,
			},
			{
				accountId: "token-shared",
				email: "token@example.com",
				refreshToken: "shared-refresh",
				addedAt: 10,
				lastUsed: 10,
			},
			{
				accountId: "other-b",
				email: "other-b@example.com",
				refreshToken: "refresh-b",
				addedAt: 2,
				lastUsed: 2,
			},
		];
		mockStorage.activeIndex = 2;
		mockStorage.activeIndexByFamily = { codex: 2, "gpt-5.1": 2 };

		vi.mocked(authModule.exchangeAuthorizationCode).mockResolvedValueOnce({
			type: "success",
			access: "access-other-a",
			refresh: "refresh-a",
			expires: Date.now() + 300_000,
			idToken: "id-other-a",
		});
		vi.mocked(accountsModule.getAccountIdCandidates).mockReturnValueOnce([]);
		vi.mocked(accountsModule.extractAccountId).mockImplementation((accessToken) =>
			accessToken === "access-other-a" ? "other-a" : "account-1",
		);

		const mockClient = createMockClient();
		const { OpenAIOAuthPlugin } = await import("../index.js");
		const plugin = (await OpenAIOAuthPlugin({
			client: mockClient,
		} as never)) as unknown as PluginType;
		const autoMethod = plugin.auth.methods[0] as unknown as {
			authorize: (inputs?: Record<string, string>) => Promise<{ instructions: string }>;
		};

		await autoMethod.authorize({ loginMode: "add", accountCount: "1" });

		// accountId values differ ("org-shared" vs "token-shared") so both should be preserved
		// despite sharing the same refreshToken. Active index should still be remapped correctly.
		expect(mockStorage.accounts).toHaveLength(4);
		const accountIds = mockStorage.accounts.map((account) => account.accountId);
		expect(accountIds).toContain("org-shared");
		expect(accountIds).toContain("token-shared");
		expect(mockStorage.activeIndex).toBe(2);
		expect(mockStorage.activeIndexByFamily).toEqual({ codex: 2, "gpt-5.1": 2 });
	});

	it("keeps latest rate-limit reset windows when collapsing same-organization duplicates", async () => {
		const accountsModule = await import("../lib/accounts.js");
		const authModule = await import("../lib/auth/auth.js");

		mockStorage.accounts = [
			{
				accountId: "org-shared",
				organizationId: "org-keep",
				email: "org@example.com",
				refreshToken: "shared-refresh",
				addedAt: 10,
				lastUsed: 10,
				rateLimitResetTimes: {
					codex: 1_000,
					"codex-max": 5_000,
				},
			},
			{
				accountId: "org-shared",
				organizationId: "org-keep",
				email: "token@example.com",
				refreshToken: "shared-refresh",
				addedAt: 20,
				lastUsed: 20,
				rateLimitResetTimes: {
					codex: 9_000,
					"gpt-5.1": 8_000,
				},
			},
		];

		vi.mocked(authModule.exchangeAuthorizationCode).mockResolvedValueOnce({
			type: "success",
			access: "access-unrelated",
			refresh: "refresh-unrelated",
			expires: Date.now() + 300_000,
			idToken: "id-unrelated",
		});
		vi.mocked(accountsModule.getAccountIdCandidates).mockReturnValueOnce([]);
		vi.mocked(accountsModule.extractAccountId).mockImplementation((accessToken) =>
			accessToken === "access-unrelated" ? "unrelated" : "account-1",
		);

		const mockClient = createMockClient();
		const { OpenAIOAuthPlugin } = await import("../index.js");
		const plugin = (await OpenAIOAuthPlugin({
			client: mockClient,
		} as never)) as unknown as PluginType;
		const autoMethod = plugin.auth.methods[0] as unknown as {
			authorize: (inputs?: Record<string, string>) => Promise<{ instructions: string }>;
		};

		await autoMethod.authorize({ loginMode: "add", accountCount: "1" });

		const mergedOrgEntries = mockStorage.accounts.filter(
			(account) => account.organizationId === "org-keep",
		);
		expect(mergedOrgEntries).toHaveLength(1);
		const mergedOrg = mergedOrgEntries[0];
		expect(mergedOrg?.accountId).toBe("org-shared");
		expect(mergedOrg?.rateLimitResetTimes?.codex).toBe(9_000);
		expect(mergedOrg?.rateLimitResetTimes?.["codex-max"]).toBe(5_000);
		expect(mergedOrg?.rateLimitResetTimes?.["gpt-5.1"]).toBe(8_000);
	});

	it("keeps restrictive enabled/cooldown metadata when collapsing same-organization duplicates", async () => {
		const accountsModule = await import("../lib/accounts.js");
		const authModule = await import("../lib/auth/auth.js");

		mockStorage.accounts = [
			{
				accountId: "org-shared",
				organizationId: "org-keep",
				email: "org@example.com",
				refreshToken: "shared-refresh",
				enabled: true,
				addedAt: 10,
				lastUsed: 10,
			},
			{
				accountId: "org-shared",
				organizationId: "org-keep",
				email: "token@example.com",
				refreshToken: "shared-refresh",
				enabled: false,
				coolingDownUntil: 12_000,
				cooldownReason: "auth-failure",
				addedAt: 20,
				lastUsed: 20,
			},
		];

		vi.mocked(authModule.exchangeAuthorizationCode).mockResolvedValueOnce({
			type: "success",
			access: "access-unrelated-cooling",
			refresh: "refresh-unrelated-cooling",
			expires: Date.now() + 300_000,
			idToken: "id-unrelated-cooling",
		});
		vi.mocked(accountsModule.getAccountIdCandidates).mockReturnValueOnce([]);
		vi.mocked(accountsModule.extractAccountId).mockImplementation((accessToken) =>
			accessToken === "access-unrelated-cooling" ? "unrelated-cooling" : "account-1",
		);

		const mockClient = createMockClient();
		const { OpenAIOAuthPlugin } = await import("../index.js");
		const plugin = (await OpenAIOAuthPlugin({
			client: mockClient,
		} as never)) as unknown as PluginType;
		const autoMethod = plugin.auth.methods[0] as unknown as {
			authorize: (inputs?: Record<string, string>) => Promise<{ instructions: string }>;
		};

		await autoMethod.authorize({ loginMode: "add", accountCount: "1" });

		const mergedOrgEntries = mockStorage.accounts.filter(
			(account) => account.organizationId === "org-keep",
		);
		expect(mergedOrgEntries).toHaveLength(1);
		const mergedOrg = mergedOrgEntries[0];
		expect(mergedOrg?.accountId).toBe("org-shared");
		expect(mergedOrg?.enabled).toBe(false);
		expect(mergedOrg?.coolingDownUntil).toBe(12_000);
		expect(mergedOrg?.cooldownReason).toBe("auth-failure");
	});

	it("preserves same-organization entries when accountId differs", async () => {
		const accountsModule = await import("../lib/accounts.js");
		const authModule = await import("../lib/auth/auth.js");

		mockStorage.accounts = [
			{
				accountId: "org-shared-a",
				organizationId: "org-keep",
				email: "org-a@example.com",
				refreshToken: "shared-refresh",
				addedAt: 10,
				lastUsed: 10,
			},
			{
				accountId: "org-shared-b",
				organizationId: "org-keep",
				email: "org-b@example.com",
				refreshToken: "shared-refresh",
				addedAt: 20,
				lastUsed: 20,
			},
		];

		vi.mocked(authModule.exchangeAuthorizationCode).mockResolvedValueOnce({
			type: "success",
			access: "access-unrelated-preserve",
			refresh: "refresh-unrelated-preserve",
			expires: Date.now() + 300_000,
			idToken: "id-unrelated-preserve",
		});
		vi.mocked(accountsModule.getAccountIdCandidates).mockReturnValueOnce([]);
		vi.mocked(accountsModule.extractAccountId).mockImplementation((accessToken) =>
			accessToken === "access-unrelated-preserve" ? "unrelated-preserve" : "account-1",
		);

		const mockClient = createMockClient();
		const { OpenAIOAuthPlugin } = await import("../index.js");
		const plugin = (await OpenAIOAuthPlugin({
			client: mockClient,
		} as never)) as unknown as PluginType;
		const autoMethod = plugin.auth.methods[0] as unknown as {
			authorize: (inputs?: Record<string, string>) => Promise<{ instructions: string }>;
		};

		await autoMethod.authorize({ loginMode: "add", accountCount: "1" });

		const orgEntries = mockStorage.accounts.filter(
			(account) => account.organizationId === "org-keep",
		);
		expect(orgEntries).toHaveLength(2);
		const accountIds = orgEntries.map((account) => account.accountId).sort();
		expect(accountIds).toEqual(["org-shared-a", "org-shared-b"]);
	});

	it("persists non-team login and updates same record via accountId/refresh fallback", async () => {
		const accountsModule = await import("../lib/accounts.js");
		const authModule = await import("../lib/auth/auth.js");

		vi.mocked(authModule.exchangeAuthorizationCode)
			.mockResolvedValueOnce({
				type: "success",
				access: "access-no-org-1",
				refresh: "refresh-shared",
				expires: Date.now() + 300_000,
				idToken: "id-no-org-1",
			})
			.mockResolvedValueOnce({
				type: "success",
				access: "access-no-org-2",
				refresh: "refresh-shared",
				expires: Date.now() + 300_000,
				idToken: "id-no-org-2",
			});
		vi.mocked(accountsModule.getAccountIdCandidates).mockReturnValue([]);
		vi.mocked(accountsModule.extractAccountId)
			.mockReturnValueOnce("account-1")
			.mockReturnValueOnce(undefined);

		const mockClient = createMockClient();
		const { OpenAIOAuthPlugin } = await import("../index.js");
		const plugin = await OpenAIOAuthPlugin({ client: mockClient } as never) as unknown as PluginType;
		const autoMethod = plugin.auth.methods[0] as unknown as {
			authorize: (inputs?: Record<string, string>) => Promise<{ instructions: string }>;
		};

		await autoMethod.authorize({ loginMode: "add", accountCount: "1" });
		await autoMethod.authorize({ loginMode: "add", accountCount: "1" });

		expect(mockStorage.accounts).toHaveLength(1);
		expect(mockStorage.accounts[0]?.organizationId).toBeUndefined();
		expect(mockStorage.accounts[0]?.accountId).toBe("account-1");
		expect(mockStorage.accounts[0]?.refreshToken).toBe("refresh-shared");
		expect(mockStorage.accounts[0]?.accessToken).toBe("access-no-org-2");
	});

	it("preserves flagged organization identity during verify-flagged restore for cached and refreshed paths", async () => {
		const cliModule = await import("../lib/cli.js");
		const storageModule = await import("../lib/storage.js");
		const accountsModule = await import("../lib/accounts.js");
		const refreshQueueModule = await import("../lib/refresh-queue.js");

		const flaggedAccounts = [
			{
				refreshToken: "flagged-refresh-cache",
				organizationId: "org-cache",
				accountId: "flagged-cache",
				accountIdSource: "manual",
				accountLabel: "Cache Workspace",
				email: "cache@example.com",
				flaggedAt: Date.now() - 1000,
				addedAt: Date.now() - 1000,
				lastUsed: Date.now() - 1000,
			},
			{
				refreshToken: "flagged-refresh-live",
				organizationId: "org-refresh",
				accountId: "flagged-live",
				accountIdSource: "manual",
				accountLabel: "Refresh Workspace",
				email: "refresh@example.com",
				flaggedAt: Date.now() - 500,
				addedAt: Date.now() - 500,
				lastUsed: Date.now() - 500,
			},
		];

		vi.mocked(cliModule.promptLoginMode)
			.mockResolvedValueOnce({ mode: "verify-flagged" })
			.mockResolvedValueOnce({ mode: "cancel" });

		vi.mocked(storageModule.loadFlaggedAccounts)
			.mockResolvedValueOnce({
				version: 1,
				accounts: flaggedAccounts,
			})
			.mockResolvedValueOnce({
				version: 1,
				accounts: flaggedAccounts,
			})
			.mockResolvedValueOnce({
				version: 1,
				accounts: [],
			});

		vi.mocked(accountsModule.lookupCodexCliTokensByEmail).mockImplementation(async (email) => {
			if (email === "cache@example.com") {
				return {
					accessToken: "cached-access",
					refreshToken: "cached-refresh",
					expiresAt: Date.now() + 60_000,
				};
			}
			return null;
		});
		vi.mocked(accountsModule.getAccountIdCandidates).mockReturnValue([
			{
				accountId: "token-shared",
				source: "token",
				label: "Token Shared [id:shared]",
			},
		]);
		vi.mocked(accountsModule.selectBestAccountCandidate).mockImplementation(
			(candidates) => candidates[0] ?? null,
		);

		const mockClient = createMockClient();
		const { OpenAIOAuthPlugin } = await import("../index.js");
		const plugin = (await OpenAIOAuthPlugin({
			client: mockClient,
		} as never)) as unknown as PluginType;
		const autoMethod = plugin.auth.methods[0] as unknown as {
			authorize: (inputs?: Record<string, string>) => Promise<{ instructions: string }>;
		};

		const authResult = await autoMethod.authorize();
		expect(authResult.instructions).toBe("Authentication cancelled");

		expect(vi.mocked(refreshQueueModule.queuedRefresh)).toHaveBeenCalledTimes(1);
		expect(mockStorage.accounts).toHaveLength(2);
		expect(new Set(mockStorage.accounts.map((account) => account.organizationId))).toEqual(
			new Set(["org-cache", "org-refresh"]),
		);
		expect(vi.mocked(storageModule.saveFlaggedAccounts)).toHaveBeenCalledWith({
			version: 1,
			accounts: [],
		});
	});
});

describe("OpenAIOAuthPlugin showToast error handling", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockStorage.accounts = [
			{ accountId: "acc-1", email: "user@example.com", refreshToken: "refresh-1" },
		];
		mockStorage.activeIndex = 0;
		mockStorage.activeIndexByFamily = {};
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("handles TUI unavailable gracefully", async () => {
		const mockClient = {
			tui: {
				showToast: vi.fn().mockRejectedValue(new Error("TUI unavailable")),
			},
			auth: { set: vi.fn() },
			session: { prompt: vi.fn() },
		};

		const { OpenAIOAuthPlugin } = await import("../index.js");
		const plugin = await OpenAIOAuthPlugin({ client: mockClient } as never) as unknown as PluginType;

		const result = await plugin.tool["codex-switch"].execute({ index: 1 });
		expect(result).toContain("Switched to account");
	});
});

describe("OpenAIOAuthPlugin event handler edge cases", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockStorage.accounts = [
			{ accountId: "acc-1", email: "user1@example.com", refreshToken: "refresh-1" },
			{ accountId: "acc-2", email: "user2@example.com", refreshToken: "refresh-2" },
		];
		mockStorage.activeIndex = 0;
		mockStorage.activeIndexByFamily = {};
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("handles account.select with accountIndex property", async () => {
		const mockClient = createMockClient();
		const { OpenAIOAuthPlugin } = await import("../index.js");
		const plugin = await OpenAIOAuthPlugin({ client: mockClient } as never) as unknown as PluginType;

		const getAuth = async () => ({
			type: "oauth" as const,
			access: "access-token",
			refresh: "refresh-token",
			expires: Date.now() + 60_000,
			multiAccount: true,
		});

		await plugin.auth.loader(getAuth, { options: {}, models: {} });

		await plugin.event({
			event: { type: "account.select", properties: { accountIndex: 1 } },
		});
	});

	it("reloads account manager from disk when handling account.select", async () => {
		const mockClient = createMockClient();
		const { OpenAIOAuthPlugin } = await import("../index.js");
		const plugin = await OpenAIOAuthPlugin({ client: mockClient } as never) as unknown as PluginType;
		const { AccountManager } = await import("../lib/accounts.js");
		const loadFromDiskSpy = vi.spyOn(AccountManager, "loadFromDisk");

		const getAuth = async () => ({
			type: "oauth" as const,
			access: "access-token",
			refresh: "refresh-token",
			expires: Date.now() + 60_000,
			multiAccount: true,
		});

		await plugin.auth.loader(getAuth, { options: {}, models: {} });
		loadFromDiskSpy.mockClear();

		await plugin.event({
			event: { type: "account.select", properties: { index: 1 } },
		});

		expect(loadFromDiskSpy).toHaveBeenCalledTimes(1);
	});

	it("handles openai.account.select with openai provider", async () => {
		const mockClient = createMockClient();
		const { OpenAIOAuthPlugin } = await import("../index.js");
		const plugin = await OpenAIOAuthPlugin({ client: mockClient } as never) as unknown as PluginType;

		const getAuth = async () => ({
			type: "oauth" as const,
			access: "access-token",
			refresh: "refresh-token",
			expires: Date.now() + 60_000,
			multiAccount: true,
		});

		await plugin.auth.loader(getAuth, { options: {}, models: {} });

		await plugin.event({
			event: {
				type: "openai.account.select",
				properties: { provider: "openai", index: 0 },
			},
		});
	});

	it("ignores account.select when cachedAccountManager is null", async () => {
		const mockClient = createMockClient();
		const { OpenAIOAuthPlugin } = await import("../index.js");
		const plugin = await OpenAIOAuthPlugin({ client: mockClient } as never) as unknown as PluginType;

		await plugin.event({
			event: { type: "account.select", properties: { index: 0 } },
		});
	});

	it("handles non-numeric index gracefully", async () => {
		const mockClient = createMockClient();
		const { OpenAIOAuthPlugin } = await import("../index.js");
		const plugin = await OpenAIOAuthPlugin({ client: mockClient } as never) as unknown as PluginType;

		await plugin.event({
			event: { type: "account.select", properties: { index: "invalid" } },
		});
	});

	it("ignores account.select with an out-of-bounds index", async () => {
		const mockClient = createMockClient();
		const { OpenAIOAuthPlugin } = await import("../index.js");
		const plugin = await OpenAIOAuthPlugin({ client: mockClient } as never) as unknown as PluginType;

		const getAuth = async () => ({
			type: "oauth" as const,
			access: "access-token",
			refresh: "refresh-token",
			expires: Date.now() + 60_000,
			multiAccount: true,
		});

		await plugin.auth.loader(getAuth, { options: {}, models: {} });

		await expect(
			plugin.event({
				event: { type: "account.select", properties: { index: 99 } },
			}),
		).resolves.toBeUndefined();
		expect(mockStorage.activeIndex).toBe(0);
		expect(mockStorage.activeIndexByFamily).toEqual({});
	});
});
