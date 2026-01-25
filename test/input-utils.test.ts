import { describe, it, expect } from "vitest";
import {
	injectMissingToolOutputs,
	normalizeOrphanedToolOutputs,
} from "../lib/request/helpers/input-utils.js";
import type { InputItem } from "../lib/types.js";

describe("Tool Output Normalization", () => {
	describe("injectMissingToolOutputs", () => {
		it("returns empty array for empty input", () => {
			expect(injectMissingToolOutputs([])).toEqual([]);
		});

		it("passes through input with no function_calls", () => {
			const input: InputItem[] = [
				{ type: "message", role: "user", content: "Hello" },
				{ type: "message", role: "assistant", content: "Hi there" },
			];
			expect(injectMissingToolOutputs(input)).toEqual(input);
		});

		it("passes through function_call with matching output", () => {
			const input: InputItem[] = [
				{ type: "function_call", role: "assistant", call_id: "call_1", name: "test" },
				{ type: "function_call_output", role: "tool", call_id: "call_1", output: "result" },
			];
			const result = injectMissingToolOutputs(input);
			expect(result).toHaveLength(2);
			expect(result[0]?.type).toBe("function_call");
			expect(result[1]?.type).toBe("function_call_output");
		});

		it("injects output for orphaned function_call", () => {
			const input: InputItem[] = [
				{ type: "message", role: "user", content: "run the tool" },
				{ type: "function_call", role: "assistant", call_id: "call_orphan", name: "read_file" },
			];
			const result = injectMissingToolOutputs(input);
			
			expect(result).toHaveLength(3);
			expect(result[2]?.type).toBe("function_call_output");
			expect((result[2] as { call_id?: string }).call_id).toBe("call_orphan");
			expect((result[2] as { output?: string }).output).toBe("Operation cancelled by user");
		});

		it("injects output for orphaned local_shell_call", () => {
			const input: InputItem[] = [
				{ type: "local_shell_call", role: "assistant", call_id: "shell_1", command: "ls" },
			];
			const result = injectMissingToolOutputs(input);
			
			expect(result).toHaveLength(2);
			expect(result[1]?.type).toBe("local_shell_call_output");
			expect((result[1] as { call_id?: string }).call_id).toBe("shell_1");
		});

		it("injects output for orphaned custom_tool_call", () => {
			const input: InputItem[] = [
				{ type: "custom_tool_call", role: "assistant", call_id: "custom_1", name: "my_tool" },
			];
			const result = injectMissingToolOutputs(input);
			
			expect(result).toHaveLength(2);
			expect(result[1]?.type).toBe("custom_tool_call_output");
		});

		it("handles multiple orphaned calls", () => {
			const input: InputItem[] = [
				{ type: "function_call", role: "assistant", call_id: "call_1", name: "tool1" },
				{ type: "function_call", role: "assistant", call_id: "call_2", name: "tool2" },
				{ type: "function_call", role: "assistant", call_id: "call_3", name: "tool3" },
			];
			const result = injectMissingToolOutputs(input);
			
			expect(result).toHaveLength(6);
			expect(result.filter(i => i.type === "function_call_output")).toHaveLength(3);
		});

		it("only injects for calls without outputs", () => {
			const input: InputItem[] = [
				{ type: "function_call", role: "assistant", call_id: "call_with_output", name: "tool1" },
				{ type: "function_call_output", role: "tool", call_id: "call_with_output", output: "done" },
				{ type: "function_call", role: "assistant", call_id: "call_without_output", name: "tool2" },
			];
			const result = injectMissingToolOutputs(input);
			
			expect(result).toHaveLength(4);
			const outputs = result.filter(i => i.type === "function_call_output");
			expect(outputs).toHaveLength(2);
		});

		it("skips calls without call_id", () => {
			const input: InputItem[] = [
				{ type: "function_call", role: "assistant", name: "no_id_tool" },
			];
			const result = injectMissingToolOutputs(input);
			expect(result).toHaveLength(1);
		});

		it("places injected output immediately after the call", () => {
			const input: InputItem[] = [
				{ type: "message", role: "user", content: "start" },
				{ type: "function_call", role: "assistant", call_id: "call_A", name: "toolA" },
				{ type: "message", role: "user", content: "middle" },
				{ type: "function_call", role: "assistant", call_id: "call_B", name: "toolB" },
				{ type: "message", role: "user", content: "end" },
			];
			const result = injectMissingToolOutputs(input);
			
			expect(result).toHaveLength(7);
			expect(result[0]?.type).toBe("message");
			expect(result[1]?.type).toBe("function_call");
			expect(result[2]?.type).toBe("function_call_output");
			expect((result[2] as { call_id?: string }).call_id).toBe("call_A");
			expect(result[3]?.type).toBe("message");
			expect(result[4]?.type).toBe("function_call");
			expect(result[5]?.type).toBe("function_call_output");
			expect((result[5] as { call_id?: string }).call_id).toBe("call_B");
			expect(result[6]?.type).toBe("message");
		});
	});

	describe("normalizeOrphanedToolOutputs", () => {
		it("converts orphaned function_call_output to message", () => {
			const input: InputItem[] = [
				{ type: "function_call_output", role: "tool", call_id: "orphan_call", output: "some result" },
			];
			const result = normalizeOrphanedToolOutputs(input);
			
			expect(result).toHaveLength(1);
			expect(result[0]?.type).toBe("message");
			expect(result[0]?.role).toBe("assistant");
		});

		it("preserves function_call_output with matching call", () => {
			const input: InputItem[] = [
				{ type: "function_call", role: "assistant", call_id: "matched_call", name: "test" },
				{ type: "function_call_output", role: "tool", call_id: "matched_call", output: "result" },
			];
			const result = normalizeOrphanedToolOutputs(input);
			
			expect(result).toHaveLength(2);
			expect(result[1]?.type).toBe("function_call_output");
		});
	});

	describe("combined normalization flow", () => {
		it("handles both orphaned calls and outputs", () => {
			const input: InputItem[] = [
				{ type: "function_call_output", role: "tool", call_id: "orphan_output", output: "lost result" },
				{ type: "function_call", role: "assistant", call_id: "orphan_call", name: "new_tool" },
			];
			
			const normalized = normalizeOrphanedToolOutputs(input);
			const injected = injectMissingToolOutputs(normalized);
			
			expect(injected.filter(i => i.type === "message")).toHaveLength(1);
			expect(injected.filter(i => i.type === "function_call")).toHaveLength(1);
			expect(injected.filter(i => i.type === "function_call_output")).toHaveLength(1);
		});
	});
});
