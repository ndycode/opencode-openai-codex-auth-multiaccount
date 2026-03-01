import { describe, it, expect } from "vitest";

import { encryptStoragePayload, decryptStoragePayload } from "../lib/storage/encryption.js";

describe("storage encryption helpers", () => {
	const secret = "unit-test-secret";

	it("round-trips plaintext when secret provided", () => {
		const plaintext = JSON.stringify({ hello: "world" });
		const encrypted = encryptStoragePayload(plaintext, secret);
		const result = decryptStoragePayload(encrypted, secret);
		expect(result.encrypted).toBe(true);
		expect(result.requiresSecret).toBe(false);
		expect(result.plaintext).toBe(plaintext);
	});

	it("marks encrypted payloads when secret is missing", () => {
		const plaintext = JSON.stringify({ hello: "world" });
		const encrypted = encryptStoragePayload(plaintext, secret);
		const result = decryptStoragePayload(encrypted, null);
		expect(result.encrypted).toBe(true);
		expect(result.requiresSecret).toBe(true);
	});
});
