import { describe, expect, it } from "vitest";
import { coalesceTerminalInput, tokenizeTerminalInput, type PendingInputSequence } from "../lib/ui/select.js";

describe("ui-select", () => {
	it("reconstructs orphan bracket arrow chunks", () => {
		const first = coalesceTerminalInput("[", null);
		expect(first).toEqual({
			normalizedInput: "[",
			pending: null,
		});
	});

	it("reconstructs escape-plus-bracket chunks", () => {
		const first = coalesceTerminalInput("\u001b", null);
		expect(first).toEqual({
			normalizedInput: null,
			pending: { value: "\u001b", hasEscape: true },
		});

		const second = coalesceTerminalInput("[", first.pending as PendingInputSequence);
		expect(second).toEqual({
			normalizedInput: null,
			pending: { value: "\u001b[", hasEscape: true },
		});

		const third = coalesceTerminalInput("B", second.pending as PendingInputSequence);
		expect(third).toEqual({
			normalizedInput: "\u001b[B",
			pending: null,
		});
	});

	it("reconstructs compact orphan sequences", () => {
		const result = coalesceTerminalInput("[B", null);
		expect(result).toEqual({
			normalizedInput: "[B",
			pending: null,
		});
	});

	it("keeps split CSI numeric tails pending until the final byte arrives", () => {
		const first = coalesceTerminalInput("\u001b", null);
		const second = coalesceTerminalInput("[", first.pending as PendingInputSequence);
		const third = coalesceTerminalInput("1", second.pending as PendingInputSequence);
		expect(third).toEqual({
			normalizedInput: null,
			pending: { value: "\u001b[1", hasEscape: true },
		});

		const fourth = coalesceTerminalInput("~", third.pending as PendingInputSequence);
		expect(fourth).toEqual({
			normalizedInput: "\u001b[1~",
			pending: null,
		});
	});

	it("tokenizes packed escape and control chunks", () => {
		expect(tokenizeTerminalInput("\u001b[B\u0003")).toEqual(["\u001b[B", "\u0003"]);
	});

	it("tokenizes CSI tilde sequences without splitting numeric hotkeys", () => {
		expect(tokenizeTerminalInput("\u001b[5~1")).toEqual(["\u001b[5~", "1"]);
	});

	it("tokenizes packed SS3 arrow sequences", () => {
		expect(tokenizeTerminalInput("\u001bOA\u001bOB")).toEqual(["\u001bOA", "\u001bOB"]);
	});
});
