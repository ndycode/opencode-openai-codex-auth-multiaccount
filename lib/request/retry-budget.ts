/**
 * Retry budget utilities for per-error-class retry controls.
 */

export type RetryProfile = "conservative" | "balanced" | "aggressive";

export type RetryBudgetClass =
	| "authRefresh"
	| "network"
	| "server"
	| "rateLimitShort"
	| "rateLimitGlobal"
	| "emptyResponse";

export type RetryBudgetLimits = Record<RetryBudgetClass, number>;

export type RetryBudgetOverrides = Partial<RetryBudgetLimits>;

const PROFILE_LIMITS: Record<RetryProfile, RetryBudgetLimits> = {
	conservative: {
		authRefresh: 2,
		network: 2,
		server: 2,
		rateLimitShort: 2,
		rateLimitGlobal: 1,
		emptyResponse: 1,
	},
	balanced: {
		authRefresh: 4,
		network: 4,
		server: 4,
		rateLimitShort: 4,
		rateLimitGlobal: 3,
		emptyResponse: 2,
	},
	aggressive: {
		authRefresh: 8,
		network: 8,
		server: 8,
		rateLimitShort: 8,
		rateLimitGlobal: 10,
		emptyResponse: 4,
	},
};

const RETRY_BUDGET_CLASSES: RetryBudgetClass[] = [
	"authRefresh",
	"network",
	"server",
	"rateLimitShort",
	"rateLimitGlobal",
	"emptyResponse",
];

export function normalizeRetryBudgetValue(value: unknown): number | undefined {
	if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
	if (value < 0) return undefined;
	return Math.floor(value);
}

export function resolveRetryBudgetLimits(
	profile: RetryProfile,
	overrides?: RetryBudgetOverrides,
): RetryBudgetLimits {
	const base = PROFILE_LIMITS[profile] ?? PROFILE_LIMITS.balanced;
	const merged: RetryBudgetLimits = { ...base };
	if (!overrides) return merged;

	for (const bucket of RETRY_BUDGET_CLASSES) {
		const normalized = normalizeRetryBudgetValue(overrides[bucket]);
		if (normalized === undefined) continue;
		merged[bucket] = normalized;
	}
	return merged;
}

function createUsedCounters(): RetryBudgetLimits {
	return {
		authRefresh: 0,
		network: 0,
		server: 0,
		rateLimitShort: 0,
		rateLimitGlobal: 0,
		emptyResponse: 0,
	};
}

export class RetryBudgetTracker {
	private readonly used: RetryBudgetLimits = createUsedCounters();
	private readonly limits: RetryBudgetLimits;

	constructor(limits: RetryBudgetLimits) {
		this.limits = { ...limits };
	}

	consume(bucket: RetryBudgetClass): boolean {
		const limit = this.limits[bucket];
		if (!Number.isFinite(limit)) {
			this.used[bucket] += 1;
			return true;
		}

		if (this.used[bucket] >= limit) {
			return false;
		}

		this.used[bucket] += 1;
		return true;
	}

	getLimits(): RetryBudgetLimits {
		return { ...this.limits };
	}

	getUsage(): RetryBudgetLimits {
		return { ...this.used };
	}

	getRemaining(bucket: RetryBudgetClass): number {
		const limit = this.limits[bucket];
		if (!Number.isFinite(limit)) return Number.POSITIVE_INFINITY;
		return Math.max(0, limit - this.used[bucket]);
	}
}
