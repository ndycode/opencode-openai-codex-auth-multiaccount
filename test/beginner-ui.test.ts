import { describe, it, expect } from "vitest";
import {
	buildBeginnerChecklist,
	buildBeginnerDoctorFindings,
	explainRuntimeErrorCategory,
	recommendBeginnerNextAction,
	summarizeBeginnerAccounts,
	type BeginnerAccountSnapshot,
	type BeginnerRuntimeSnapshot,
} from "../lib/ui/beginner.js";

const now = Date.now();

const healthyRuntime: BeginnerRuntimeSnapshot = {
	totalRequests: 12,
	failedRequests: 0,
	rateLimitedResponses: 0,
	authRefreshFailures: 0,
	serverErrors: 0,
	networkErrors: 0,
	lastErrorCategory: null,
};

function buildAccount(
	overrides: Partial<BeginnerAccountSnapshot> = {},
): BeginnerAccountSnapshot {
	return {
		index: 0,
		label: "Account 1 (user@example.com)",
		accountLabel: "Work",
		enabled: true,
		isActive: true,
		rateLimitedUntil: null,
		coolingDownUntil: null,
		...overrides,
	};
}

describe("summarizeBeginnerAccounts", () => {
	it("counts healthy and blocked states", () => {
		const summary = summarizeBeginnerAccounts(
			[
				buildAccount(),
				buildAccount({
					index: 1,
					enabled: false,
					isActive: false,
					accountLabel: undefined,
				}),
				buildAccount({
					index: 2,
					isActive: false,
					rateLimitedUntil: now + 10_000,
					accountLabel: undefined,
				}),
			],
			now,
		);

		expect(summary.total).toBe(3);
		expect(summary.healthy).toBe(1);
		expect(summary.blocked).toBe(2);
		expect(summary.unlabeled).toBe(2);
	});
});

describe("buildBeginnerChecklist", () => {
	it("shows login as incomplete when there are no accounts", () => {
		const checklist = buildBeginnerChecklist([], now);
		expect(checklist[0]?.done).toBe(false);
		expect(checklist[0]?.command).toBe("opencode auth login");
	});

	it("marks key setup steps complete for healthy account", () => {
		const checklist = buildBeginnerChecklist([buildAccount()], now);
		const addAccount = checklist.find((step) => step.id === "add-account");
		const healthy = checklist.find((step) => step.id === "healthy-account");
		expect(addAccount?.done).toBe(true);
		expect(healthy?.done).toBe(true);
	});
});

describe("buildBeginnerDoctorFindings", () => {
	it("returns critical finding when no accounts are present", () => {
		const findings = buildBeginnerDoctorFindings({
			accounts: [],
			now,
			runtime: healthyRuntime,
		});
		expect(findings[0]?.severity).toBe("error");
		expect(findings[0]?.code).toBe("no-accounts");
	});

	it("returns ok finding for healthy setup", () => {
		const findings = buildBeginnerDoctorFindings({
			accounts: [buildAccount()],
			now,
			runtime: healthyRuntime,
		});
		expect(findings).toHaveLength(1);
		expect(findings[0]?.severity).toBe("ok");
	});

	it("flags elevated failure rate and auth refresh issues", () => {
		const findings = buildBeginnerDoctorFindings({
			accounts: [buildAccount()],
			now,
			runtime: {
				...healthyRuntime,
				totalRequests: 10,
				failedRequests: 7,
				authRefreshFailures: 2,
				lastErrorCategory: "auth-refresh",
			},
		});
		expect(findings.some((f) => f.code === "high-failure-rate")).toBe(true);
		expect(findings.some((f) => f.code === "auth-refresh-failures")).toBe(true);
		expect(findings.some((f) => f.code === "recent-error-category")).toBe(true);
	});
});

describe("recommendBeginnerNextAction", () => {
	it("recommends login when no accounts exist", () => {
		const action = recommendBeginnerNextAction({
			accounts: [],
			now,
			runtime: healthyRuntime,
		});
		expect(action).toContain("opencode auth login");
	});

	it("recommends switching when rate-limited accounts exist", () => {
		const action = recommendBeginnerNextAction({
			accounts: [
				buildAccount({ rateLimitedUntil: now + 20_000 }),
				buildAccount({ index: 1, isActive: false }),
			],
			now,
			runtime: healthyRuntime,
		});
		expect(action).toContain("codex-switch");
	});

	it("recommends labeling when multiple accounts are unlabeled", () => {
		const action = recommendBeginnerNextAction({
			accounts: [
				buildAccount({ accountLabel: undefined }),
				buildAccount({
					index: 1,
					isActive: false,
					accountLabel: undefined,
				}),
			],
			now,
			runtime: healthyRuntime,
		});
		expect(action).toContain("codex-label");
	});
});

describe("explainRuntimeErrorCategory", () => {
	it("returns null for null categories", () => {
		expect(explainRuntimeErrorCategory(null)).toBeNull();
	});

	it("maps known categories to beginner hints", () => {
		expect(explainRuntimeErrorCategory("network")).toContain("Network failures");
		expect(explainRuntimeErrorCategory("server")).toContain("Server-side");
		expect(explainRuntimeErrorCategory("rate-limit")).toContain("Rate-limit");
	});

	it("returns generic guidance for unknown categories", () => {
		const hint = explainRuntimeErrorCategory("mystery");
		expect(hint).toContain("mystery");
		expect(hint).toContain("codex-doctor");
	});
});
