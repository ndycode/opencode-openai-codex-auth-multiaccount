import { ANSI, isTTY, parseKey } from "./ansi.js";
import type { UiTheme } from "./theme.js";
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export interface MenuItem<T = string> {
	label: string;
	selectedLabel?: string;
	value: T;
	hint?: string;
	disabled?: boolean;
	hideUnavailableSuffix?: boolean;
	separator?: boolean;
	kind?: "heading";
	color?: "red" | "green" | "yellow" | "cyan";
}

export interface SelectOptions<T = string> {
	message: string;
	subtitle?: string;
	dynamicSubtitle?: () => string | undefined;
	help?: string;
	clearScreen?: boolean;
	variant?: "legacy" | "codex";
	theme?: UiTheme;
	selectedEmphasis?: "chip" | "minimal";
	focusStyle?: "row-invert" | "chip";
	showHintsForUnselected?: boolean;
	refreshIntervalMs?: number;
	initialCursor?: number;
	allowEscape?: boolean;
	onCursorChange?: (
		context: {
			cursor: number;
			items: MenuItem<T>[];
			requestRerender: () => void;
		},
	) => void;
	onInput?: (
		input: string,
		context: {
			cursor: number;
			items: MenuItem<T>[];
			requestRerender: () => void;
		},
	) => T | null | undefined;
}

const ESCAPE_TIMEOUT_MS = 50;
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching ANSI escape codes
const ANSI_REGEX = new RegExp("\\x1b\\[[0-9;]*m", "g");
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching ANSI escape codes
const ANSI_LEADING_REGEX = new RegExp("^\\x1b\\[[0-9;]*m");
const CSI_FINAL_KEYS = new Set(["A", "B", "C", "D", "H", "F"]);
const CSI_TILDE_PATTERN = /^\d+~$/;
const CONTROL_CHAR_REGEX = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

export interface PendingInputSequence {
	value: string;
	hasEscape: boolean;
}

function writeTuiAudit(event: Record<string, unknown>): void {
	if (process.env.CODEX_TUI_AUDIT !== "1") return;
	try {
		const home = process.env.USERPROFILE ?? process.env.HOME;
		if (!home) return;
		const logDir = join(home, ".opencode", "logs");
		mkdirSync(logDir, { recursive: true, mode: 0o700 });
		const logPath = join(logDir, "codex-tui-audit.log");
		appendFileSync(
			logPath,
			`${JSON.stringify(sanitizeAuditValue("event", { ts: new Date().toISOString(), ...event }))}\n`,
			{ encoding: "utf8", mode: 0o600 },
		);
	} catch {
		// best effort audit logging only
	}
}

const AUDIT_REDACTED_STRING_KEYS = new Set([
	"label",
	"message",
	"utf8",
	"bytesHex",
	"token",
	"normalizedInput",
	"pending",
	"hint",
	"subtitle",
]);

const AUDIT_SECRET_LIKE_PATTERN = /\b(?:Bearer\s+)?[A-Za-z0-9._-]{24,}(?:\.[A-Za-z0-9._-]{8,})*\b/;

export function sanitizeAuditValue(key: string, value: unknown): unknown {
	if (typeof value === "string") {
		if (AUDIT_REDACTED_STRING_KEYS.has(key)) {
			return `[redacted:${value.length}]`;
		}
		if (value.includes("@")) {
			return "[redacted-email]";
		}
		if (AUDIT_SECRET_LIKE_PATTERN.test(value)) {
			return "[redacted-token]";
		}
		return value;
	}
	if (Array.isArray(value)) {
		return value.map((entry) => sanitizeAuditValue(key, entry));
	}
	if (value && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value as Record<string, unknown>).map(([entryKey, entryValue]) => [
				entryKey,
				sanitizeAuditValue(entryKey, entryValue),
			]),
		);
	}
	return value;
}

function stripAnsi(input: string): string {
	return input.replace(ANSI_REGEX, "");
}

function sanitizeDisplayText(input: string): string {
	return stripAnsi(input).replace(CONTROL_CHAR_REGEX, "");
}

function truncateAnsi(input: string, maxVisibleChars: number): string {
	if (maxVisibleChars <= 0) return "";
	const visible = stripAnsi(input);
	if (visible.length <= maxVisibleChars) return input;

	const suffix = maxVisibleChars >= 3 ? "..." : ".".repeat(maxVisibleChars);
	const keep = Math.max(0, maxVisibleChars - suffix.length);
	let kept = 0;
	let index = 0;
	let output = "";

	while (index < input.length && kept < keep) {
		if (input[index] === "\x1b") {
			const match = input.slice(index).match(ANSI_LEADING_REGEX);
			if (match) {
				output += match[0];
				index += match[0].length;
				continue;
			}
		}
		output += input[index];
		index += 1;
		kept += 1;
	}

	return output + suffix;
}

function colorCode(color: MenuItem["color"]): string {
	switch (color) {
		case "red":
			return ANSI.red;
		case "green":
			return ANSI.green;
		case "yellow":
			return ANSI.yellow;
		case "cyan":
			return ANSI.cyan;
		default:
			return "";
	}
}

function decodeHotkeyInput(data: Buffer): string | null {
	const input = data.toString("utf8");
	const keypadMap: Record<string, string> = {
		"\x1bOp": "0",
		"\x1bOq": "1",
		"\x1bOr": "2",
		"\x1bOs": "3",
		"\x1bOt": "4",
		"\x1bOu": "5",
		"\x1bOv": "6",
		"\x1bOw": "7",
		"\x1bOx": "8",
		"\x1bOy": "9",
		"\x1bOk": "+",
		"\x1bOm": "-",
		"\x1bOj": "*",
		"\x1bOo": "/",
		"\x1bOn": ".",
	};
	const mapped = keypadMap[input];
	if (mapped) return mapped;

	for (const ch of input) {
		const code = ch.charCodeAt(0);
		if (code >= 32 && code <= 126) return ch;
	}
	return null;
}

function canCompleteCsi(chunk: string): boolean {
	return CSI_FINAL_KEYS.has(chunk) || CSI_TILDE_PATTERN.test(chunk);
}

export function coalesceTerminalInput(
	rawInput: string,
	pending: PendingInputSequence | null,
): { normalizedInput: string | null; pending: PendingInputSequence | null } {
	let nextInput = rawInput;
	let nextPending = pending;

	if (nextPending) {
		const base = nextPending.value;
		if (nextPending.hasEscape && base === "\x1b[" && canCompleteCsi(nextInput)) {
			return { normalizedInput: `\x1b[${nextInput}`, pending: null };
		}
		if (nextPending.hasEscape && /^\x1b\[[\d;]+$/.test(base) && canCompleteCsi(nextInput)) {
			return { normalizedInput: `${base}${nextInput}`, pending: null };
		}
		if (
			nextPending.hasEscape &&
			(base === "\x1b[" || /^\x1b\[[\d;]+$/.test(base)) &&
			/^[\d;]+$/.test(nextInput)
		) {
			return { normalizedInput: null, pending: { value: `${base}${nextInput}`, hasEscape: true } };
		}
		if (nextPending.hasEscape && base === "\x1bO" && CSI_FINAL_KEYS.has(nextInput)) {
			return { normalizedInput: `\x1bO${nextInput}`, pending: null };
		}
		if (base === "\x1b" && (nextInput === "[" || nextInput === "O")) {
			return { normalizedInput: null, pending: { value: `\x1b${nextInput}`, hasEscape: true } };
		}
		if (base === "\x1b" && ((nextInput.startsWith("[") && nextInput.length > 1) || (nextInput.startsWith("O") && nextInput.length > 1))) {
			return { normalizedInput: `\x1b${nextInput}`, pending: null };
		}
		nextInput = `${base}${nextInput}`;
		nextPending = null;
	}

	if (nextInput === "\x1b") {
		return { normalizedInput: null, pending: { value: "\x1b", hasEscape: true } };
	}
	if (nextInput === "\x1b[" || nextInput === "\x1bO") {
		return { normalizedInput: null, pending: { value: nextInput, hasEscape: true } };
	}
	if (nextInput === "[" || nextInput === "O") {
		return { normalizedInput: nextInput, pending: null };
	}

	return { normalizedInput: nextInput, pending: nextPending };
}

export function tokenizeTerminalInput(rawInput: string): string[] {
	const tokens: string[] = [];
	let index = 0;
	while (index < rawInput.length) {
		const ch = rawInput.charAt(index);
		if (ch !== "\x1b") {
			tokens.push(ch);
			index += 1;
			continue;
		}

		const next = rawInput[index + 1];
		const third = rawInput[index + 2];
		if (next === "[") {
			let cursor = index + 2;
			let consumed = false;
			while (cursor < rawInput.length) {
				const current = rawInput.charAt(cursor);
				if (CSI_FINAL_KEYS.has(current)) {
					tokens.push(rawInput.slice(index, cursor + 1));
					index = cursor + 1;
					consumed = true;
					break;
				}
				if (current === "~" && CSI_TILDE_PATTERN.test(rawInput.slice(index + 2, cursor + 1))) {
					tokens.push(rawInput.slice(index, cursor + 1));
					index = cursor + 1;
					consumed = true;
					break;
				}
				if (!/[0-9;]/.test(current)) {
					break;
				}
				cursor += 1;
			}
			if (consumed) {
				continue;
			}
		}
		if (next === "O" && third && CSI_FINAL_KEYS.has(third)) {
			tokens.push(rawInput.slice(index, index + 3));
			index += 3;
			continue;
		}
		if (next === "[" || next === "O") {
			tokens.push(rawInput.slice(index, index + 2));
			index += 2;
			continue;
		}
		tokens.push(ch);
		index += 1;
	}
	return tokens;
}

export async function select<T>(items: MenuItem<T>[], options: SelectOptions<T>): Promise<T | null> {
	if (!isTTY()) {
		throw new Error("Interactive select requires a TTY terminal");
	}
	if (items.length === 0) {
		throw new Error("No menu items provided");
	}

	const isSelectable = (item: MenuItem<T>) =>
		!item.disabled && !item.separator && item.kind !== "heading";
	const selectable = items.filter(isSelectable);
	if (selectable.length === 0) {
		throw new Error("All menu items are disabled");
	}
	if (selectable.length === 1) {
		return selectable[0]?.value ?? null;
	}

	const { stdin, stdout } = process;
	let cursor = items.findIndex(isSelectable);
	if (typeof options.initialCursor === "number" && Number.isFinite(options.initialCursor)) {
		const bounded = Math.max(0, Math.min(items.length - 1, Math.trunc(options.initialCursor)));
		cursor = bounded;
	}
	if (cursor < 0 || !isSelectable(items[cursor] as MenuItem<T>)) {
		cursor = items.findIndex(isSelectable);
	}
	if (cursor < 0) cursor = 0;
	let escapeTimeout: ReturnType<typeof setTimeout> | null = null;
	let cleanedUp = false;
	let renderedLines = 0;
	let hasRendered = false;
	let inputGuardUntil = 0;
	const theme = options.theme;
	let rerenderRequested = false;

	const requestRerender = () => {
		rerenderRequested = true;
	};

	const notifyCursorChange = () => {
		if (!options.onCursorChange) return;
		rerenderRequested = false;
		const current = items[cursor];
		writeTuiAudit({
			type: "focus",
			message: options.message,
			cursor,
			label: current?.label,
		});
		options.onCursorChange({
			cursor,
			items,
			requestRerender,
		});
	};

	const drainStdinBuffer = () => {
		try {
			let chunk: Buffer | string | null;
			do {
				chunk = stdin.read();
			} while (chunk !== null);
		} catch {
			// best effort
		}
	};

	const codexColorCode = (color: MenuItem["color"]): string => {
		if (!theme) {
			return colorCode(color);
		}
		switch (color) {
			case "red":
				return theme.colors.danger;
			case "green":
				return theme.colors.success;
			case "yellow":
				return theme.colors.warning;
			case "cyan":
				return theme.colors.accent;
			default:
				return theme.colors.heading;
		}
	};

	const selectedLabelStart = (): string => {
		if (!theme) {
			return `${ANSI.bgGreen}${ANSI.black}${ANSI.bold}`;
		}
		return `${theme.colors.focusBg}${theme.colors.focusText}${ANSI.bold}`;
	};

	const render = () => {
		const columns = stdout.columns ?? 80;
		const rows = stdout.rows ?? 24;
		const previousRenderedLines = renderedLines;
		const subtitleText = options.dynamicSubtitle ? options.dynamicSubtitle() : options.subtitle;
		const focusStyle = options.focusStyle ?? "row-invert";
		let didFullClear = false;

		if (options.clearScreen && !hasRendered) {
			stdout.write(ANSI.clearScreen + ANSI.moveTo(1, 1));
			didFullClear = true;
		} else if (previousRenderedLines > 0) {
			stdout.write(ANSI.up(previousRenderedLines));
		}

		let linesWritten = 0;
		const writeLine = (line: string) => {
			stdout.write(`${ANSI.clearLine}${line}\n`);
			linesWritten += 1;
		};

		const itemRowCost = (item: MenuItem<T>, selected: boolean): number => {
			if (item.separator || item.kind === "heading") {
				return 1;
			}
			let cost = 1;
			if (item.hint) {
				const hintLines = item.hint.split("\n").length;
				if (selected) {
					cost += Math.min(3, hintLines);
				} else if (options.showHintsForUnselected ?? true) {
					cost += Math.min(2, hintLines);
				}
			}
			return cost;
		};

		const subtitleLines = subtitleText ? 2 : 0;
		const fixedLines = 2 + subtitleLines + 2;
		const availableItemRows = Math.max(1, rows - fixedLines);

		let windowStart = 0;
		let windowEnd = items.length;
		const totalRenderedRows = items.reduce(
			(total, item, index) => total + itemRowCost(item, index === cursor),
			0,
		);
		if (totalRenderedRows > availableItemRows) {
			windowStart = cursor;
			windowEnd = cursor + 1;
			let usedRows = itemRowCost(items[cursor] as MenuItem<T>, true);
			let up = cursor - 1;
			let down = cursor + 1;

			while (true) {
				const upCost =
					up >= 0 ? itemRowCost(items[up] as MenuItem<T>, false) : Number.POSITIVE_INFINITY;
				const downCost =
					down < items.length
						? itemRowCost(items[down] as MenuItem<T>, false)
						: Number.POSITIVE_INFINITY;
				const preferUp = upCost <= downCost;

				if (preferUp && up >= 0 && usedRows + upCost <= availableItemRows) {
					usedRows += upCost;
					windowStart = up;
					up -= 1;
					continue;
				}
				if (down < items.length && usedRows + downCost <= availableItemRows) {
					usedRows += downCost;
					windowEnd = down + 1;
					down += 1;
					continue;
				}
				if (up >= 0 && usedRows + upCost <= availableItemRows) {
					usedRows += upCost;
					windowStart = up;
					up -= 1;
					continue;
				}
				break;
			}
		}

		const visibleItems = items.slice(windowStart, windowEnd);
		const border = theme?.colors.border ?? ANSI.dim;
		const muted = theme?.colors.muted ?? ANSI.dim;
		const heading = theme?.colors.heading ?? ANSI.reset;
		const reset = theme?.colors.reset ?? ANSI.reset;
		const selectedGlyph = theme?.glyphs.selected ?? ">";
		const unselectedGlyph = theme?.glyphs.unselected ?? "o";
		const selectedGlyphColor = theme?.colors.success ?? ANSI.green;
		const selectedChip = selectedLabelStart();

		const safeMessage = sanitizeDisplayText(options.message);
		writeLine(`${border}+${reset} ${heading}${truncateAnsi(safeMessage, Math.max(1, columns - 4))}${reset}`);
		if (subtitleText) {
			const safeSubtitle = sanitizeDisplayText(subtitleText);
			writeLine(` ${muted}${truncateAnsi(safeSubtitle, Math.max(1, columns - 2))}${reset}`);
		}
		writeLine("");

		for (let i = 0; i < visibleItems.length; i += 1) {
			const itemIndex = windowStart + i;
			const item = visibleItems[i];
			if (!item) continue;

			if (item.separator) {
				writeLine("");
				continue;
			}

			if (item.kind === "heading") {
				const safeHeading = sanitizeDisplayText(item.label);
				const headingText = truncateAnsi(`${muted}${safeHeading}${reset}`, Math.max(1, columns - 2));
				writeLine(` ${headingText}`);
				continue;
			}

			const selected = itemIndex === cursor;
			const safeLabel = sanitizeDisplayText(item.label);
			const safeSelectedLabel = item.selectedLabel ? sanitizeDisplayText(item.selectedLabel) : safeLabel;
			const safeHintLines = item.hint
				? item.hint.split("\n").map((line) => sanitizeDisplayText(line)).filter((line) => line.length > 0)
				: [];
			if (selected) {
				const selectedText = item.selectedLabel
					? safeSelectedLabel
					: item.disabled
						? item.hideUnavailableSuffix
							? safeLabel
							: `${safeLabel} (unavailable)`
						: safeLabel;
				if (focusStyle === "row-invert") {
					const rowText = `${selectedGlyph} ${selectedText}`;
					const focusedRow = theme
						? `${theme.colors.focusBg}${theme.colors.focusText}${ANSI.bold}${truncateAnsi(rowText, Math.max(1, columns - 2))}${reset}`
						: `${ANSI.inverse}${truncateAnsi(rowText, Math.max(1, columns - 2))}${ANSI.reset}`;
					writeLine(` ${focusedRow}`);
				} else {
					const selectedLabel = `${selectedChip}${selectedText}${reset}`;
					writeLine(` ${selectedGlyphColor}${selectedGlyph}${reset} ${truncateAnsi(selectedLabel, Math.max(1, columns - 4))}`);
				}
				if (safeHintLines.length > 0) {
					const detailLines = safeHintLines.slice(0, 3);
					for (const detailLine of detailLines) {
						const detail = truncateAnsi(detailLine, Math.max(1, columns - 8));
						writeLine(`   ${muted}${detail}${reset}`);
					}
				}
			} else {
				const itemColor = codexColorCode(item.color);
				const labelText = item.disabled
					? item.hideUnavailableSuffix
						? `${muted}${safeLabel}${reset}`
						: `${muted}${safeLabel} (unavailable)${reset}`
					: `${itemColor}${safeLabel}${reset}`;
				writeLine(` ${muted}${unselectedGlyph}${reset} ${truncateAnsi(labelText, Math.max(1, columns - 4))}`);
				if (safeHintLines.length > 0 && (options.showHintsForUnselected ?? true)) {
					const detailLines = safeHintLines.slice(0, 2);
					for (const detailLine of detailLines) {
						const detail = truncateAnsi(`${muted}${detailLine}${reset}`, Math.max(1, columns - 8));
						writeLine(`   ${detail}`);
					}
				}
			}
		}

		const windowHint = items.length > visibleItems.length ? ` (${windowStart + 1}-${windowEnd}/${items.length})` : "";
		const backLabel = options.allowEscape === false ? "" : "Q Back";
		const helpText =
			options.help ??
			`↑↓ Move | Enter Select${backLabel ? ` | ${backLabel}` : ""}${windowHint}`;
		writeLine(` ${muted}${truncateAnsi(helpText, Math.max(1, columns - 2))}${reset}`);
		writeLine(`${border}+${reset}`);

		if (!didFullClear && previousRenderedLines > linesWritten) {
			const extra = previousRenderedLines - linesWritten;
			for (let i = 0; i < extra; i += 1) {
				writeLine("");
			}
		}

		renderedLines = linesWritten;
		hasRendered = true;
	};

	return new Promise((resolve, reject) => {
		const rejectPromise = reject;
		const wasRaw = stdin.isRaw ?? false;
		let refreshTimer: ReturnType<typeof setInterval> | null = null;
		let pendingEscapeSequence: PendingInputSequence | null = null;

		const cleanup = () => {
			if (cleanedUp) return;
			cleanedUp = true;

			if (escapeTimeout) {
				clearTimeout(escapeTimeout);
				escapeTimeout = null;
			}

			try {
				stdin.removeListener("data", onKey);
				stdin.setRawMode(wasRaw);
				stdin.pause();
				if (refreshTimer) {
					clearInterval(refreshTimer);
					refreshTimer = null;
				}
				if (options.clearScreen) {
					stdout.write(ANSI.clearScreen + ANSI.moveTo(1, 1));
				} else if (renderedLines > 0) {
					stdout.write(ANSI.up(renderedLines));
					for (let i = 0; i < renderedLines; i += 1) {
						stdout.write(`${ANSI.clearLine}\n`);
					}
					stdout.write(ANSI.up(renderedLines));
				}
				stdout.write(ANSI.show);
			} catch {
				// best effort cleanup
			}

			process.removeListener("SIGINT", onSignal);
			process.removeListener("SIGTERM", onSignal);
		};

		const finish = (value: T | null) => {
			writeTuiAudit({
				type: "finish",
				message: options.message,
				cursor,
				label: items[cursor]?.label,
				result: value === null ? "cancel" : "selected",
			});
			cleanup();
			resolve(value);
		};

		const fail = (error: unknown): boolean => {
			cleanup();
			rejectPromise(error);
			return true;
		};

		const onSignal = () => finish(null);

		const findNextSelectable = (from: number, direction: 1 | -1): number => {
			if (items.length === 0) return from;
			let next = from;
			do {
				next = (next + direction + items.length) % items.length;
			} while (items[next]?.disabled || items[next]?.separator || items[next]?.kind === "heading");
			return next;
		};

		const onKey = (data: Buffer) => {
			const rawInput = data.toString("utf8");
			writeTuiAudit({
				type: "raw",
				message: options.message,
				bytesHex: Array.from(data.values()).map((value) => value.toString(16).padStart(2, "0")).join(" "),
				utf8: rawInput,
			});

			const processToken = (token: string): boolean => {
				writeTuiAudit({
					type: "token",
					message: options.message,
					cursor,
					token,
				});

				if (escapeTimeout) {
					clearTimeout(escapeTimeout);
					escapeTimeout = null;
				}

				const { normalizedInput, pending } = coalesceTerminalInput(
					token,
					pendingEscapeSequence,
				);
				pendingEscapeSequence = pending;
				writeTuiAudit({
					type: "coalesced",
					message: options.message,
					cursor,
					token,
					normalizedInput,
					pending: pendingEscapeSequence?.value ?? null,
					hasEscape: pendingEscapeSequence?.hasEscape ?? false,
				});
				if (pendingEscapeSequence) {
					if (pendingEscapeSequence.hasEscape && options.allowEscape !== false) {
						const pendingValue = pendingEscapeSequence.value;
						escapeTimeout = setTimeout(() => {
							if (pendingEscapeSequence?.value === pendingValue) {
								pendingEscapeSequence = null;
								finish(null);
							}
						}, ESCAPE_TIMEOUT_MS);
					}
					return false;
				}
				if (normalizedInput === null) {
					return false;
				}

				const normalizedData = Buffer.from(normalizedInput, "utf8");

				if (Date.now() < inputGuardUntil) {
					const guardedAction = parseKey(normalizedData);
					if (guardedAction === "enter" || guardedAction === "escape" || guardedAction === "escape-start") {
						return false;
					}
				}

				const action = parseKey(normalizedData);
				switch (action) {
				case "up":
					writeTuiAudit({ type: "key", message: options.message, action: "up", cursor });
					cursor = findNextSelectable(cursor, -1);
					try {
						notifyCursorChange();
						render();
					} catch (error) {
						return fail(error);
					}
					return false;
				case "down":
					writeTuiAudit({ type: "key", message: options.message, action: "down", cursor });
					cursor = findNextSelectable(cursor, 1);
					try {
						notifyCursorChange();
						render();
					} catch (error) {
						return fail(error);
					}
					return false;
				case "home":
					writeTuiAudit({ type: "key", message: options.message, action: "home", cursor });
					cursor = items.findIndex(isSelectable);
					try {
						notifyCursorChange();
						render();
					} catch (error) {
						return fail(error);
					}
					return false;
				case "end": {
					writeTuiAudit({ type: "key", message: options.message, action: "end", cursor });
					for (let i = items.length - 1; i >= 0; i -= 1) {
						const item = items[i];
						if (item && isSelectable(item)) {
							cursor = i;
							break;
						}
					}
					try {
						notifyCursorChange();
						render();
					} catch (error) {
						return fail(error);
					}
					return false;
				}
				case "enter":
					writeTuiAudit({ type: "key", message: options.message, action: "enter", cursor });
					finish(items[cursor]?.value ?? null);
					return true;
				case "escape":
					writeTuiAudit({ type: "key", message: options.message, action: "escape", cursor });
					if (options.allowEscape !== false) {
						finish(null);
					}
					return true;
				case "escape-start":
					writeTuiAudit({ type: "key", message: options.message, action: "escape-start", cursor });
					pendingEscapeSequence = { value: "\x1b", hasEscape: true };
					if (options.allowEscape !== false) {
						escapeTimeout = setTimeout(() => {
							if (pendingEscapeSequence?.value === "\x1b") {
								pendingEscapeSequence = null;
								finish(null);
							}
						}, ESCAPE_TIMEOUT_MS);
					}
					return false;
				default:
					const hotkey = decodeHotkeyInput(normalizedData);
					if (options.onInput && hotkey) {
						writeTuiAudit({
							type: "input",
							message: options.message,
							cursor,
							hotkey,
						});
						rerenderRequested = false;
						let result: T | null | undefined;
						try {
							result = options.onInput(hotkey, {
								cursor,
								items,
								requestRerender,
							});
						} catch (error) {
							return fail(error);
						}
						if (result !== undefined) {
							finish(result);
							return true;
						}
						if (rerenderRequested) {
							try {
								render();
							} catch (error) {
								return fail(error);
							}
						}
					}
					if ((hotkey === "q" || hotkey === "Q") && options.allowEscape !== false) {
						writeTuiAudit({ type: "key", message: options.message, action: "q-back", cursor });
						finish(null);
						return true;
					}
					return false;
			}
			};

			for (const token of tokenizeTerminalInput(rawInput)) {
				if (processToken(token)) {
					return;
				}
			}
		};

		process.once("SIGINT", onSignal);
		process.once("SIGTERM", onSignal);

		try {
			stdin.setRawMode(true);
		} catch {
			cleanup();
			resolve(null);
			return;
		}

		stdin.resume();
		drainStdinBuffer();
		inputGuardUntil = Date.now() + 120;
		stdout.write(ANSI.hide);
		writeTuiAudit({
			type: "open",
			message: options.message,
			subtitle: options.subtitle,
			itemCount: items.length,
		});
		try {
			notifyCursorChange();
			render();
		} catch (error) {
			fail(error);
			return;
		}
		if (options.dynamicSubtitle && (options.refreshIntervalMs ?? 0) > 0) {
			const intervalMs = Math.max(80, Math.round(options.refreshIntervalMs ?? 0));
			refreshTimer = setInterval(() => {
				try {
					render();
				} catch (error) {
					fail(error);
				}
			}, intervalMs);
		}
		stdin.on("data", onKey);
	});
}
