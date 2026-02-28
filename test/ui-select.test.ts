import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as ansiModule from "../lib/ui/ansi.js";
import { select, type MenuItem } from "../lib/ui/select.js";
import { createUiTheme } from "../lib/ui/theme.js";

const stdoutColumnsDescriptor = Object.getOwnPropertyDescriptor(process.stdout, "columns");
const stdoutRowsDescriptor = Object.getOwnPropertyDescriptor(process.stdout, "rows");

type WritableStdin = NodeJS.ReadStream & {
	setRawMode?: (mode: boolean) => void;
};

const stdin = process.stdin as WritableStdin;
const originalSetRawMode = stdin.setRawMode;

function configureTerminalSize(columns: number, rows: number): void {
	Object.defineProperty(process.stdout, "columns", { value: columns, configurable: true });
	Object.defineProperty(process.stdout, "rows", { value: rows, configurable: true });
}

function restoreTerminalSize(): void {
	if (stdoutColumnsDescriptor) {
		Object.defineProperty(process.stdout, "columns", stdoutColumnsDescriptor);
	}
	if (stdoutRowsDescriptor) {
		Object.defineProperty(process.stdout, "rows", stdoutRowsDescriptor);
	}
}

describe("ui select", () => {
	beforeEach(() => {
		configureTerminalSize(80, 24);
		stdin.setRawMode = vi.fn();
		vi.spyOn(process.stdin, "resume").mockImplementation(() => process.stdin);
		vi.spyOn(process.stdin, "pause").mockImplementation(() => process.stdin);
		vi.spyOn(process.stdout, "write").mockImplementation(() => true);
		vi.spyOn(ansiModule, "isTTY").mockReturnValue(true);
	});

	afterEach(() => {
		restoreTerminalSize();
		if (originalSetRawMode) {
			stdin.setRawMode = originalSetRawMode;
		} else {
			delete stdin.setRawMode;
		}
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it("throws when interactive tty is unavailable", async () => {
		vi.spyOn(ansiModule, "isTTY").mockReturnValue(false);
		await expect(select([{ label: "One", value: "one" }], { message: "Pick" })).rejects.toThrow(
			"Interactive select requires a TTY terminal",
		);
	});

	it("validates items before rendering", async () => {
		await expect(select([], { message: "Pick" })).rejects.toThrow("No menu items provided");
		await expect(
			select(
				[
					{ label: "Heading", value: "h", kind: "heading" },
					{ label: "Disabled", value: "d", disabled: true },
				],
				{ message: "Pick" },
			),
		).rejects.toThrow("All menu items are disabled");
	});

	it("returns immediately when only one selectable item exists", async () => {
		const result = await select(
			[
				{ label: "Only", value: "only" },
				{ label: "Disabled", value: "disabled", disabled: true },
			],
			{ message: "Pick" },
		);
		expect(result).toBe("only");
	});

	it("falls back to null when raw mode cannot be enabled", async () => {
		stdin.setRawMode = vi.fn(() => {
			throw new Error("raw mode unavailable");
		});

		const result = await select(
			[
				{ label: "A", value: "a" },
				{ label: "B", value: "b" },
			],
			{ message: "Pick" },
		);

		expect(result).toBeNull();
	});

	it("navigates around separators/headings and returns selected value", async () => {
		const parseKeySpy = vi.spyOn(ansiModule, "parseKey");
		parseKeySpy.mockReturnValueOnce("up").mockReturnValueOnce("enter");

		const items: MenuItem<string>[] = [
			{ label: "Group", value: "group", kind: "heading" },
			{ label: "Unavailable", value: "skip-1", disabled: true },
			{ label: "First", value: "first", color: "cyan" },
			{ label: "---", value: "sep", separator: true },
			{ label: "Second", value: "second", color: "green", hint: "(recommended)" },
		];

		const promise = select(items, {
			message: "Choose account",
			subtitle: "Use arrows",
			help: "Up/Down, Enter",
			variant: "legacy",
		});

		process.stdin.emit("data", Buffer.from("x"));
		process.stdin.emit("data", Buffer.from("x"));
		const result = await promise;

		expect(result).toBe("second");
		expect(parseKeySpy).toHaveBeenCalledTimes(2);
	});

	it("returns null on escape-start timeout in codex variant", async () => {
		vi.useFakeTimers();
		const parseKeySpy = vi.spyOn(ansiModule, "parseKey").mockReturnValue("escape-start");

		const promise = select(
			[
				{ label: "A", value: "a" },
				{ label: "B", value: "b" },
			],
			{
				message: "Choose",
				variant: "codex",
				theme: createUiTheme({ profile: "ansi16", glyphMode: "ascii" }),
				clearScreen: true,
			},
		);

		process.stdin.emit("data", Buffer.from("\x1b"));
		await vi.advanceTimersByTimeAsync(60);
		await expect(promise).resolves.toBeNull();
		expect(parseKeySpy).toHaveBeenCalled();
	});
});
