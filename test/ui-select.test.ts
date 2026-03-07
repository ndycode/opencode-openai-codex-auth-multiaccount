import { describe, expect, it } from "vitest";
import { coalesceTerminalInput, tokenizeTerminalInput, type PendingInputSequence } from "../lib/ui/select.js";

describe("ui-select", () => {
	it("reconstructs orphan bracket arrow chunks", () => {
		const first = coalesceTerminalInput("[", null);
		expect(first).toEqual({
			normalizedInput: null,
			pending: { value: "[", hasEscape: false },
		});

	const second = coalesceTerminalInput("B", first.pending as PendingInputSequence);
	expect(second).toEqual({
		normalizedInput: "[B",
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

	it("tokenizes packed escape and control chunks", () => {
		expect(tokenizeTerminalInput("\u001b[B\u0003")).toEqual(["\u001b[B", "\u0003"]);
	});
});
