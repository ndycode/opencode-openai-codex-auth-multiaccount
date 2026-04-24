import { describe, expect, it } from "vitest";
import { REDIRECT_URI } from "../lib/auth/auth.js";
import {
	OAUTH_CALLBACK_BIND_URL,
	OAUTH_CALLBACK_LOOPBACK_HOST,
	OAUTH_CALLBACK_PATH,
	OAUTH_CALLBACK_PORT,
} from "../lib/oauth-constants.js";

describe("oauth callback constants", () => {
	it("keeps the OAuth callback runtime values aligned", () => {
		expect(OAUTH_CALLBACK_PORT).toBe(1455);
		expect(OAUTH_CALLBACK_PATH).toBe("/auth/callback");
		expect(OAUTH_CALLBACK_LOOPBACK_HOST).toBe("127.0.0.1");
		expect(OAUTH_CALLBACK_BIND_URL).toBe(`http://127.0.0.1:${OAUTH_CALLBACK_PORT}`);
		// Codex's OAuth client is registered with localhost in redirect_uri, while
		// the local server binds the concrete IPv4 loopback interface.
		expect(REDIRECT_URI).toBe(
			`http://localhost:${OAUTH_CALLBACK_PORT}${OAUTH_CALLBACK_PATH}`,
		);
		expect(REDIRECT_URI).toContain("localhost");
		expect(OAUTH_CALLBACK_BIND_URL).toContain(OAUTH_CALLBACK_LOOPBACK_HOST);
	});
});
