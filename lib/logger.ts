import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { PLUGIN_NAME } from "./constants.js";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogClient {
	app?: {
		log?: (options: {
			body: {
				service: string;
				level: LogLevel;
				message: string;
				extra?: Record<string, unknown>;
			};
		}) => unknown;
	};
}

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
	debug: 0,
	info: 1,
	warn: 2,
	error: 3,
};

const TOKEN_PATTERNS = [
	/eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
	/[a-f0-9]{40,}/gi,
	/sk-[A-Za-z0-9]{20,}/g,
	/Bearer\s+\S+/gi,
];

const SENSITIVE_KEYS = new Set([
	"access",
	"accesstoken",
	"access_token",
	"refresh",
	"refreshtoken",
	"refresh_token",
	"token",
	"authorization",
	"apikey",
	"api_key",
	"secret",
	"password",
	"credential",
	"id_token",
	"idtoken",
]);

function maskToken(token: string): string {
	if (token.length <= 12) return "***MASKED***";
	return `${token.slice(0, 6)}...${token.slice(-4)}`;
}

function maskString(value: string): string {
	let result = value;
	for (const pattern of TOKEN_PATTERNS) {
		result = result.replace(pattern, (match) => maskToken(match));
	}
	return result;
}

function sanitizeValue(value: unknown, depth = 0): unknown {
	if (depth > 10) return "[max depth]";

	if (typeof value === "string") {
		return maskString(value);
	}

	if (Array.isArray(value)) {
		return value.map((item) => sanitizeValue(item, depth + 1));
	}

	if (value !== null && typeof value === "object") {
		const sanitized: Record<string, unknown> = {};
		for (const [key, val] of Object.entries(value)) {
			const normalizedKey = key.toLowerCase().replace(/[-_]/g, "");
			if (SENSITIVE_KEYS.has(normalizedKey)) {
				sanitized[key] = typeof val === "string" ? maskToken(val) : "***MASKED***";
			} else {
				sanitized[key] = sanitizeValue(val, depth + 1);
			}
		}
		return sanitized;
	}

	return value;
}

function parseLogLevel(value: string | undefined): LogLevel {
	if (!value) return "info";
	const normalized = value.toLowerCase().trim() as LogLevel;
	if (normalized in LOG_LEVEL_PRIORITY) return normalized;
	return "info";
}

export const LOGGING_ENABLED = process.env.ENABLE_PLUGIN_REQUEST_LOGGING === "1";
export const DEBUG_ENABLED = process.env.DEBUG_CODEX_PLUGIN === "1" || LOGGING_ENABLED;
export const LOG_LEVEL = parseLogLevel(process.env.CODEX_PLUGIN_LOG_LEVEL);
const CONSOLE_LOG_ENABLED = process.env.CODEX_CONSOLE_LOG === "1";
const LOG_DIR = join(homedir(), ".opencode", "logs", "codex-plugin");

let client: LogClient | null = null;

export function initLogger(newClient: LogClient): void {
	client = newClient;
}

function logToApp(
	level: LogLevel,
	message: string,
	data?: unknown,
	service: string = PLUGIN_NAME,
): void {
	const appLog = client?.app?.log;
	if (!appLog) return;

	const sanitizedMessage = maskString(message);
	const sanitizedData = data === undefined ? undefined : sanitizeValue(data);
	const extra =
		sanitizedData === undefined
			? undefined
			: { data: typeof sanitizedData === "object" ? sanitizedData : { value: sanitizedData } };

	try {
		const result = appLog({
			body: {
				service,
				level,
				message: sanitizedMessage,
				extra,
			},
		});
		if (result && typeof (result as Promise<unknown>).catch === "function") {
			(result as Promise<unknown>).catch(() => {});
		}
	} catch {
		// Ignore app log failures
	}
}

function logToConsole(level: LogLevel, message: string, data?: unknown): void {
	if (!CONSOLE_LOG_ENABLED) return;
	const sanitizedMessage = maskString(message);
	const sanitizedData = data === undefined ? undefined : sanitizeValue(data);
	if (sanitizedData !== undefined) {
		if (level === "warn") console.warn(sanitizedMessage, sanitizedData);
		else if (level === "error") console.error(sanitizedMessage, sanitizedData);
		else console.log(sanitizedMessage, sanitizedData);
		return;
	}

	if (level === "warn") console.warn(sanitizedMessage);
	else if (level === "error") console.error(sanitizedMessage);
	else console.log(sanitizedMessage);
}

if (LOGGING_ENABLED) {
	logToConsole(
		"info",
		`[${PLUGIN_NAME}] Request logging ENABLED - logs will be saved to: ${LOG_DIR}`,
	);
}
if (DEBUG_ENABLED && !LOGGING_ENABLED) {
	logToConsole(
		"info",
		`[${PLUGIN_NAME}] Debug logging ENABLED (level: ${LOG_LEVEL})`,
	);
}

let requestCounter = 0;

function shouldLog(level: LogLevel): boolean {
	if (level === "error") return true;
	if (!DEBUG_ENABLED && !LOGGING_ENABLED) return false;
	return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[LOG_LEVEL];
}

function formatDuration(ms: number): string {
	if (ms < 1000) return `${Math.round(ms)}ms`;
	if (ms < 60000) return `${(ms / 1000).toFixed(2)}s`;
	const minutes = Math.floor(ms / 60000);
	const seconds = ((ms % 60000) / 1000).toFixed(1);
	return `${minutes}m ${seconds}s`;
}

export function logRequest(stage: string, data: Record<string, unknown>): void {
	if (!LOGGING_ENABLED) return;

	if (!existsSync(LOG_DIR)) {
		mkdirSync(LOG_DIR, { recursive: true });
	}

	const timestamp = new Date().toISOString();
	const requestId = ++requestCounter;
	const filename = join(LOG_DIR, `request-${requestId}-${stage}.json`);
	const sanitizedData = sanitizeValue(data) as Record<string, unknown>;

	try {
		writeFileSync(
			filename,
			JSON.stringify(
				{
					timestamp,
					requestId,
					stage,
					...sanitizedData,
				},
				null,
				2,
			),
			"utf8",
		);
		logToApp("info", `Logged ${stage} to ${filename}`);
		logToConsole("info", `[${PLUGIN_NAME}] Logged ${stage} to ${filename}`);
	} catch (e) {
		const error = e as Error;
		logToApp("error", `Failed to write log: ${error.message}`);
		logToConsole("error", `[${PLUGIN_NAME}] Failed to write log: ${error.message}`);
	}
}

export function logDebug(message: string, data?: unknown): void {
	if (!shouldLog("debug")) return;
	logToApp("debug", message, data);

	const text = `[${PLUGIN_NAME}] ${message}`;
	logToConsole("debug", text, data);
}

export function logInfo(message: string, data?: unknown): void {
	if (!shouldLog("info")) return;
	logToApp("info", message, data);

	const text = `[${PLUGIN_NAME}] ${message}`;
	logToConsole("info", text, data);
}

export function logWarn(message: string, data?: unknown): void {
	if (!shouldLog("warn")) return;
	logToApp("warn", message, data);
	const text = `[${PLUGIN_NAME}] ${message}`;
	logToConsole("warn", text, data);
}

export function logError(message: string, data?: unknown): void {
	logToApp("error", message, data);
	const text = `[${PLUGIN_NAME}] ${message}`;
	logToConsole("error", text, data);
}

export interface ScopedLogger {
	debug(message: string, data?: unknown): void;
	info(message: string, data?: unknown): void;
	warn(message: string, data?: unknown): void;
	error(message: string, data?: unknown): void;
	time(label: string): () => number;
	timeEnd(label: string, startTime: number): void;
}

const timers: Map<string, number> = new Map();

export function createLogger(scope: string): ScopedLogger {
	const prefix = `[${PLUGIN_NAME}:${scope}]`;
	const service = `${PLUGIN_NAME}.${scope}`;

	return {
		debug(message: string, data?: unknown) {
			if (!shouldLog("debug")) return;
			const text = `${prefix} ${message}`;
			logToApp("debug", text, data, service);
			logToConsole("debug", text, data);
		},
		info(message: string, data?: unknown) {
			if (!shouldLog("info")) return;
			const text = `${prefix} ${message}`;
			logToApp("info", text, data, service);
			logToConsole("info", text, data);
		},
		warn(message: string, data?: unknown) {
			if (!shouldLog("warn")) return;
			const text = `${prefix} ${message}`;
			logToApp("warn", text, data, service);
			logToConsole("warn", text, data);
		},
		error(message: string, data?: unknown) {
			const text = `${prefix} ${message}`;
			logToApp("error", text, data, service);
			logToConsole("error", text, data);
		},
		time(label: string): () => number {
			const key = `${scope}:${label}`;
			const startTime = performance.now();
			timers.set(key, startTime);
			return () => {
				const endTime = performance.now();
				const duration = endTime - startTime;
				timers.delete(key);
				if (shouldLog("debug")) {
					const text = `${prefix} ${label}: ${formatDuration(duration)}`;
					logToApp("debug", text, undefined, service);
					logToConsole("debug", text);
				}
				return duration;
			};
		},
		timeEnd(label: string, startTime: number): void {
			const duration = performance.now() - startTime;
			if (shouldLog("debug")) {
				const text = `${prefix} ${label}: ${formatDuration(duration)}`;
				logToApp("debug", text, undefined, service);
				logToConsole("debug", text);
			}
		},
	};
}

export function getRequestId(): number {
	return requestCounter;
}

export { formatDuration };
