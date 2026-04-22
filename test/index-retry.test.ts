import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@opencode-ai/plugin/tool", () => {
	const makeSchema = () => ({
		optional: () => makeSchema(),
		describe: () => makeSchema(),
	});

	const tool = (definition: any) => definition;
	(tool as any).schema = {
		number: () => makeSchema(),
		boolean: () => makeSchema(),
		string: () => makeSchema(),
	};

	return { tool };
});

vi.mock("../lib/request/fetch-helpers.js", () => ({
	extractRequestUrl: (input: any) => (typeof input === "string" ? input : String(input)),
	rewriteUrlForCodex: (url: string) => url,
	transformRequestForCodex: async (init: any) => ({ updatedInit: init, body: { model: "gpt-5.1" } }),
	shouldRefreshToken: () => false,
	refreshAndUpdateToken: async (auth: any) => auth,
	createCodexHeaders: () => new Headers(),
	handleErrorResponse: async (response: Response) => {
		try {
			const body = await response.clone().json();
			const error = body?.error;
			const code = error?.code;
			const type = error?.type;
			const contextType = error?.context?.type;
			if (
				code === "server_is_overloaded" ||
				type === "service_unavailable_error" ||
				contextType === "service_unavailable_error" ||
				(code === "server_error" && type === "server_error")
			) {
				return { response, errorBody: body, retryAsServerError: true };
			}
		} catch {
			// Non-JSON responses are irrelevant to this focused retry regression.
		}

		return { response };
	},
	isDeactivatedWorkspaceError: () => false,
	resolveUnsupportedCodexFallbackModel: () => undefined,
	getUnsupportedCodexModelInfo: () => ({
		isUnsupported: false,
		unsupportedModel: undefined,
		message: undefined,
	}),
	shouldFallbackToGpt52OnUnsupportedGpt53: () => false,
	handleSuccessResponse: async (response: Response) => response,
}));

vi.mock("../lib/request/request-transformer.js", () => ({
	applyFastSessionDefaults: <T>(config: T) => config,
}));

vi.mock("../lib/accounts.js", () => {
	class AccountManager {
		private calls = 0;
		private readonly accounts = [
			null,
			{ index: 0, accountId: "account-1", email: "user@example.com" },
			{ index: 1, accountId: "account-2", email: "second@example.com" },
		] as const;

		static async loadFromDisk() {
			return new AccountManager();
		}

		getAccountCount() {
			return 2;
		}

		getCurrentOrNextForFamily() {
			const account = this.accounts[Math.min(this.calls, this.accounts.length - 1)];
			this.calls += 1;
			return account;
		}

		getCurrentOrNextForFamilyHybrid() {
			return this.getCurrentOrNextForFamily();
		}

		getSelectionExplainability() {
			return [];
		}

		recordSuccess() {}

		recordRateLimit() {}

		recordFailure() {}

	toAuthDetails() {
		return {
			type: "oauth",
			access: "access-token",
			refresh: "refresh-token",
			expires: Date.now() + 60_000,
		};
	}

	hasRefreshToken(_token: string) {
		return true;
	}

	saveToDiskDebounced() {}

	updateFromAuth() {}

		async saveToDisk() {}

		markAccountCoolingDown() {}

		markRateLimited() {}

		markRateLimitedWithReason() {}

		consumeToken() { return true; }

		refundToken() {}

		markSwitched() {}

		getMinWaitTimeForFamily() {
			return 1000;
		}

		shouldShowAccountToast() {
			return false;
		}

		markToastShown() {}
	}

	return {
		AccountManager,
		extractAccountEmail: () => "user@example.com",
		extractAccountId: () => "account-1",
		selectBestAccountCandidate: (candidates: Array<{ accountId: string }>) => candidates[0] ?? null,
		resolveRequestAccountId: (_storedId: string | undefined, _source: string | undefined, tokenId: string | undefined) => tokenId,
		formatAccountLabel: (_account: any, index: number) => `Account ${index + 1}`,
		formatCooldown: (ms: number) => `${ms}ms`,
		formatWaitTime: (ms: number) => `${ms}ms`,
		sanitizeEmail: (email: string) => email,
		parseRateLimitReason: () => "unknown",
		lookupCodexCliTokensByEmail: vi.fn(async () => null),
	};
});

vi.mock("../lib/storage.js", () => ({
	getStoragePath: () => "",
	loadAccounts: async () => null,
	saveAccounts: async () => {},
	setStoragePath: () => {},
	exportAccounts: async () => {},
	importAccounts: async () => ({ imported: 0, total: 0 }),
	previewImportAccounts: async () => ({ imported: 0, total: 0, skipped: 0 }),
	createTimestampedBackupPath: () => "/tmp/codex-backup-test.json",
}));

vi.mock("../lib/auto-update-checker.js", () => ({
	checkAndNotify: async () => {},
	checkForUpdates: async () => ({ hasUpdate: false, currentVersion: "4.5.0", latestVersion: null, updateCommand: "" }),
	clearUpdateCache: () => {},
}));

describe("OpenAIAuthPlugin rate-limit retry", () => {
	const envKeys = [
		"CODEX_AUTH_RETRY_ALL_RATE_LIMITED",
		"CODEX_AUTH_RETRY_ALL_MAX_WAIT_MS",
		"CODEX_AUTH_RETRY_ALL_MAX_RETRIES",
		"CODEX_AUTH_TOKEN_REFRESH_SKEW_MS",
		"CODEX_AUTH_RATE_LIMIT_TOAST_DEBOUNCE_MS",
		"CODEX_AUTH_PREWARM",
	] as const;

	const originalEnv: Record<string, string | undefined> = {};
	let originalFetch: any;

	beforeEach(() => {
		for (const key of envKeys) originalEnv[key] = process.env[key];

		process.env.CODEX_AUTH_RETRY_ALL_RATE_LIMITED = "1";
		process.env.CODEX_AUTH_RETRY_ALL_MAX_WAIT_MS = "5000";
		process.env.CODEX_AUTH_RETRY_ALL_MAX_RETRIES = "1";
		process.env.CODEX_AUTH_TOKEN_REFRESH_SKEW_MS = "0";
		process.env.CODEX_AUTH_RATE_LIMIT_TOAST_DEBOUNCE_MS = "0";
		process.env.CODEX_AUTH_PREWARM = "0";

		vi.useFakeTimers();
		originalFetch = globalThis.fetch;
		globalThis.fetch = vi.fn(async () => new Response("ok", { status: 200 })) as any;
	});

	afterEach(() => {
		vi.useRealTimers();
		globalThis.fetch = originalFetch;

		for (const key of envKeys) {
			const value = originalEnv[key];
			if (value === undefined) {
				delete process.env[key];
			} else {
				process.env[key] = value;
			}
		}

		vi.restoreAllMocks();
	});

	it("waits and retries when all accounts are rate-limited", async () => {
		const { OpenAIAuthPlugin } = (await import("../index.js")) as any;
		const client = {
			tui: { showToast: vi.fn() },
			auth: { set: vi.fn() },
		} as any;

		const plugin = await OpenAIAuthPlugin({ client } as any);

		const getAuth = async () => ({
			type: "oauth" as const,
			access: "a",
			refresh: "r",
			expires: Date.now() + 60_000,
			multiAccount: true,
		});

		const sdk = (await (plugin.auth as any).loader(getAuth, { options: {}, models: {} } as any)) as any;

		const fetchPromise = sdk.fetch("https://example.com", {});
		expect(globalThis.fetch).not.toHaveBeenCalled();

		await vi.advanceTimersByTimeAsync(1500);

		const response = await fetchPromise;
		expect(globalThis.fetch).toHaveBeenCalledTimes(1);
		expect(response.status).toBe(200);
	});

	it("retries when the upstream returns a live server_error payload", async () => {
		const { OpenAIAuthPlugin } = (await import("../index.js")) as any;
		const client = {
			tui: { showToast: vi.fn() },
			auth: { set: vi.fn() },
		} as any;

		const plugin = await OpenAIAuthPlugin({ client } as any);

		const getAuth = async () => ({
			type: "oauth" as const,
			access: "a",
			refresh: "r",
			expires: Date.now() + 60_000,
			multiAccount: true,
		});

		const sdk = (await (plugin.auth as any).loader(getAuth, { options: {}, models: {} } as any)) as any;
		const fetchMock = vi.mocked(globalThis.fetch);
		fetchMock.mockReset();
		fetchMock
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						sequence_number: 2,
						error: {
							type: "server_error",
							code: "server_error",
							message: "The server had an error processing your request.",
							param: null,
						},
					}),
					{ status: 400, headers: { "content-type": "application/json" } },
				),
			)
			.mockResolvedValueOnce(new Response("ok", { status: 200 }));

		const fetchPromise = sdk.fetch("https://example.com", {});
		expect(fetchMock).not.toHaveBeenCalled();

		await vi.advanceTimersByTimeAsync(1500);
		expect(fetchMock).toHaveBeenCalled();

		await vi.runAllTimersAsync();
		expect(fetchMock).toHaveBeenCalledTimes(2);

		const response = await fetchPromise;
		expect(response.status).toBe(200);
	});
});
