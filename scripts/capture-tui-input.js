import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

function resolveDefaultLogPath() {
	const home = process.env.USERPROFILE ?? process.env.HOME ?? homedir();
	return join(home, ".opencode", "logs", "capture-tui-input.log");
}

function parseArgs(argv) {
	const parsed = {
		output: resolveDefaultLogPath(),
	};

	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i];
		if (arg === "--output" && argv[i + 1]) {
			parsed.output = argv[i + 1];
			i += 1;
		}
	}

	return parsed;
}

function printableHotkey(value) {
	if (value.length === 1) {
		const code = value.charCodeAt(0);
		if (code >= 32 && code <= 126) return value;
	}
	return null;
}

const { output } = parseArgs(process.argv.slice(2));

const selectModulePath = new URL("../dist/lib/ui/select.js", import.meta.url);
const ansiModulePath = new URL("../dist/lib/ui/ansi.js", import.meta.url);

if (!existsSync(selectModulePath) || !existsSync(ansiModulePath)) {
	console.error("dist/ build output is missing. Run `npm run build` first.");
	process.exit(1);
}

const { coalesceTerminalInput, tokenizeTerminalInput } = await import(selectModulePath);
const { parseKey } = await import(ansiModulePath);
const ESCAPE_TIMEOUT_MS = 50;

const logEvent = (event) => {
	appendFileSync(output, `${JSON.stringify(sanitizeAuditValue("event", { ts: new Date().toISOString(), ...event }))}\n`, {
		encoding: "utf8",
		mode: 0o600,
	});
};

function sanitizeAuditValue(key, value) {
	if (typeof value === "string") {
		if (["utf8", "bytesHex", "token", "normalizedInput", "pending", "hotkey"].includes(key)) {
			return `[redacted:${value.length}]`;
		}
		if (value.includes("@")) {
			return "[redacted-email]";
		}
		return value;
	}
	if (Array.isArray(value)) {
		return value.map((entry) => sanitizeAuditValue(key, entry));
	}
	if (value && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value).map(([entryKey, entryValue]) => [
				entryKey,
				sanitizeAuditValue(entryKey, entryValue),
			]),
		);
	}
	return value;
}

if (!process.stdin.isTTY || !process.stdout.isTTY) {
	console.error("capture-tui-input requires a TTY");
	process.exit(1);
}

mkdirSync(dirname(output), { recursive: true });

console.log(`Logging raw terminal input to ${output}`);
console.log("Press keys to capture. Ctrl+C exits.");

let pending = null;
let pendingEscapeTimer = null;
const stdin = process.stdin;
const stdout = process.stdout;
const wasRaw = stdin.isRaw ?? false;
let cleanedUp = false;

const cleanup = () => {
	if (cleanedUp) return;
	cleanedUp = true;
	if (pendingEscapeTimer) {
		clearTimeout(pendingEscapeTimer);
		pendingEscapeTimer = null;
	}
	try {
		stdin.setRawMode(wasRaw);
		stdin.pause();
	} catch {
		// best effort cleanup
	}
};

const exitCapture = (code = 0) => {
	cleanup();
	stdout.write("\nCapture complete.\n");
	process.exit(code);
};

const handleFatal = (error) => {
	cleanup();
	console.error(error);
	process.exit(1);
};

stdin.setRawMode(true);
stdin.resume();

stdin.on("data", (data) => {
	try {
		const rawInput = data.toString("utf8");
		if (pendingEscapeTimer) {
			clearTimeout(pendingEscapeTimer);
			pendingEscapeTimer = null;
		}
		logEvent({
			type: "raw",
			bytesHex: Array.from(data.values()).map((value) => value.toString(16).padStart(2, "0")).join(" "),
			utf8: rawInput,
		});

		let shouldExit = false;
		for (const token of tokenizeTerminalInput(rawInput)) {
			const coalesced = coalesceTerminalInput(token, pending);
			pending = coalesced.pending;
			logEvent({
				type: "token",
				token,
				pending: pending?.value ?? null,
				hasEscape: pending?.hasEscape ?? false,
				normalizedInput: coalesced.normalizedInput,
			});
			if (coalesced.normalizedInput === null) {
				if (pending?.hasEscape && pending.value === "\u001b") {
					pendingEscapeTimer = setTimeout(() => {
						logEvent({
							type: "timeout",
							reason: "escape-start",
						});
						exitCapture(0);
					}, ESCAPE_TIMEOUT_MS);
				}
				continue;
			}

			const buffer = Buffer.from(coalesced.normalizedInput, "utf8");
			const action = parseKey(buffer);
			const hotkey = printableHotkey(coalesced.normalizedInput);
			logEvent({
				type: "parsed",
				normalizedInput: coalesced.normalizedInput,
				action,
				hotkey,
			});

			if (action === "escape" || action === "escape-start" || coalesced.normalizedInput === "\u0003") {
				shouldExit = true;
				break;
			}
		}

		if (shouldExit) {
			exitCapture(0);
		}
	} catch (error) {
		handleFatal(error);
	}
});

process.on("SIGINT", () => exitCapture(0));
process.on("SIGTERM", () => exitCapture(0));
process.on("uncaughtException", handleFatal);
process.on("unhandledRejection", handleFatal);
