import type { FailureRoute } from "./fetch-helpers.js";
import type { RetryPolicyMode } from "../types.js";

export type RetryPolicyRoute = FailureRoute | "tool_argument";

export interface RetryPolicyDecision {
	route: RetryPolicyRoute;
	mode: RetryPolicyMode;
	sameAccountRetry: boolean;
	rotateAccount: boolean;
	failFast: boolean;
	reason: string;
}

export interface RetryPolicyInput {
	mode: RetryPolicyMode;
	route: RetryPolicyRoute;
	sameAccountRetryAttempts?: number;
	maxSameAccountRetries?: number;
	rateLimitRetryAfterMs?: number;
	rateLimitShortRetryThresholdMs?: number;
	guidedRetryAttempts?: number;
	maxGuidedRetries?: number;
}

type BasePolicy = {
	rotateAccount: boolean;
	failFast: boolean;
	supportsSameAccountRetry?: boolean;
	supportsGuidedRetry?: boolean;
};

const ROUTE_MATRIX_POLICIES: Record<RetryPolicyRoute, BasePolicy> = {
	rate_limit: {
		rotateAccount: true,
		failFast: false,
		supportsSameAccountRetry: true,
	},
	server_error: {
		rotateAccount: true,
		failFast: false,
	},
	network_error: {
		rotateAccount: true,
		failFast: false,
		supportsSameAccountRetry: true,
	},
	tool_unavailable: {
		rotateAccount: false,
		failFast: true,
		supportsGuidedRetry: true,
	},
	tool_argument: {
		rotateAccount: false,
		failFast: true,
		supportsGuidedRetry: true,
	},
	approval_or_policy: {
		rotateAccount: false,
		failFast: true,
	},
	other: {
		rotateAccount: false,
		failFast: true,
	},
};

function getLegacyDecision(input: RetryPolicyInput): RetryPolicyDecision {
	const {
		route,
		sameAccountRetryAttempts = 0,
		maxSameAccountRetries = 1,
		rateLimitRetryAfterMs,
		rateLimitShortRetryThresholdMs,
		guidedRetryAttempts = 0,
		maxGuidedRetries = 1,
	} = input;

	if (route === "network_error") {
		const sameAccountRetry = sameAccountRetryAttempts < maxSameAccountRetries;
		return {
			route,
			mode: "legacy",
			sameAccountRetry,
			rotateAccount: !sameAccountRetry,
			failFast: false,
			reason: sameAccountRetry ? "network same-account retry" : "network rotate after retry budget",
		};
	}

	if (route === "tool_unavailable") {
		const sameAccountRetry = guidedRetryAttempts < maxGuidedRetries;
		return {
			route,
			mode: "legacy",
			sameAccountRetry,
			rotateAccount: false,
			failFast: !sameAccountRetry,
			reason: sameAccountRetry ? "guided tool-unavailable retry" : "tool unavailable fail-fast after guided retry",
		};
	}

	if (route === "tool_argument") {
		const sameAccountRetry = guidedRetryAttempts < maxGuidedRetries;
		return {
			route,
			mode: "legacy",
			sameAccountRetry,
			rotateAccount: false,
			failFast: !sameAccountRetry,
			reason: sameAccountRetry ? "guided tool-argument retry" : "tool argument fail-fast after guided retry",
		};
	}

	if (route === "rate_limit") {
		const shortRetry =
			typeof rateLimitRetryAfterMs === "number" &&
			typeof rateLimitShortRetryThresholdMs === "number" &&
			rateLimitRetryAfterMs <= rateLimitShortRetryThresholdMs;
		return {
			route,
			mode: "legacy",
			sameAccountRetry: shortRetry,
			rotateAccount: !shortRetry,
			failFast: false,
			reason: shortRetry ? "short rate-limit retry" : "rate-limit rotate",
		};
	}

	if (route === "server_error") {
		return {
			route,
			mode: "legacy",
			sameAccountRetry: false,
			rotateAccount: true,
			failFast: false,
			reason: "server error rotate",
		};
	}

	if (route === "approval_or_policy") {
		return {
			route,
			mode: "legacy",
			sameAccountRetry: false,
			rotateAccount: false,
			failFast: true,
			reason: "approval/policy fail-fast",
		};
	}

	return {
		route,
		mode: "legacy",
		sameAccountRetry: false,
		rotateAccount: false,
		failFast: true,
		reason: "default fail-fast",
	};
}

function getRouteMatrixDecision(input: RetryPolicyInput): RetryPolicyDecision {
	const {
		route,
		sameAccountRetryAttempts = 0,
		maxSameAccountRetries = 1,
		rateLimitRetryAfterMs,
		rateLimitShortRetryThresholdMs,
		guidedRetryAttempts = 0,
		maxGuidedRetries = 1,
	} = input;
	const base = ROUTE_MATRIX_POLICIES[route];

	let sameAccountRetry = false;
	if (base.supportsSameAccountRetry && route === "network_error") {
		sameAccountRetry = sameAccountRetryAttempts < maxSameAccountRetries;
	}
	if (base.supportsSameAccountRetry && route === "rate_limit") {
		sameAccountRetry =
			typeof rateLimitRetryAfterMs === "number" &&
			typeof rateLimitShortRetryThresholdMs === "number" &&
			rateLimitRetryAfterMs <= rateLimitShortRetryThresholdMs;
	}
	if (base.supportsGuidedRetry) {
		sameAccountRetry = guidedRetryAttempts < maxGuidedRetries;
	}

	const rotateAccount = base.rotateAccount && !sameAccountRetry;
	const failFast = base.failFast && !sameAccountRetry;

	let reason = `${route} policy`;
	if (sameAccountRetry && base.supportsGuidedRetry) reason = `${route} guided retry`;
	else if (sameAccountRetry && route === "network_error") reason = "network same-account retry";
	else if (sameAccountRetry && route === "rate_limit") reason = "short rate-limit retry";
	else if (rotateAccount) reason = `${route} rotate`;
	else if (failFast) reason = `${route} fail-fast`;

	return {
		route,
		mode: "route-matrix",
		sameAccountRetry,
		rotateAccount,
		failFast,
		reason,
	};
}

export function getRetryPolicyDecision(
	input: RetryPolicyInput,
): RetryPolicyDecision {
	if (input.mode === "route-matrix") {
		return getRouteMatrixDecision(input);
	}
	return getLegacyDecision(input);
}
