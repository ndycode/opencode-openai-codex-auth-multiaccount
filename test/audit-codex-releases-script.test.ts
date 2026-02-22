import { describe, expect, it } from "vitest";
import {
	extractSemanticItems,
	classifySemanticItem,
} from "../scripts/audit-codex-releases.js";

describe("audit-codex-releases semantic helpers", () => {
	it("extracts bullet and numbered items but ignores markdown headings", () => {
		const body = [
			"## Improvements",
			"- Added model capability updates",
			"- Improved reroute logging",
			"### Chores",
			"1. Updated docs",
			"Plain paragraph should be ignored",
		].join("\n");

		expect(extractSemanticItems(body)).toEqual([
			"Added model capability updates",
			"Improved reroute logging",
			"Updated docs",
		]);
	});

	it("classifies model and reroute items into expected buckets", () => {
		expect(classifySemanticItem("Added model capability sync").bucketId).toBe(
			"models_capabilities",
		);
		expect(classifySemanticItem("Improved reroute fallback behavior").bucketId).toBe(
			"routing_reroute",
		);
	});
});
