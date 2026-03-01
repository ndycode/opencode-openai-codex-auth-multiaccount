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

	it("throws when decrypting with the wrong secret", () => {
		const plaintext = JSON.stringify({ hello: "world" });
		const encrypted = encryptStoragePayload(plaintext, secret);
		expect(() => decryptStoragePayload(encrypted, "wrong-secret")).toThrow();
	});

	it("throws when encrypted auth tag is tampered", () => {
		const plaintext = JSON.stringify({ hello: "world" });
		const encrypted = encryptStoragePayload(plaintext, secret);
		const payload = JSON.parse(encrypted) as {
			tag: string;
		};
		const decodedTag = Buffer.from(payload.tag, "base64");
		decodedTag[0] = (decodedTag[0] ?? 0) ^ 0xff;
		payload.tag = decodedTag.toString("base64");
		expect(() => decryptStoragePayload(JSON.stringify(payload), secret)).toThrow();
	});

	it("throws when ciphertext is corrupted", () => {
		const plaintext = JSON.stringify({ hello: "world" });
		const encrypted = encryptStoragePayload(plaintext, secret);
		const payload = JSON.parse(encrypted) as {
			ciphertext: string;
		};
		const ciphertext = Buffer.from(payload.ciphertext, "base64");
		ciphertext[0] = (ciphertext[0] ?? 0) ^ 0xff;
		payload.ciphertext = ciphertext.toString("base64");
		expect(() => decryptStoragePayload(JSON.stringify(payload), secret)).toThrow();
	});
});
