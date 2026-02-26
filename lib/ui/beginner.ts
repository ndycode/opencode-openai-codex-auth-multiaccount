export type BeginnerDiagnosticSeverity = "ok" | "warning" | "error";

export interface BeginnerAccountSnapshot {
	index: number;
	label: string;
	accountLabel?: string;
	enabled: boolean;
	isActive: boolean;
	rateLimitedUntil: number | null;
	coolingDownUntil: number | null;
}

export interface BeginnerRuntimeSnapshot {
	totalRequests: number;
	failedRequests: number;
	rateLimitedResponses: number;
	authRefreshFailures: number;
	serverErrors: number;
	networkErrors: number;
	lastErrorCategory: string | null;
}

export interface BeginnerChecklistItem {
	id: string;
	done: boolean;
	label: string;
	detail: string;
	command?: string;
}

export interface BeginnerDiagnosticFinding {
	severity: BeginnerDiagnosticSeverity;
	code: string;
	summary: string;
	action: string;
}

export interface BeginnerAccountSummary {
	total: number;
	active: number;
	enabled: number;
	disabled: number;
	rateLimited: number;
	coolingDown: number;
	blocked: number;
	healthy: number;
	unlabeled: number;
}

export function summarizeBeginnerAccounts(
	accounts: BeginnerAccountSnapshot[],
	now: number,
): BeginnerAccountSummary {
	let active = 0;
	let enabled = 0;
	let disabled = 0;
	let rateLimited = 0;
	let coolingDown = 0;
	let blocked = 0;
	let healthy = 0;
	let unlabeled = 0;

	for (const account of accounts) {
		if (account.isActive) active += 1;
		if (account.enabled) enabled += 1;
		else disabled += 1;
		if ((account.accountLabel ?? "").trim().length === 0) unlabeled += 1;

		const isRateLimited =
			typeof account.rateLimitedUntil === "number" &&
			account.rateLimitedUntil > now;
		const isCoolingDown =
			typeof account.coolingDownUntil === "number" &&
			account.coolingDownUntil > now;
		if (isRateLimited) rateLimited += 1;
		if (isCoolingDown) coolingDown += 1;

		const isBlocked = !account.enabled || isRateLimited || isCoolingDown;
		if (isBlocked) blocked += 1;
		else healthy += 1;
	}

	return {
		total: accounts.length,
		active,
		enabled,
		disabled,
		rateLimited,
		coolingDown,
		blocked,
		healthy,
		unlabeled,
	};
}

export function buildBeginnerChecklist(
	accounts: BeginnerAccountSnapshot[],
	now: number,
): BeginnerChecklistItem[] {
	const summary = summarizeBeginnerAccounts(accounts, now);
	return [
		{
			id: "add-account",
			done: summary.total > 0,
			label: "Add at least one account",
			detail:
				summary.total > 0
					? `${summary.total} account(s) found`
					: "No accounts are configured yet",
			command: "opencode auth login",
		},
		{
			id: "set-active",
			done: summary.total > 0 && summary.active > 0,
			label: "Set an active account",
			detail:
				summary.total > 0
					? summary.active > 0
						? "Active account is set"
						: "No active account is selected"
					: "Requires at least one account",
			command: "codex-switch <index>",
		},
		{
			id: "healthy-account",
			done: summary.healthy > 0,
			label: "Verify account health",
			detail:
				summary.healthy > 0
					? `${summary.healthy} healthy account(s) available`
					: "All accounts are blocked or disabled",
			command: "codex-health",
		},
		{
			id: "labels",
			done: summary.total <= 1 || summary.unlabeled === 0,
			label: "Label accounts for clarity",
			detail:
				summary.total <= 1
					? "Single account setup"
					: summary.unlabeled === 0
						? "All accounts already have labels"
						: `${summary.unlabeled} account(s) still unlabeled`,
			command: "codex-label <index> <label>",
		},
		{
			id: "learn-commands",
			done: false,
			label: "Learn daily commands",
			detail: "Use help to understand list/status/dashboard flows",
			command: "codex-help",
		},
	];
}

function getFailureRate(runtime: BeginnerRuntimeSnapshot): number {
	if (runtime.totalRequests <= 0) return 0;
	return runtime.failedRequests / runtime.totalRequests;
}

export function explainRuntimeErrorCategory(
	category: string | null,
): string | null {
	if (!category) return null;
	switch (category) {
		case "network":
			return "Network failures detected. Check connectivity or VPN/proxy rules.";
		case "server":
			return "Server-side 5xx failures detected. Try again or switch accounts.";
		case "rate-limit":
			return "Rate-limit responses detected. Wait for reset or switch accounts.";
		case "auth-refresh":
			return "Token refresh failures detected. Re-authenticate the affected account.";
		case "auth-missing":
			return "Missing authentication. Login is required before requests can succeed.";
		default:
			return `Recent errors were grouped as "${category}". Run codex-doctor for guidance.`;
	}
}

export function buildBeginnerDoctorFindings(input: {
	accounts: BeginnerAccountSnapshot[];
	now: number;
	runtime: BeginnerRuntimeSnapshot;
}): BeginnerDiagnosticFinding[] {
	const summary = summarizeBeginnerAccounts(input.accounts, input.now);
	const findings: BeginnerDiagnosticFinding[] = [];

	if (summary.total === 0) {
		findings.push({
			severity: "error",
			code: "no-accounts",
			summary: "No accounts are configured.",
			action: "Run `opencode auth login` to add your first account.",
		});
		return findings;
	}

	if (summary.healthy === 0) {
		findings.push({
			severity: "error",
			code: "no-healthy-account",
			summary: "No healthy account is available for requests.",
			action: "Run `codex-health`, then switch or re-login affected accounts.",
		});
	}

	if (summary.disabled > 0) {
		findings.push({
			severity: "warning",
			code: "disabled-accounts",
			summary: `${summary.disabled} account(s) are disabled.`,
			action: "Enable or replace disabled accounts to improve failover.",
		});
	}

	if (summary.rateLimited > 0) {
		findings.push({
			severity: "warning",
			code: "rate-limited-accounts",
			summary: `${summary.rateLimited} account(s) are currently rate-limited.`,
			action: "Use `codex-switch` to move to an available account or wait for reset.",
		});
	}

	if (summary.coolingDown > 0) {
		findings.push({
			severity: "warning",
			code: "cooling-down-accounts",
			summary: `${summary.coolingDown} account(s) are cooling down after failures.`,
			action: "Wait for cooldown expiry or rotate to another healthy account.",
		});
	}

	if (input.runtime.authRefreshFailures > 0) {
		findings.push({
			severity: "warning",
			code: "auth-refresh-failures",
			summary: `Auth refresh failed ${input.runtime.authRefreshFailures} time(s).`,
			action: "Run `codex-refresh` and `codex-health`; re-login if failures continue.",
		});
	}

	const failureRate = getFailureRate(input.runtime);
	if (input.runtime.totalRequests >= 6 && failureRate >= 0.5) {
		findings.push({
			severity: "error",
			code: "high-failure-rate",
			summary: `High failure rate: ${(failureRate * 100).toFixed(0)}% over ${input.runtime.totalRequests} requests.`,
			action: "Run `codex-doctor`, then inspect `codex-dashboard` and rotate accounts.",
		});
	} else if (input.runtime.totalRequests >= 3 && failureRate >= 0.25) {
		findings.push({
			severity: "warning",
			code: "elevated-failure-rate",
			summary: `Elevated failure rate: ${(failureRate * 100).toFixed(0)}%.`,
			action: "Check recent errors in `codex-metrics` and verify account health.",
		});
	}

	const errorHint = explainRuntimeErrorCategory(input.runtime.lastErrorCategory);
	if (errorHint) {
		findings.push({
			severity: "warning",
			code: "recent-error-category",
			summary: `Recent error category: ${input.runtime.lastErrorCategory}.`,
			action: errorHint,
		});
	}

	if (findings.length === 0) {
		findings.push({
			severity: "ok",
			code: "healthy",
			summary: "No critical issues detected.",
			action: "Keep using `codex-dashboard` and `codex-metrics` for monitoring.",
		});
	}

	return findings;
}

export function recommendBeginnerNextAction(input: {
	accounts: BeginnerAccountSnapshot[];
	now: number;
	runtime: BeginnerRuntimeSnapshot;
}): string {
	const summary = summarizeBeginnerAccounts(input.accounts, input.now);
	if (summary.total === 0) {
		return "Run `opencode auth login` to add your first account.";
	}
	if (summary.healthy === 0) {
		return "Run `codex-health`, then re-login or switch to a healthy account.";
	}
	if (summary.rateLimited > 0) {
		return "Use `codex-switch <index>` to move away from rate-limited accounts.";
	}
	if (summary.coolingDown > 0) {
		return "Wait for cooldown expiry or switch to another account with `codex-switch`.";
	}
	if (input.runtime.authRefreshFailures > 0) {
		return "Run `codex-refresh` to refresh tokens and verify account health.";
	}
	if (summary.total > 1 && summary.unlabeled > 0) {
		return "Label accounts with `codex-label <index> <label>` for easier switching.";
	}
	return "Open `codex-dashboard` for live health and retry visibility.";
}
