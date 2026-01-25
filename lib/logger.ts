import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { PLUGIN_NAME } from "./constants.js";

export type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
	debug: 0,
	info: 1,
	warn: 2,
	error: 3,
};

function parseLogLevel(value: string | undefined): LogLevel {
	if (!value) return "info";
	const normalized = value.toLowerCase().trim() as LogLevel;
	if (normalized in LOG_LEVEL_PRIORITY) return normalized;
	return "info";
}

export const LOGGING_ENABLED = process.env.ENABLE_PLUGIN_REQUEST_LOGGING === "1";
export const DEBUG_ENABLED = process.env.DEBUG_CODEX_PLUGIN === "1" || LOGGING_ENABLED;
export const LOG_LEVEL = parseLogLevel(process.env.CODEX_PLUGIN_LOG_LEVEL);
const LOG_DIR = join(homedir(), ".opencode", "logs", "codex-plugin");

if (LOGGING_ENABLED) {
	console.log(`[${PLUGIN_NAME}] Request logging ENABLED - logs will be saved to:`, LOG_DIR);
}
if (DEBUG_ENABLED && !LOGGING_ENABLED) {
	console.log(`[${PLUGIN_NAME}] Debug logging ENABLED (level: ${LOG_LEVEL})`);
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

	try {
		writeFileSync(
			filename,
			JSON.stringify(
				{
					timestamp,
					requestId,
					stage,
					...data,
				},
				null,
				2,
			),
			"utf8",
		);
		console.log(`[${PLUGIN_NAME}] Logged ${stage} to ${filename}`);
	} catch (e) {
		const error = e as Error;
		console.error(`[${PLUGIN_NAME}] Failed to write log:`, error.message);
	}
}

export function logDebug(message: string, data?: unknown): void {
	if (!shouldLog("debug")) return;

	if (data !== undefined) {
		console.log(`[${PLUGIN_NAME}] ${message}`, data);
	} else {
		console.log(`[${PLUGIN_NAME}] ${message}`);
	}
}

export function logInfo(message: string, data?: unknown): void {
	if (!shouldLog("info")) return;

	if (data !== undefined) {
		console.log(`[${PLUGIN_NAME}] ${message}`, data);
	} else {
		console.log(`[${PLUGIN_NAME}] ${message}`);
	}
}

export function logWarn(message: string, data?: unknown): void {
	if (!shouldLog("warn")) return;
	if (data !== undefined) {
		console.warn(`[${PLUGIN_NAME}] ${message}`, data);
	} else {
		console.warn(`[${PLUGIN_NAME}] ${message}`);
	}
}

export function logError(message: string, data?: unknown): void {
	if (data !== undefined) {
		console.error(`[${PLUGIN_NAME}] ${message}`, data);
	} else {
		console.error(`[${PLUGIN_NAME}] ${message}`);
	}
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

	return {
		debug(message: string, data?: unknown) {
			if (!shouldLog("debug")) return;
			if (data !== undefined) {
				console.log(`${prefix} ${message}`, data);
			} else {
				console.log(`${prefix} ${message}`);
			}
		},
		info(message: string, data?: unknown) {
			if (!shouldLog("info")) return;
			if (data !== undefined) {
				console.log(`${prefix} ${message}`, data);
			} else {
				console.log(`${prefix} ${message}`);
			}
		},
		warn(message: string, data?: unknown) {
			if (!shouldLog("warn")) return;
			if (data !== undefined) {
				console.warn(`${prefix} ${message}`, data);
			} else {
				console.warn(`${prefix} ${message}`);
			}
		},
		error(message: string, data?: unknown) {
			if (data !== undefined) {
				console.error(`${prefix} ${message}`, data);
			} else {
				console.error(`${prefix} ${message}`);
			}
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
					console.log(`${prefix} ${label}: ${formatDuration(duration)}`);
				}
				return duration;
			};
		},
		timeEnd(label: string, startTime: number): void {
			const duration = performance.now() - startTime;
			if (shouldLog("debug")) {
				console.log(`${prefix} ${label}: ${formatDuration(duration)}`);
			}
		},
	};
}

export function getRequestId(): number {
	return requestCounter;
}

export { formatDuration };
