import { describe, it, expect } from "vitest";
import { analyzeRuntimeToolCapabilities } from "../lib/request/runtime-tool-capabilities.js";

describe("runtime-tool-capabilities", () => {
	it("detects hashline-like capability from generic edit schema signals", () => {
		const manifest = analyzeRuntimeToolCapabilities([
			{
				type: "function",
				function: {
					name: "edit",
					description: "Generic file editor",
					parameters: {
						type: "object",
						required: ["path", "expected_hash"],
						properties: {
							path: { type: "string" },
							expected_hash: { type: "string" },
						},
					},
				},
			},
		]);

		expect(manifest.names).toEqual(["edit"]);
		expect(manifest.capabilities.hasGenericEdit).toBe(true);
		expect(manifest.capabilities.hasHashlineCapabilities).toBe(true);
		expect(manifest.capabilities.primaryEditStrategy).toBe("hashline-like");
		expect(manifest.requiredParametersByTool.edit).toEqual(["path", "expected_hash"]);
	});

	it("detects alias and delegation capability flags from runtime schema", () => {
		const manifest = analyzeRuntimeToolCapabilities([
			{
				function: {
					name: "apply_patch",
					parameters: { type: "object", required: ["patch"] },
				},
			},
			{
				function: {
					name: "update_plan",
					parameters: { type: "object", required: ["plan"] },
				},
			},
			{
				function: {
					name: "delegate_task",
					parameters: {
						type: "object",
						required: ["task", "run_in_background"],
						properties: {
							task: { type: "string" },
							run_in_background: { type: "boolean" },
						},
					},
				},
			},
		]);

		expect(manifest.capabilities.hasApplyPatch).toBe(true);
		expect(manifest.capabilities.hasUpdatePlan).toBe(true);
		expect(manifest.capabilities.hasTaskDelegation).toBe(true);
		expect(manifest.capabilities.supportsBackgroundDelegation).toBe(true);
		expect(manifest.capabilities.primaryEditStrategy).toBe("apply_patch");
		expect(manifest.requiredParametersByTool.delegate_task).toEqual([
			"task",
			"run_in_background",
		]);
	});
});
