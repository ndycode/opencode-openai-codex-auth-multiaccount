import { createLogger, logRequest, LOGGING_ENABLED } from "../logger.js";

import type { JsonRepairMode, SSEEventData } from "../types.js";

const log = createLogger("response-handler");

const MAX_SSE_SIZE = 10 * 1024 * 1024; // 10MB limit to prevent memory exhaustion
const DEFAULT_STREAM_STALL_TIMEOUT_MS = 45_000;
const STREAM_ERROR_CODE = "stream_error";
const SSE_DATA_PREFIX = "data:";
const TASK_TOOL_NAMES = new Set(["task", "functions.task"]);

type ParsedSseResult =
	| {
			kind: "response";
			response: unknown;
	  }
	| {
			kind: "error";
			error: {
				message: string;
				type?: string;
				code?: string | number;
			};
	  };

function toRecord(value: unknown): Record<string, unknown> | null {
	if (value && typeof value === "object") {
		return value as Record<string, unknown>;
	}
	return null;
}

function extractErrorFromRecord(errorRecord: Record<string, unknown> | null): {
	message: string;
	type?: string;
	code?: string | number;
} | null {
	if (!errorRecord) return null;
	const message =
		typeof errorRecord.message === "string" ? errorRecord.message.trim() : "";
	if (!message) return null;
	const type = typeof errorRecord.type === "string" ? errorRecord.type : undefined;
	const rawCode = errorRecord.code;
	const code =
		typeof rawCode === "string" || typeof rawCode === "number"
			? rawCode
			: undefined;

	return { message, type, code };
}

function extractStreamError(event: SSEEventData): {
	message: string;
	type?: string;
	code?: string | number;
} {
	const errorRecord = toRecord((event as { error?: unknown }).error);
	const eventMessage = (event as { message?: unknown }).message;
	const parsedError = extractErrorFromRecord(errorRecord);
	if (parsedError) return parsedError;

	const message =
		(typeof eventMessage === "string" ? eventMessage.trim() : "") ||
		"Codex stream emitted an error event";
	return { message };
}

function extractResponseError(responseRecord: Record<string, unknown>): {
	message: string;
	type?: string;
	code?: string | number;
} | null {
	const status = typeof responseRecord.status === "string" ? responseRecord.status : "";
	const parsedError = extractErrorFromRecord(
		toRecord((responseRecord as { error?: unknown }).error),
	);
	if (parsedError) return parsedError;
	if (status === "failed" || status === "incomplete") {
		return { message: `Codex stream ended with status: ${status}` };
	}
	return null;
}

function parseDataPayload(line: string): string | null {
	if (!line.startsWith(SSE_DATA_PREFIX)) return null;
	const payload = line.slice(SSE_DATA_PREFIX.length).trimStart();
	if (!payload || payload === "[DONE]") return null;
	return payload;
}

function stripCodeFence(text: string): string {
	const trimmed = text.trim();
	const fencedMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
	return fencedMatch?.[1]?.trim() ?? trimmed;
}

function extractFirstJsonCandidate(text: string): string | null {
	const trimmed = stripCodeFence(text);
	const objectStart = trimmed.indexOf("{");
	const arrayStart = trimmed.indexOf("[");
	const starts = [objectStart, arrayStart].filter((index) => index >= 0);
	if (starts.length === 0) return null;
	const start = Math.min(...starts);
	const opening = trimmed[start];
	const closing = opening === "[" ? "]" : "}";
	let depth = 0;
	let inString = false;
	let escaped = false;
	for (let i = start; i < trimmed.length; i += 1) {
		const char = trimmed[i];
		if (inString) {
			if (escaped) {
				escaped = false;
				continue;
			}
			if (char === "\\") {
				escaped = true;
				continue;
			}
			if (char === '"') {
				inString = false;
			}
			continue;
		}
		if (char === '"') {
			inString = true;
			continue;
		}
		if (char === opening) depth += 1;
		if (char === closing) {
			depth -= 1;
			if (depth === 0) {
				return trimmed.slice(start, i + 1);
			}
		}
	}
	return null;
}

function removeTrailingCommas(jsonText: string): string {
	let result = "";
	let inString = false;
	let escaped = false;
	for (let index = 0; index < jsonText.length; index += 1) {
		const char = jsonText[index];
		if (inString) {
			result += char;
			if (escaped) {
				escaped = false;
				continue;
			}
			if (char === "\\") {
				escaped = true;
				continue;
			}
			if (char === '"') {
				inString = false;
			}
			continue;
		}

		if (char === '"') {
			inString = true;
			result += char;
			continue;
		}

		if (char === ",") {
			let lookahead = index + 1;
			while (lookahead < jsonText.length) {
				const lookaheadChar = jsonText[lookahead];
				if (lookaheadChar === undefined || !/\s/.test(lookaheadChar)) {
					break;
				}
				lookahead += 1;
			}
			const next = jsonText[lookahead];
			if (next === "}" || next === "]") {
				continue;
			}
		}

		result += char;
	}
	return result;
}

function attemptJsonRepair(payload: string): string | null {
	const candidate = extractFirstJsonCandidate(payload);
	if (!candidate) return null;
	const repaired = removeTrailingCommas(candidate).trim();
	return repaired.length > 0 ? repaired : null;
}

function parseSseJsonPayload(
	payload: string,
	jsonRepairMode: JsonRepairMode,
): { data: SSEEventData; repaired: boolean } | null {
	try {
		return { data: JSON.parse(payload) as SSEEventData, repaired: false };
	} catch {
		if (jsonRepairMode === "off") return null;
		const repairedPayload = attemptJsonRepair(payload);
		if (!repairedPayload || repairedPayload === payload) return null;
		try {
			return { data: JSON.parse(repairedPayload) as SSEEventData, repaired: true };
		} catch {
			return null;
		}
	}
}

function isTaskToolName(value: unknown): value is string {
	if (typeof value !== "string") return false;
	return TASK_TOOL_NAMES.has(value.trim().toLowerCase());
}

function normalizeTaskArgumentsValue(value: unknown): {
	normalized: unknown;
	changed: boolean;
} {
	if (typeof value === "string") {
		try {
			const parsed = JSON.parse(value) as unknown;
			const parsedRecord = toRecord(parsed);
			if (!parsedRecord || parsedRecord.run_in_background !== undefined) {
				return { normalized: value, changed: false };
			}
			parsedRecord.run_in_background = false;
			return { normalized: JSON.stringify(parsedRecord), changed: true };
		} catch {
			return { normalized: value, changed: false };
		}
	}

	const record = toRecord(value);
	if (!record || record.run_in_background !== undefined) {
		return { normalized: value, changed: false };
	}
	record.run_in_background = false;
	return { normalized: record, changed: true };
}

function normalizeTaskRunInBackgroundInFunctionLike(
	record: Record<string, unknown>,
): boolean {
	let changed = false;

	if (
		record.type === "function_call" &&
		isTaskToolName(record.name) &&
		Object.prototype.hasOwnProperty.call(record, "arguments")
	) {
		const normalized = normalizeTaskArgumentsValue(record.arguments);
		if (normalized.changed) {
			record.arguments = normalized.normalized;
			changed = true;
		}
	}

	const functionRecord = toRecord(record.function);
	if (functionRecord && isTaskToolName(functionRecord.name)) {
		const normalized = normalizeTaskArgumentsValue(functionRecord.arguments);
		if (normalized.changed) {
			functionRecord.arguments = normalized.normalized;
			changed = true;
		}
	}

	return changed;
}

function normalizeTaskRunInBackgroundInPayload(value: unknown): boolean {
	if (Array.isArray(value)) {
		let changed = false;
		for (const item of value) {
			if (normalizeTaskRunInBackgroundInPayload(item)) {
				changed = true;
			}
		}
		return changed;
	}

	const record = toRecord(value);
	if (!record) return false;

	let changed = normalizeTaskRunInBackgroundInFunctionLike(record);
	for (const nested of Object.values(record)) {
		if (normalizeTaskRunInBackgroundInPayload(nested)) {
			changed = true;
		}
	}

	return changed;
}

/**

 * Parse SSE stream to extract final response
 * @param sseText - Complete SSE stream text
 * @returns Final response object or null if not found
 */
function parseSseStream(
	sseText: string,
	options?: { jsonRepairMode?: JsonRepairMode },
): ParsedSseResult | null {
	const lines = sseText.split(/\r?\n/);
	const jsonRepairMode = options?.jsonRepairMode ?? "safe";

	for (const line of lines) {
		const trimmedLine = line.trim();
		const payload = parseDataPayload(trimmedLine);
		if (payload) {
			const parsedPayload = parseSseJsonPayload(payload, jsonRepairMode);
			if (parsedPayload) {
				const { data, repaired } = parsedPayload;
				normalizeTaskRunInBackgroundInPayload(data);
				if (repaired) {
					log.warn("Applied safe JSON repair to SSE payload", {
						payloadPreview: payload.slice(0, 200),
					});
					logRequest("stream-json-repair", { payloadPreview: payload.slice(0, 200) });
				}
				const responseRecord = toRecord((data as { response?: unknown }).response);

				if (data.type === "error" || data.type === "response.error") {
					const parsedError = extractStreamError(data);
					log.error("SSE error event received", { error: parsedError });
					return { kind: "error", error: parsedError };
				}

				if (data.type === "response.failed" || data.type === "response.incomplete") {
					const parsedError =
						(responseRecord && extractResponseError(responseRecord)) ??
						extractStreamError(data);
					log.error("SSE response terminal error event received", {
						type: data.type,
						error: parsedError,
					});
					return { kind: "error", error: parsedError };
				}

				if (data.type === "response.done" || data.type === "response.completed") {
					if (responseRecord) {
						const parsedError = extractResponseError(responseRecord);
						if (parsedError) {
							log.error("SSE response completed with terminal error", {
								error: parsedError,
								status: responseRecord.status,
							});
							return { kind: "error", error: parsedError };
						}
					}
					return { kind: "response", response: data.response };
				}
			}
		}
	}

	return null;
}

/**
 * Convert SSE stream response to JSON for generateText()
 * @param response - Fetch response with SSE stream
 * @param headers - Response headers
 * @returns Response with JSON body
 */
export async function convertSseToJson(
	response: Response,
	headers: Headers,
	options?: { streamStallTimeoutMs?: number; jsonRepairMode?: JsonRepairMode },
): Promise<Response> {
	if (!response.body) {
		throw new Error('[openai-codex-plugin] Response has no body');
	}
	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let fullText = '';
	const streamStallTimeoutMs = Math.max(
		1_000,
		Math.floor(options?.streamStallTimeoutMs ?? DEFAULT_STREAM_STALL_TIMEOUT_MS),
	);

	try {
		// Consume the entire stream
		while (true) {
			const { done, value } = await readWithTimeout(reader, streamStallTimeoutMs);
			if (done) break;
			fullText += decoder.decode(value, { stream: true });
			if (fullText.length > MAX_SSE_SIZE) {
				throw new Error(`SSE response exceeds ${MAX_SSE_SIZE} bytes limit`);
			}
		}

		if (LOGGING_ENABLED) {
			logRequest("stream-full", { fullContent: fullText });
		}

		// Parse SSE events to extract the final response
		const parsedResult = parseSseStream(fullText, {
			jsonRepairMode: options?.jsonRepairMode,
		});

		if (parsedResult?.kind === "error") {
			log.warn("SSE stream returned an error event", parsedResult.error);
			logRequest("stream-error", {
				error: parsedResult.error.message,
				type: parsedResult.error.type,
				code: parsedResult.error.code,
			});

			const jsonHeaders = new Headers(headers);
			jsonHeaders.set("content-type", "application/json; charset=utf-8");
			const status = response.status >= 400 ? response.status : 502;
			const payload = {
				error: {
					message: parsedResult.error.message,
					type: parsedResult.error.type ?? STREAM_ERROR_CODE,
					code: parsedResult.error.code ?? STREAM_ERROR_CODE,
				},
			};

			return new Response(JSON.stringify(payload), {
				status,
				statusText: status === 502 ? "Bad Gateway" : response.statusText,
				headers: jsonHeaders,
			});
		}

		const finalResponse =
			parsedResult?.kind === "response" ? parsedResult.response : null;

		if (!finalResponse) {
			log.warn("Could not find final response in SSE stream");

			logRequest("stream-error", { error: "No response.done event found" });

			// Return original stream if we can't parse
			return new Response(fullText, {
				status: response.status,
				statusText: response.statusText,
				headers: headers,
			});
		}

		// Return as plain JSON (not SSE)
		const jsonHeaders = new Headers(headers);
		jsonHeaders.set('content-type', 'application/json; charset=utf-8');

		return new Response(JSON.stringify(finalResponse), {
			status: response.status,
			statusText: response.statusText,
			headers: jsonHeaders,
		});

	} catch (error) {
		log.error("Error converting stream", { error: String(error) });
		logRequest("stream-error", { error: String(error) });
		if (typeof reader.cancel === "function") {
			await reader.cancel(String(error)).catch(() => {});
		}
		throw error;
	} finally {
		// Release the reader lock to prevent resource leaks
		reader.releaseLock();
	}

}

function rewriteSseDataLine(line: string): string {
	const payload = parseDataPayload(line.trim());
	if (!payload) return line;

	const parsedPayload = parseSseJsonPayload(payload, "safe");
	if (!parsedPayload) return line;

	const { data } = parsedPayload;
	const changed = normalizeTaskRunInBackgroundInPayload(data);
	if (!changed) return line;

	return `${SSE_DATA_PREFIX} ${JSON.stringify(data)}`;
}

export function normalizeTaskToolCallsInSseStream(
	body: ReadableStream<Uint8Array> | null,
): ReadableStream<Uint8Array> | null {
	if (!body) return body;

	const decoder = new TextDecoder();
	const encoder = new TextEncoder();
	let pending = "";

	return body.pipeThrough(
		new TransformStream<Uint8Array, Uint8Array>({
			transform(chunk, controller) {
				pending += decoder.decode(chunk, { stream: true });
				const parts = pending.split(/\r?\n/);
				pending = parts.pop() ?? "";

				for (const line of parts) {
					controller.enqueue(encoder.encode(`${rewriteSseDataLine(line)}\n`));
				}
			},
			flush(controller) {
				pending += decoder.decode();
				if (!pending) return;
				controller.enqueue(encoder.encode(rewriteSseDataLine(pending)));
			},
		}),
	);
}

/**
 * Ensure response has content-type header
 * @param headers - Response headers
 * @returns Headers with content-type set
 */
export function ensureContentType(headers: Headers): Headers {
	const responseHeaders = new Headers(headers);

	if (!responseHeaders.has('content-type')) {
		responseHeaders.set('content-type', 'text/event-stream; charset=utf-8');
	}

	return responseHeaders;
}

async function readWithTimeout(
	reader: ReadableStreamDefaultReader<Uint8Array>,
	timeoutMs: number,
): Promise<{ done: boolean; value?: Uint8Array }> {
	let timeoutId: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			reader.read(),
			new Promise<never>((_, reject) => {
				timeoutId = setTimeout(() => {
					reject(
						new Error(
							`SSE stream stalled for ${timeoutMs}ms while waiting for response.done`,
						),
					);
				}, timeoutMs);
			}),
		]);
	} finally {
		if (timeoutId !== undefined) {
			clearTimeout(timeoutId);
		}
	}
}

/**
 * Check if a non-streaming response is empty or malformed.
 * Returns true if the response body is empty, null, or lacks meaningful content.
 * @param body - Parsed JSON body from the response
 * @returns True if response should be considered empty/malformed
 */
export function isEmptyResponse(body: unknown): boolean {
	if (body === null || body === undefined) return true;
	if (typeof body === 'string' && body.trim() === '') return true;
	if (typeof body !== 'object') return false;

	const obj = body as Record<string, unknown>;

	if (Object.keys(obj).length === 0) return true;

	const hasOutput = 'output' in obj && obj.output !== null && obj.output !== undefined;
	const hasChoices = 'choices' in obj && Array.isArray(obj.choices) && 
		obj.choices.some(c => c !== null && c !== undefined && typeof c === 'object' && Object.keys(c as object).length > 0);
	const hasContent = 'content' in obj && obj.content !== null && obj.content !== undefined &&
		(typeof obj.content !== 'string' || obj.content.trim() !== '');

	if ('id' in obj || 'object' in obj || 'model' in obj) {
		return !hasOutput && !hasChoices && !hasContent;
	}

	return false;
}
