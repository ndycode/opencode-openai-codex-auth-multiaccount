import { describe, it, expect, vi, beforeEach } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import { EventEmitter } from "node:events";

describe("OAuth server success-page fallback", () => {
	beforeEach(() => {
		vi.resetModules();
		vi.clearAllMocks();
	});

	it("uses fallback HTML when oauth-success.html is missing", async () => {
		type MockServer = {
			_handler?: (req: IncomingMessage, res: ServerResponse) => void;
			listen: (
				port: number,
				host: string,
				callback: () => void,
			) => MockServer;
			close: () => void;
			unref: () => void;
			on: (event: string, handler: (err: NodeJS.ErrnoException) => void) => MockServer;
		};

		const mockServer: MockServer = {
			_handler: undefined,
			listen: (_port, _host, callback) => {
				callback();
				return mockServer;
			},
			close: () => {},
			unref: () => {},
			on: () => mockServer,
		};

		const createServer = vi.fn(
			(handler: (req: IncomingMessage, res: ServerResponse) => void) => {
				mockServer._handler = handler;
				return mockServer;
			},
		);
		const readFileSync = vi.fn(() => {
			throw new Error("ENOENT");
		});
		const logWarn = vi.fn();
		const logError = vi.fn();

		vi.doMock("node:http", () => ({ default: { createServer } }));
		vi.doMock("node:fs", () => ({ default: { readFileSync } }));
		vi.doMock("../lib/logger.js", () => ({ logWarn, logError }));

		const { startLocalOAuthServer } = await import("../lib/auth/server.js");
		const serverInfo = await startLocalOAuthServer({ state: "state-1" });

		expect(serverInfo.ready).toBe(true);
		expect(logWarn).toHaveBeenCalledWith(
			"oauth-success.html missing; using fallback success page",
			expect.objectContaining({ error: "ENOENT" }),
		);

		const req = new EventEmitter() as IncomingMessage;
		req.url = "/auth/callback?code=test-code&state=state-1";
		const body = { value: "" };
		const res = {
			statusCode: 0,
			setHeader: vi.fn(),
			end: vi.fn((payload?: string) => {
				body.value = payload ?? "";
			}),
		} as unknown as ServerResponse;

		mockServer._handler?.(req, res);
		expect(body.value).toContain("Authorization complete");
	});
});
