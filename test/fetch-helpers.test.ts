import { describe, it, expect, vi } from 'vitest';
import {
	shouldRefreshToken,
	extractRequestUrl,
	rewriteUrlForCodex,
	createCodexHeaders,
} from '../lib/request/fetch-helpers.js';
import type { Auth } from '../lib/types.js';
import { URL_PATHS, OPENAI_HEADERS, OPENAI_HEADER_VALUES } from '../lib/constants.js';

describe('Fetch Helpers Module', () => {
	describe('shouldRefreshToken', () => {
		it('should return true for non-oauth auth', () => {
			const auth: Auth = { type: 'api', key: 'test-key' };
			expect(shouldRefreshToken(auth)).toBe(true);
		});

		it('should return true when access token is missing', () => {
			const auth: Auth = { type: 'oauth', access: '', refresh: 'refresh-token', expires: Date.now() + 1000 };
			expect(shouldRefreshToken(auth)).toBe(true);
		});

		it('should return true when token is expired', () => {
			const auth: Auth = {
				type: 'oauth',
				access: 'access-token',
				refresh: 'refresh-token',
				expires: Date.now() - 1000 // expired
			};
			expect(shouldRefreshToken(auth)).toBe(true);
		});

		it('should return false for valid oauth token', () => {
			const auth: Auth = {
				type: 'oauth',
				access: 'access-token',
				refresh: 'refresh-token',
				expires: Date.now() + 10000 // valid for 10 seconds
			};
			expect(shouldRefreshToken(auth)).toBe(false);
		});
	});

	describe('extractRequestUrl', () => {
		it('should extract URL from string', () => {
			const url = 'https://example.com/test';
			expect(extractRequestUrl(url)).toBe(url);
		});

		it('should extract URL from URL object', () => {
			const url = new URL('https://example.com/test');
			expect(extractRequestUrl(url)).toBe('https://example.com/test');
		});

		it('should extract URL from Request object', () => {
			const request = new Request('https://example.com/test');
			expect(extractRequestUrl(request)).toBe('https://example.com/test');
		});
	});

	describe('rewriteUrlForCodex', () => {
		it('should rewrite /responses to /codex/responses', () => {
			const url = 'https://chatgpt.com/backend-api/responses';
			expect(rewriteUrlForCodex(url)).toBe('https://chatgpt.com/backend-api/codex/responses');
		});

		it('should not modify URL without /responses', () => {
			const url = 'https://chatgpt.com/backend-api/other';
			expect(rewriteUrlForCodex(url)).toBe(url);
		});

		it('should only replace first occurrence', () => {
			const url = 'https://example.com/responses/responses';
			const result = rewriteUrlForCodex(url);
			expect(result).toBe('https://example.com/codex/responses/responses');
		});
	});

	describe('createCodexHeaders', () => {
		const accountId = 'test-account-123';
		const accessToken = 'test-access-token';

		it('should create headers with all required fields', () => {
			const headers = createCodexHeaders(undefined, accountId, accessToken);

			expect(headers.get('Authorization')).toBe(`Bearer ${accessToken}`);
			expect(headers.get(OPENAI_HEADERS.ACCOUNT_ID)).toBe(accountId);
			expect(headers.get(OPENAI_HEADERS.BETA)).toBe(OPENAI_HEADER_VALUES.BETA_RESPONSES);
			expect(headers.get(OPENAI_HEADERS.ORIGINATOR)).toBe(OPENAI_HEADER_VALUES.ORIGINATOR_CODEX);
			expect(headers.has(OPENAI_HEADERS.SESSION_ID)).toBe(true);
		});

		it('should remove x-api-key header', () => {
			const init = { headers: { 'x-api-key': 'should-be-removed' } };
			const headers = createCodexHeaders(init, accountId, accessToken);

			expect(headers.has('x-api-key')).toBe(false);
		});

		it('should preserve other existing headers', () => {
			const init = { headers: { 'Content-Type': 'application/json' } };
			const headers = createCodexHeaders(init, accountId, accessToken);

			expect(headers.get('Content-Type')).toBe('application/json');
		});

		it('should generate unique session IDs', () => {
			const headers1 = createCodexHeaders(undefined, accountId, accessToken);
			const headers2 = createCodexHeaders(undefined, accountId, accessToken);

			expect(headers1.get(OPENAI_HEADERS.SESSION_ID)).not.toBe(
				headers2.get(OPENAI_HEADERS.SESSION_ID)
			);
		});

		it('should validate session ID format (UUID)', () => {
			const headers = createCodexHeaders(undefined, accountId, accessToken);
			const sessionId = headers.get(OPENAI_HEADERS.SESSION_ID);

			// UUID v4 format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
			expect(sessionId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
		});
	});
});
