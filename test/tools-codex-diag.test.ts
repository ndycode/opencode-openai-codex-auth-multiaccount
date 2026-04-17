import { beforeEach, describe, expect, it } from "vitest";

import {
	clearCircuitBreakers,
	getCircuitBreaker,
} from "../lib/circuit-breaker.js";
import type { ToolContext } from "../lib/tools/index.js";
import { createCodexDiagTool } from "../lib/tools/codex-diag.js";
import type { RuntimeMetrics, RoutingVisibilitySnapshot } from "../lib/runtime.js";

function buildRuntimeMetrics(
	overrides: Partial<RuntimeMetrics> = {},
): RuntimeMetrics {
	return {
		startedAt: Date.now() - 1234,
		totalRequests: 10,
		successfulRequests: 8,
		failedRequests: 2,
		rateLimitedResponses: 0,
		serverErrors: 0,
		networkErrors: 1,
		authRefreshFailures: 0,
		emptyResponseRetries: 0,
		accountRotations: 1,
		cumulativeLatencyMs: 2500,
		retryBudgetExhaustions: 0,
		retryBudgetUsage: {
			authRefresh: 0,
			network: 1,
			server: 0,
			rateLimitShort: 0,
			rateLimitGlobal: 0,
			emptyResponse: 0,
		},
		retryBudgetLimits: {
			authRefresh: 3,
			network: 3,
			server: 3,
			rateLimitShort: 3,
			rateLimitGlobal: 3,
			emptyResponse: 3,
		},
		retryProfile: "standard",
		lastRetryBudgetExhaustedClass: null,
		lastRetryBudgetReason: null,
		lastRequestAt: null,
		lastError: null,
		lastErrorCategory: null,
		promptCacheEnabledRequests: 0,
		promptCacheMissingRequests: 0,
		lastPromptCacheKey: null,
		lastSelectedAccountIndex: null,
		lastQuotaKey: null,
		lastSelectionSnapshot: null,
		...overrides,
	};
}

function buildRouting(
	overrides: Partial<RoutingVisibilitySnapshot> = {},
): RoutingVisibilitySnapshot {
	return {
		requestedModel: null,
		effectiveModel: null,
		modelFamily: null,
		quotaKey: null,
		selectedAccountIndex: null,
		zeroBasedSelectedAccountIndex: null,
		lastErrorCategory: null,
		fallbackApplied: false,
		fallbackFrom: null,
		fallbackTo: null,
		fallbackReason: null,
		selectionExplainability: [],
		...overrides,
	};
}

function buildCtx(options: {
	accountCount?: number;
	metrics?: RuntimeMetrics;
	routing?: RoutingVisibilitySnapshot;
}): ToolContext {
	const metrics = options.metrics ?? buildRuntimeMetrics();
	const routing = options.routing ?? buildRouting();
	const ctx = {
		cachedAccountManagerRef: {
			current:
				options.accountCount === undefined
					? null
					: {
							getAccountCount: () => options.accountCount ?? 0,
						},
		},
		accountManagerPromiseRef: { current: null },
		runtimeMetrics: metrics,
		beginnerSafeModeRef: { current: false },
		buildRoutingVisibilitySnapshot: () => routing,
	};
	return ctx as unknown as ToolContext;
}

describe("codex-diag tool", () => {
	beforeEach(() => {
		clearCircuitBreakers();
	});

	it("returns JSON with the expected top-level keys", async () => {
		const tool = createCodexDiagTool(buildCtx({ accountCount: 2 }));
		const raw = await tool.execute({}, {} as never);
		const parsed = JSON.parse(raw);
		expect(parsed).toMatchObject({
			plugin: { name: expect.any(String), version: expect.any(String) },
			runtime: {
				node: expect.any(String),
				platform: expect.any(String),
				arch: expect.any(String),
			},
			accounts: { count: 2 },
			circuitBreaker: {
				total: { closed: 0, open: 0, halfOpen: 0 },
				byGroup: {},
			},
			metrics: expect.objectContaining({
				totalRequests: 10,
				retryProfile: "standard",
			}),
			redactionApplied: true,
		});
		expect(typeof parsed.generatedAt).toBe("string");
	});

	it("reports accounts.count=0 when no manager is cached", async () => {
		const tool = createCodexDiagTool(buildCtx({}));
		const raw = await tool.execute({}, {} as never);
		const parsed = JSON.parse(raw);
		expect(parsed.accounts.count).toBe(0);
	});

	it("summarizes circuit breakers by group without leaking keys", async () => {
		// Seed three breakers; two fail enough times to open.
		const a = getCircuitBreaker("account:A");
		const b = getCircuitBreaker("account:B");
		getCircuitBreaker("account:C");
		for (const breaker of [a, b]) {
			breaker.recordFailure();
			breaker.recordFailure();
			breaker.recordFailure();
		}
		const tool = createCodexDiagTool(buildCtx({ accountCount: 3 }));
		const raw = await tool.execute({}, {} as never);
		const parsed = JSON.parse(raw);
		expect(parsed.circuitBreaker.total).toEqual({
			closed: 1,
			open: 2,
			halfOpen: 0,
		});
		expect(parsed.circuitBreaker.byGroup).toEqual({
			account: { closed: 1, open: 2, halfOpen: 0 },
		});
		// The grouped summary must NOT embed the account-level keys.
		expect(raw).not.toContain("account:A");
		expect(raw).not.toContain("account:B");
		expect(raw).not.toContain("account:C");
	});

	it("reports the active model family from the routing snapshot", async () => {
		const tool = createCodexDiagTool(
			buildCtx({ routing: buildRouting({ modelFamily: "gpt-5.4" }) }),
		);
		const raw = await tool.execute({}, {} as never);
		const parsed = JSON.parse(raw);
		expect(parsed.activeFamily).toBe("gpt-5.4");
	});

	it("redacts JWT-shaped tokens present anywhere in the metrics payload", async () => {
		// A future leak vector: a token accidentally stored in lastError.
		const leakyToken =
			"eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ0ZXN0In0.abcdefghij";
		const metrics = buildRuntimeMetrics({
			lastError: `upstream said: Bearer ${leakyToken}`,
		});
		const tool = createCodexDiagTool(buildCtx({ metrics }));
		const raw = await tool.execute({}, {} as never);
		expect(raw).not.toContain(leakyToken);
		// Whichever masker catches it, the token must not survive verbatim.
	});

	it("does not leak the user's home directory path", async () => {
		const tool = createCodexDiagTool(buildCtx({ accountCount: 1 }));
		const raw = await tool.execute({}, {} as never);
		// `<HOME>` placeholder is used whether or not the log dir exists.
		// If the real home path leaked, it would appear in the string; this
		// asserts the redaction path ran.
		const home = (await import("node:os")).homedir();
		if (home) {
			expect(raw).not.toContain(home);
		}
	});

	it("indicates 'no log file' when the log directory is absent", async () => {
		const tool = createCodexDiagTool(buildCtx({}));
		const raw = await tool.execute({}, {} as never);
		const parsed = JSON.parse(raw);
		// At minimum, the `logs` key is present and describes state rather
		// than including file contents.
		expect(parsed.logs).toBeDefined();
		if (parsed.logs.note === "no log file") {
			expect(parsed.logs.directory).toBeUndefined();
			expect(parsed.logs.fileCount).toBeUndefined();
		} else {
			expect(parsed.logs.directory).toBe(
				"<HOME>/.opencode/logs/codex-plugin",
			);
			expect(typeof parsed.logs.fileCount).toBe("number");
			expect(parsed.logs).not.toHaveProperty("contents");
		}
	});

	it("returns only aggregate counts — no account IDs or per-account keys", async () => {
		const tool = createCodexDiagTool(buildCtx({ accountCount: 5 }));
		const raw = await tool.execute({}, {} as never);
		// The snapshot exposes a COUNT, not a list.
		const parsed = JSON.parse(raw);
		expect(parsed.accounts).toEqual({ count: 5 });
		expect(parsed.accounts).not.toHaveProperty("list");
		expect(parsed.accounts).not.toHaveProperty("items");
	});
});
