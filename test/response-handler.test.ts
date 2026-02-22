import { describe, it, expect, vi } from 'vitest';
import {
	ensureContentType,
	convertSseToJson,
	isEmptyResponse,
	normalizeTaskToolCallsInSseStream,
} from '../lib/request/response-handler.js';

describe('Response Handler Module', () => {
	describe('ensureContentType', () => {
		it('should preserve existing content-type', () => {
			const headers = new Headers();
			headers.set('content-type', 'application/json');
			const result = ensureContentType(headers);
			expect(result.get('content-type')).toBe('application/json');
		});

		it('should add default content-type if missing', () => {
			const headers = new Headers();
			const result = ensureContentType(headers);
			expect(result.get('content-type')).toBe('text/event-stream; charset=utf-8');
		});

		it('should not modify original headers', () => {
			const headers = new Headers();
			const result = ensureContentType(headers);
			expect(headers.has('content-type')).toBe(false);
			expect(result.has('content-type')).toBe(true);
		});
	});

	describe('convertSseToJson', () => {
		it('should throw error if response has no body', async () => {
			const response = new Response(null);
			const headers = new Headers();

			await expect(convertSseToJson(response, headers)).rejects.toThrow(
				'Response has no body'
			);
		});

		it('should parse SSE stream with response.done event', async () => {
			const sseContent = `data: {"type":"response.started"}
data: {"type":"response.done","response":{"id":"resp_123","output":"test"}}
`;
			const response = new Response(sseContent);
			const headers = new Headers();

			const result = await convertSseToJson(response, headers);
			const body = await result.json();

			expect(body).toEqual({ id: 'resp_123', output: 'test' });
			expect(result.headers.get('content-type')).toBe('application/json; charset=utf-8');
		});

		it('should inject run_in_background=false for task function calls', async () => {
			const sseContent = `data: {"type":"response.done","response":{"id":"resp_task","output":[{"type":"function_call","name":"task","arguments":"{\\"category\\":\\"quick\\"}"}]}}
`;
			const response = new Response(sseContent);
			const headers = new Headers();

			const result = await convertSseToJson(response, headers);
			const body = await result.json() as {
				output?: Array<{ type?: string; name?: string; arguments?: string }>;
			};
			const firstItem = body.output?.[0];
			expect(firstItem?.name).toBe('task');
			const parsedArguments = JSON.parse(firstItem?.arguments ?? '{}') as Record<string, unknown>;
			expect(parsedArguments.run_in_background).toBe(false);
		});

		it('should parse SSE stream with response.completed event', async () => {
			const sseContent = `data: {"type":"response.started"}
data: {"type":"response.completed","response":{"id":"resp_456","output":"done"}}
`;
			const response = new Response(sseContent);
			const headers = new Headers();

			const result = await convertSseToJson(response, headers);
			const body = await result.json();

			expect(body).toEqual({ id: 'resp_456', output: 'done' });
		});

		it('should convert SSE error events into JSON error responses', async () => {
			const sseContent = `data: {"type":"error","error":{"message":"Tool call failed","code":"tool_failed"}}`;
			const response = new Response(sseContent);
			const headers = new Headers();

			const result = await convertSseToJson(response, headers);
			const body = await result.json();

			expect(result.status).toBe(502);
			expect(result.headers.get('content-type')).toBe('application/json; charset=utf-8');
			expect(body).toEqual({
				error: {
					message: 'Tool call failed',
					type: 'stream_error',
					code: 'tool_failed',
				},
			});
		});

		it('should convert response.failed terminal events into JSON error responses', async () => {
			const sseContent = `data: {"type":"response.failed","response":{"id":"resp_fail","status":"failed","error":{"message":"Tool execution failed","code":"tool_error"}}}`;
			const response = new Response(sseContent);
			const headers = new Headers();

			const result = await convertSseToJson(response, headers);
			const body = await result.json();

			expect(result.status).toBe(502);
			expect(body).toEqual({
				error: {
					message: 'Tool execution failed',
					type: 'stream_error',
					code: 'tool_error',
				},
			});
		});

		it('should parse data lines without trailing space after colon', async () => {
			const sseContent = `data:{"type":"response.done","response":{"id":"resp_no_space","output":"ok"}}`;
			const response = new Response(sseContent);
			const headers = new Headers();

			const result = await convertSseToJson(response, headers);
			const body = await result.json();

			expect(body).toEqual({ id: 'resp_no_space', output: 'ok' });
		});

		it('should return original text if no final response found', async () => {
			const sseContent = `data: {"type":"response.started"}
data: {"type":"chunk","delta":"text"}
`;
			const response = new Response(sseContent);
			const headers = new Headers();

			const result = await convertSseToJson(response, headers);
			const text = await result.text();

			expect(text).toBe(sseContent);
		});

		it('should skip malformed JSON in SSE stream', async () => {
			const sseContent = `data: not-json
data: {"type":"response.done","response":{"id":"resp_789"}}
`;
			const response = new Response(sseContent);
			const headers = new Headers();

			const result = await convertSseToJson(response, headers);
			const body = await result.json();

			expect(body).toEqual({ id: 'resp_789' });
		});

		it('repairs fenced SSE JSON payloads when jsonRepairMode is safe', async () => {
			const sseContent = 'data: ```json {\"type\":\"response.done\",\"response\":{\"id\":\"resp_repair\"}} ```';
			const response = new Response(sseContent);
			const headers = new Headers();

			const result = await convertSseToJson(response, headers, { jsonRepairMode: 'safe' });
			const body = await result.json();

			expect(body).toEqual({ id: 'resp_repair' });
		});

		it('repairs trailing commas in SSE payloads when jsonRepairMode is safe', async () => {
			const sseContent = `data: {"type":"response.done","response":{"id":"resp_trailing",},}
`;
			const response = new Response(sseContent);
			const headers = new Headers();

			const result = await convertSseToJson(response, headers, { jsonRepairMode: 'safe' });
			const body = await result.json();

			expect(body).toEqual({ id: 'resp_trailing' });
		});

		it('does not mutate JSON string content while removing trailing commas', async () => {
			const sseContent = `data: {"type":"response.done","response":{"id":"resp_safe","output":"literal,} token",},}
`;
			const response = new Response(sseContent);
			const headers = new Headers();

			const result = await convertSseToJson(response, headers, { jsonRepairMode: 'safe' });
			const body = await result.json() as { id: string; output: string };

			expect(body.id).toBe('resp_safe');
			expect(body.output).toBe('literal,} token');
		});

		it('should handle empty SSE stream', async () => {
			const response = new Response('');
			const headers = new Headers();

			const result = await convertSseToJson(response, headers);
			const text = await result.text();

			expect(text).toBe('');
		});

		it('should preserve response status and statusText', async () => {
			const sseContent = `data: {"type":"response.done","response":{"id":"x"}}`;
			const response = new Response(sseContent, {
				status: 200,
				statusText: 'OK',
			});
			const headers = new Headers();

			const result = await convertSseToJson(response, headers);

			expect(result.status).toBe(200);
			expect(result.statusText).toBe('OK');
		});

		it('should throw error if SSE stream exceeds size limit', async () => {
			const largeContent = 'a'.repeat(20 * 1024 * 1024 + 1);
			const response = new Response(largeContent);
			const headers = new Headers();

			await expect(convertSseToJson(response, headers)).rejects.toThrow(
				/exceeds.*bytes limit/
			);
		});

		it('should throw error when stream read fails', async () => {
			const mockReader = {
				read: vi.fn().mockRejectedValue(new Error('Stream read error')),
				releaseLock: vi.fn(),
			};
			const response = {
				body: {
					getReader: () => mockReader,
				},
				status: 200,
				statusText: 'OK',
			} as unknown as Response;
			const headers = new Headers();

			await expect(convertSseToJson(response, headers)).rejects.toThrow('Stream read error');
			expect(mockReader.releaseLock).toHaveBeenCalled();
		});

		it('should throw when stream stalls past timeout', async () => {
			vi.useFakeTimers();
			const mockReader = {
				read: vi.fn(() => new Promise<{ done: boolean; value?: Uint8Array }>(() => {})),
				cancel: vi.fn(async () => undefined),
				releaseLock: vi.fn(),
			};
			const response = {
				body: {
					getReader: () => mockReader,
				},
				status: 200,
				statusText: 'OK',
			} as unknown as Response;

			const pending = convertSseToJson(response, new Headers(), { streamStallTimeoutMs: 1000 });
			const assertion = expect(pending).rejects.toThrow(/stalled/);
			await vi.advanceTimersByTimeAsync(1100);

			await assertion;
			expect(mockReader.cancel).toHaveBeenCalled();
			expect(mockReader.releaseLock).toHaveBeenCalled();
			vi.useRealTimers();
		});
	});

	describe('normalizeTaskToolCallsInSseStream', () => {
		it('should patch task calls in streaming SSE lines', async () => {
			const sseContent = `data: {"type":"response.output_item.done","item":{"type":"function_call","name":"task","arguments":"{\\"description\\":\\"check\\"}"}}
data: [DONE]
`;
			const source = new Response(sseContent).body;
			const normalized = normalizeTaskToolCallsInSseStream(source);
			const text = await new Response(normalized).text();
			const firstLine = text.split('\n')[0] ?? '';
			const payload = JSON.parse(firstLine.replace(/^data:\s*/, '')) as {
				item?: { arguments?: string };
			};
			const parsedArguments = JSON.parse(payload.item?.arguments ?? '{}') as Record<string, unknown>;
			expect(parsedArguments.run_in_background).toBe(false);
		});

		it('should leave non-task calls untouched', async () => {
			const sseContent = `data: {"type":"response.output_item.done","item":{"type":"function_call","name":"bash","arguments":"{\\"command\\":\\"pwd\\"}"}}
`;
			const source = new Response(sseContent).body;
			const normalized = normalizeTaskToolCallsInSseStream(source);
			const text = await new Response(normalized).text();
			expect(text).toContain('"name":"bash"');
			expect(text).not.toContain('run_in_background');
		});
	});

	describe('isEmptyResponse', () => {
		it('should return true for null', () => {
			expect(isEmptyResponse(null)).toBe(true);
		});

		it('should return true for undefined', () => {
			expect(isEmptyResponse(undefined)).toBe(true);
		});

		it('should return true for empty string', () => {
			expect(isEmptyResponse('')).toBe(true);
			expect(isEmptyResponse('   ')).toBe(true);
		});

		it('should return true for empty object', () => {
			expect(isEmptyResponse({})).toBe(true);
		});

		it('should return true for response object without meaningful content', () => {
			expect(isEmptyResponse({ id: 'resp_123' })).toBe(true);
			expect(isEmptyResponse({ id: 'resp_123', model: 'gpt-5.2' })).toBe(true);
			expect(isEmptyResponse({ id: 'resp_123', object: 'response' })).toBe(true);
		});

		it('should return true for response with null/undefined output', () => {
			expect(isEmptyResponse({ id: 'resp_123', output: null })).toBe(true);
			expect(isEmptyResponse({ id: 'resp_123', output: undefined })).toBe(true);
		});

		it('should return true for response with empty choices array', () => {
			expect(isEmptyResponse({ id: 'resp_123', choices: [] })).toBe(true);
		});

		it('should return false for response with output', () => {
			expect(isEmptyResponse({ output: [{ text: 'hello' }] })).toBe(false);
			expect(isEmptyResponse({ id: 'resp_123', output: 'some output' })).toBe(false);
		});

		it('should return false for response with choices', () => {
			expect(isEmptyResponse({ choices: [{ message: { content: 'hi' } }] })).toBe(false);
		});

		it('should return true for response with empty choice objects', () => {
			expect(isEmptyResponse({ id: 'resp_123', choices: [{}] })).toBe(true);
			expect(isEmptyResponse({ id: 'resp_123', choices: [null] })).toBe(true);
		});

		it('should return false for response with content', () => {
			expect(isEmptyResponse({ content: 'hello world' })).toBe(false);
			expect(isEmptyResponse({ id: 'resp_123', content: [] })).toBe(false);
		});

		it('should return true for response with empty string content', () => {
			expect(isEmptyResponse({ id: 'resp_123', content: '' })).toBe(true);
			expect(isEmptyResponse({ id: 'resp_123', content: '   ' })).toBe(true);
		});

		it('should return false for non-object primitives', () => {
			expect(isEmptyResponse(123)).toBe(false);
			expect(isEmptyResponse(true)).toBe(false);
			expect(isEmptyResponse('non-empty string')).toBe(false);
		});

		it('should return false for objects that are not response-like', () => {
			// Objects without id/object/model are considered valid (not response objects)
			expect(isEmptyResponse({ foo: 'bar' })).toBe(false);
			expect(isEmptyResponse({ data: [1, 2, 3] })).toBe(false);
		});
	});
});
