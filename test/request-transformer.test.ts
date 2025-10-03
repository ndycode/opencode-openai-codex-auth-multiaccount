import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
	normalizeModel,
	filterInput,
	addToolRemapMessage,
	isOpenCodeSystemPrompt,
	filterOpenCodeSystemPrompts,
	addCodexBridgeMessage,
	transformRequestBody,
} from '../lib/request/request-transformer.js';
import { TOOL_REMAP_MESSAGE } from '../lib/prompts/codex.js';
import { CODEX_OPENCODE_BRIDGE } from '../lib/prompts/codex-opencode-bridge.js';
import type { RequestBody, UserConfig, InputItem } from '../lib/types.js';

describe('Request Transformer Module', () => {
	describe('normalizeModel', () => {
		it('should normalize gpt-5-codex', () => {
			expect(normalizeModel('gpt-5-codex')).toBe('gpt-5-codex');
		});

		it('should normalize gpt-5', () => {
			expect(normalizeModel('gpt-5')).toBe('gpt-5');
		});

		it('should normalize variants containing "codex"', () => {
			expect(normalizeModel('openai/gpt-5-codex')).toBe('gpt-5-codex');
			expect(normalizeModel('custom-gpt-5-codex-variant')).toBe('gpt-5-codex');
		});

		it('should normalize variants containing "gpt-5"', () => {
			expect(normalizeModel('gpt-5-mini')).toBe('gpt-5');
			expect(normalizeModel('gpt-5-nano')).toBe('gpt-5');
		});

		it('should return gpt-5 as default for unknown models', () => {
			expect(normalizeModel('unknown-model')).toBe('gpt-5');
			expect(normalizeModel('gpt-4')).toBe('gpt-5');
		});

		it('should return gpt-5 for undefined', () => {
			expect(normalizeModel(undefined)).toBe('gpt-5');
		});
	});

	describe('filterInput', () => {
		it('should keep items without IDs', () => {
			const input: InputItem[] = [
				{ type: 'message', role: 'user', content: 'hello' },
			];
			const result = filterInput(input);
			expect(result).toEqual(input);
		});

		it('should remove items with rs_ IDs', () => {
			const input: InputItem[] = [
				{ id: 'rs_123', type: 'message', role: 'user', content: 'hello' },
				{ id: 'msg_456', type: 'message', role: 'user', content: 'world' },
			];
			const result = filterInput(input);
			expect(result).toHaveLength(1);
			expect(result![0].id).toBe('msg_456');
		});

		it('should handle mixed items', () => {
			const input: InputItem[] = [
				{ type: 'message', role: 'user', content: '1' },
				{ id: 'rs_stored', type: 'message', role: 'assistant', content: '2' },
				{ id: 'msg_123', type: 'message', role: 'user', content: '3' },
			];
			const result = filterInput(input);
			expect(result).toHaveLength(2);
			expect(result![0].content).toBe('1');
			expect(result![1].content).toBe('3');
		});

		it('should return undefined for undefined input', () => {
			expect(filterInput(undefined)).toBeUndefined();
		});

		it('should return non-array input as-is', () => {
			const notArray = { notAnArray: true };
			expect(filterInput(notArray as any)).toBe(notArray);
		});
	});

	describe('addToolRemapMessage', () => {
		it('should prepend tool remap message when tools present', () => {
			const input: InputItem[] = [
				{ type: 'message', role: 'user', content: 'hello' },
			];
			const result = addToolRemapMessage(input, true);

			expect(result).toHaveLength(2);
			expect(result![0].role).toBe('developer');
			expect(result![0].type).toBe('message');
			expect((result![0].content as any)[0].text).toContain('apply_patch');
		});

		it('should not modify input when tools not present', () => {
			const input: InputItem[] = [
				{ type: 'message', role: 'user', content: 'hello' },
			];
			const result = addToolRemapMessage(input, false);
			expect(result).toEqual(input);
		});

		it('should return undefined for undefined input', () => {
			expect(addToolRemapMessage(undefined, true)).toBeUndefined();
		});

		it('should handle non-array input', () => {
			const notArray = { notAnArray: true };
			expect(addToolRemapMessage(notArray as any, true)).toBe(notArray);
		});
	});

	describe('isOpenCodeSystemPrompt', () => {
		it('should detect OpenCode system prompt with string content', () => {
			const item: InputItem = {
				type: 'message',
				role: 'developer',
				content: 'You are a coding agent running in OpenCode',
			};
			expect(isOpenCodeSystemPrompt(item)).toBe(true);
		});

		it('should detect OpenCode system prompt with array content', () => {
			const item: InputItem = {
				type: 'message',
				role: 'developer',
				content: [
					{
						type: 'input_text',
						text: 'You are a coding agent running in OpenCode',
					},
				],
			};
			expect(isOpenCodeSystemPrompt(item)).toBe(true);
		});

		it('should detect with system role', () => {
			const item: InputItem = {
				type: 'message',
				role: 'system',
				content: 'You are a coding agent running in OpenCode',
			};
			expect(isOpenCodeSystemPrompt(item)).toBe(true);
		});

		it('should not detect non-system roles', () => {
			const item: InputItem = {
				type: 'message',
				role: 'user',
				content: 'You are a coding agent running in OpenCode',
			};
			expect(isOpenCodeSystemPrompt(item)).toBe(false);
		});

		it('should not detect different content', () => {
			const item: InputItem = {
				type: 'message',
				role: 'developer',
				content: 'Different message',
			};
			expect(isOpenCodeSystemPrompt(item)).toBe(false);
		});
	});

	describe('filterOpenCodeSystemPrompts', () => {
		it('should filter out OpenCode system prompts', () => {
			const input: InputItem[] = [
				{
					type: 'message',
					role: 'developer',
					content: 'You are a coding agent running in OpenCode',
				},
				{ type: 'message', role: 'user', content: 'hello' },
			];
			const result = filterOpenCodeSystemPrompts(input);
			expect(result).toHaveLength(1);
			expect(result![0].role).toBe('user');
		});

		it('should keep user messages', () => {
			const input: InputItem[] = [
				{ type: 'message', role: 'user', content: 'message 1' },
				{ type: 'message', role: 'user', content: 'message 2' },
			];
			const result = filterOpenCodeSystemPrompts(input);
			expect(result).toHaveLength(2);
		});

		it('should keep non-OpenCode developer messages', () => {
			const input: InputItem[] = [
				{ type: 'message', role: 'developer', content: 'Custom instruction' },
				{ type: 'message', role: 'user', content: 'hello' },
			];
			const result = filterOpenCodeSystemPrompts(input);
			expect(result).toHaveLength(2);
		});

		it('should return undefined for undefined input', () => {
			expect(filterOpenCodeSystemPrompts(undefined)).toBeUndefined();
		});
	});

	describe('addCodexBridgeMessage', () => {
		it('should prepend bridge message when tools present', () => {
			const input: InputItem[] = [
				{ type: 'message', role: 'user', content: 'hello' },
			];
			const result = addCodexBridgeMessage(input, true);

			expect(result).toHaveLength(2);
			expect(result![0].role).toBe('developer');
			expect(result![0].type).toBe('message');
			expect((result![0].content as any)[0].text).toContain('Codex Running in OpenCode');
		});

		it('should not modify input when tools not present', () => {
			const input: InputItem[] = [
				{ type: 'message', role: 'user', content: 'hello' },
			];
			const result = addCodexBridgeMessage(input, false);
			expect(result).toEqual(input);
		});

		it('should return undefined for undefined input', () => {
			expect(addCodexBridgeMessage(undefined, true)).toBeUndefined();
		});
	});

	describe('transformRequestBody', () => {
		const codexInstructions = 'Test Codex Instructions';

		it('should set required Codex fields', () => {
			const body: RequestBody = {
				model: 'gpt-5',
				input: [],
			};
			const result = transformRequestBody(body, codexInstructions);

			expect(result.store).toBe(false);
			expect(result.stream).toBe(true);
			expect(result.instructions).toBe(codexInstructions);
		});

		it('should normalize model name', () => {
			const body: RequestBody = {
				model: 'gpt-5-mini',
				input: [],
			};
			const result = transformRequestBody(body, codexInstructions);
			expect(result.model).toBe('gpt-5');
		});

		it('should apply default reasoning config', () => {
			const body: RequestBody = {
				model: 'gpt-5',
				input: [],
			};
			const result = transformRequestBody(body, codexInstructions);

			expect(result.reasoning?.effort).toBe('medium');
			expect(result.reasoning?.summary).toBe('auto');
		});

		it('should apply user reasoning config', () => {
			const body: RequestBody = {
				model: 'gpt-5',
				input: [],
			};
			const userConfig: UserConfig = {
				global: {
					reasoningEffort: 'high',
					reasoningSummary: 'detailed',
				},
				models: {},
			};
			const result = transformRequestBody(body, codexInstructions, userConfig);

			expect(result.reasoning?.effort).toBe('high');
			expect(result.reasoning?.summary).toBe('detailed');
		});

		it('should apply default text verbosity', () => {
			const body: RequestBody = {
				model: 'gpt-5',
				input: [],
			};
			const result = transformRequestBody(body, codexInstructions);
			expect(result.text?.verbosity).toBe('medium');
		});

		it('should apply user text verbosity', () => {
			const body: RequestBody = {
				model: 'gpt-5',
				input: [],
			};
			const userConfig: UserConfig = {
				global: { textVerbosity: 'low' },
				models: {},
			};
			const result = transformRequestBody(body, codexInstructions, userConfig);
			expect(result.text?.verbosity).toBe('low');
		});

		it('should set default include for encrypted reasoning', () => {
			const body: RequestBody = {
				model: 'gpt-5',
				input: [],
			};
			const result = transformRequestBody(body, codexInstructions);
			expect(result.include).toEqual(['reasoning.encrypted_content']);
		});

		it('should use user-configured include', () => {
			const body: RequestBody = {
				model: 'gpt-5',
				input: [],
			};
			const userConfig: UserConfig = {
				global: { include: ['custom_field', 'reasoning.encrypted_content'] },
				models: {},
			};
			const result = transformRequestBody(body, codexInstructions, userConfig);
			expect(result.include).toEqual(['custom_field', 'reasoning.encrypted_content']);
		});

		it('should filter input array', () => {
			const body: RequestBody = {
				model: 'gpt-5',
				input: [
					{ id: 'rs_123', type: 'message', role: 'assistant', content: 'old' },
					{ type: 'message', role: 'user', content: 'new' },
				],
			};
			const result = transformRequestBody(body, codexInstructions);
			expect(result.input).toHaveLength(1);
			expect(result.input![0].content).toBe('new');
		});

		it('should add tool remap message when tools present', () => {
			const body: RequestBody = {
				model: 'gpt-5',
				input: [{ type: 'message', role: 'user', content: 'hello' }],
				tools: [{ name: 'test_tool' }],
			};
			const result = transformRequestBody(body, codexInstructions);
			expect(result.input![0].role).toBe('developer');
		});

		it('should not add tool remap message when tools absent', () => {
			const body: RequestBody = {
				model: 'gpt-5',
				input: [{ type: 'message', role: 'user', content: 'hello' }],
			};
			const result = transformRequestBody(body, codexInstructions);
			expect(result.input![0].role).toBe('user');
		});

		it('should remove unsupported parameters', () => {
			const body: RequestBody = {
				model: 'gpt-5',
				input: [],
				max_output_tokens: 1000,
				max_completion_tokens: 2000,
			};
			const result = transformRequestBody(body, codexInstructions);
			expect(result.max_output_tokens).toBeUndefined();
			expect(result.max_completion_tokens).toBeUndefined();
		});

		it('should normalize minimal to low for gpt-5-codex', () => {
			const body: RequestBody = {
				model: 'gpt-5-codex',
				input: [],
			};
			const userConfig: UserConfig = {
				global: { reasoningEffort: 'minimal' },
				models: {},
			};
			const result = transformRequestBody(body, codexInstructions, userConfig);
			expect(result.reasoning?.effort).toBe('low');
		});

		it('should preserve minimal for non-codex models', () => {
			const body: RequestBody = {
				model: 'gpt-5',
				input: [],
			};
			const userConfig: UserConfig = {
				global: { reasoningEffort: 'minimal' },
				models: {},
			};
			const result = transformRequestBody(body, codexInstructions, userConfig);
			expect(result.reasoning?.effort).toBe('minimal');
		});

		it('should use minimal effort for lightweight models', () => {
			const body: RequestBody = {
				model: 'gpt-5-nano',
				input: [],
			};
			const result = transformRequestBody(body, codexInstructions);
			expect(result.reasoning?.effort).toBe('minimal');
		});

		describe('CODEX_MODE parameter', () => {
			it('should use bridge message when codexMode=true and tools present (default)', () => {
				const body: RequestBody = {
					model: 'gpt-5',
					input: [{ type: 'message', role: 'user', content: 'hello' }],
					tools: [{ name: 'test_tool' }],
				};
				const result = transformRequestBody(body, codexInstructions, undefined, true);

				expect(result.input).toHaveLength(2);
				expect(result.input![0].role).toBe('developer');
				expect((result.input![0].content as any)[0].text).toContain('Codex Running in OpenCode');
			});

			it('should filter OpenCode prompts when codexMode=true', () => {
				const body: RequestBody = {
					model: 'gpt-5',
					input: [
						{
							type: 'message',
							role: 'developer',
							content: 'You are a coding agent running in OpenCode',
						},
						{ type: 'message', role: 'user', content: 'hello' },
					],
					tools: [{ name: 'test_tool' }],
				};
				const result = transformRequestBody(body, codexInstructions, undefined, true);

				// Should have bridge message + user message (OpenCode prompt filtered out)
				expect(result.input).toHaveLength(2);
				expect(result.input![0].role).toBe('developer');
				expect((result.input![0].content as any)[0].text).toContain('Codex Running in OpenCode');
				expect(result.input![1].role).toBe('user');
			});

			it('should not add bridge message when codexMode=true but no tools', () => {
				const body: RequestBody = {
					model: 'gpt-5',
					input: [{ type: 'message', role: 'user', content: 'hello' }],
				};
				const result = transformRequestBody(body, codexInstructions, undefined, true);

				expect(result.input).toHaveLength(1);
				expect(result.input![0].role).toBe('user');
			});

			it('should use tool remap message when codexMode=false', () => {
				const body: RequestBody = {
					model: 'gpt-5',
					input: [{ type: 'message', role: 'user', content: 'hello' }],
					tools: [{ name: 'test_tool' }],
				};
				const result = transformRequestBody(body, codexInstructions, undefined, false);

				expect(result.input).toHaveLength(2);
				expect(result.input![0].role).toBe('developer');
				expect((result.input![0].content as any)[0].text).toContain('apply_patch');
			});

			it('should not filter OpenCode prompts when codexMode=false', () => {
				const body: RequestBody = {
					model: 'gpt-5',
					input: [
						{
							type: 'message',
							role: 'developer',
							content: 'You are a coding agent running in OpenCode',
						},
						{ type: 'message', role: 'user', content: 'hello' },
					],
					tools: [{ name: 'test_tool' }],
				};
				const result = transformRequestBody(body, codexInstructions, undefined, false);

				// Should have tool remap + opencode prompt + user message
				expect(result.input).toHaveLength(3);
				expect(result.input![0].role).toBe('developer');
				expect((result.input![0].content as any)[0].text).toContain('apply_patch');
				expect(result.input![1].role).toBe('developer');
				expect(result.input![2].role).toBe('user');
			});

			it('should default to codexMode=true when parameter not provided', () => {
				const body: RequestBody = {
					model: 'gpt-5',
					input: [{ type: 'message', role: 'user', content: 'hello' }],
					tools: [{ name: 'test_tool' }],
				};
				// Not passing codexMode parameter - should default to true
				const result = transformRequestBody(body, codexInstructions);

				// Should use bridge message (codexMode=true by default)
				expect(result.input![0].role).toBe('developer');
				expect((result.input![0].content as any)[0].text).toContain('Codex Running in OpenCode');
			});
		});
	});
});
