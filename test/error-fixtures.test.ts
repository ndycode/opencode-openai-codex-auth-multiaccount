import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	classifyFailureRoute,
	getApprovalPolicyInfo,
	getModelRerouteInfoFromHeaders,
	getToolArgumentIssueInfo,
	getToolUnavailableInfo,
	getUnsupportedCodexModelInfo,
} from "../lib/request/fetch-helpers.js";

type ErrorBodyFixture = {
	kind: "errorBody";
	name: string;
	status?: number;
	payload: unknown;
	expect: {
		route?: string;
		toolArgument?: boolean;
		toolUnavailable?: boolean;
		approvalOrPolicy?: boolean;
		toolName?: string;
		missingRequired?: string[];
		unsupportedCodex?: boolean;
		unsupportedModel?: string;
	};
};

type RerouteHeaderFixture = {
	kind: "rerouteHeaders";
	name: string;
	requestedModel?: string;
	headers: Record<string, string>;
	expect: {
		effectiveModel?: string;
		reroutedTo?: string;
	};
};

type Fixture = ErrorBodyFixture | RerouteHeaderFixture;

const FIXTURE_DIR = join(
	dirname(fileURLToPath(import.meta.url)),
	"fixtures",
	"errors",
);

function loadFixtures(): Fixture[] {
	return readdirSync(FIXTURE_DIR)
		.filter((name) => name.endsWith(".json"))
		.sort()
		.map((name) => {
			const raw = readFileSync(join(FIXTURE_DIR, name), "utf8");
			return JSON.parse(raw) as Fixture;
		});
}

describe("Error fixture replay", () => {
	const fixtures = loadFixtures();

	it("loads fixture pack", () => {
		expect(fixtures.length).toBeGreaterThanOrEqual(5);
	});

	for (const fixture of fixtures) {
		it(`replays fixture: ${fixture.name}`, () => {
			if (fixture.kind === "rerouteHeaders") {
				const headers = new Headers(fixture.headers);
				const info = getModelRerouteInfoFromHeaders(headers, fixture.requestedModel);
				expect(info).toEqual(
					expect.objectContaining({
						effectiveModel: fixture.expect.effectiveModel,
						reroutedTo: fixture.expect.reroutedTo,
					}),
				);
				return;
			}

			if (fixture.expect.route) {
				expect(
					classifyFailureRoute({
						status: fixture.status,
						errorBody: fixture.payload,
					}),
				).toBe(fixture.expect.route);
			}

			if (fixture.expect.toolArgument !== undefined) {
				const info = getToolArgumentIssueInfo(fixture.payload);
				expect(info.isArgumentIssue).toBe(fixture.expect.toolArgument);
				if (fixture.expect.toolName) {
					expect(info.toolName).toBe(fixture.expect.toolName);
				}
				for (const field of fixture.expect.missingRequired ?? []) {
					expect(info.missingRequired).toContain(field);
				}
			}

			if (fixture.expect.toolUnavailable !== undefined) {
				const info = getToolUnavailableInfo(fixture.payload);
				expect(info.isToolUnavailable).toBe(fixture.expect.toolUnavailable);
				if (fixture.expect.toolName) {
					expect(info.toolName).toBe(fixture.expect.toolName);
				}
			}

			if (fixture.expect.approvalOrPolicy !== undefined) {
				const info = getApprovalPolicyInfo(fixture.payload);
				expect(info.isApprovalOrPolicy).toBe(fixture.expect.approvalOrPolicy);
			}

			if (fixture.expect.unsupportedCodex !== undefined) {
				const info = getUnsupportedCodexModelInfo(fixture.payload);
				expect(info.isUnsupported).toBe(fixture.expect.unsupportedCodex);
				if (fixture.expect.unsupportedModel) {
					expect(info.unsupportedModel).toBe(fixture.expect.unsupportedModel);
				}
			}
		});
	}
});
