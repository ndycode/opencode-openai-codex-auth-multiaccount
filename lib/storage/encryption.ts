import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from "node:crypto";

const ENCRYPTION_MARKER = "oc-chatgpt-multi-auth";

export interface EncryptedStoragePayload {
	__encrypted: string;
	version: 1 | 2;
	iv: string;
	tag: string;
	ciphertext: string;
	salt?: string;
}

export interface DecryptionResult {
	plaintext: string;
	encrypted: boolean;
	requiresSecret: boolean;
}

function deriveKey(secret: string): Buffer {
	return createHash("sha256").update(secret).digest();
}

function deriveKeyWithSalt(secret: string, salt: Buffer): Buffer {
	return scryptSync(secret, salt, 32);
}

function parseEncryptedPayload(serialized: string): EncryptedStoragePayload | null {
	try {
		const parsed = JSON.parse(serialized) as Partial<EncryptedStoragePayload>;
		if (
			parsed &&
			parsed.__encrypted === ENCRYPTION_MARKER &&
			(parsed.version === 1 || parsed.version === 2) &&
			typeof parsed.iv === "string" &&
			typeof parsed.tag === "string" &&
			typeof parsed.ciphertext === "string" &&
			(parsed.version === 1 || typeof parsed.salt === "string")
		) {
			return parsed as EncryptedStoragePayload;
		}
	} catch {
		return null;
	}
	return null;
}

export function encryptStoragePayload(plaintext: string, secret: string): string {
	const salt = randomBytes(16);
	const key = deriveKeyWithSalt(secret, salt);
	const iv = randomBytes(12);
	const cipher = createCipheriv("aes-256-gcm", key, iv);
	const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
	const tag = cipher.getAuthTag();
	const payload: EncryptedStoragePayload = {
		__encrypted: ENCRYPTION_MARKER,
		version: 2,
		salt: salt.toString("base64"),
		iv: iv.toString("base64"),
		tag: tag.toString("base64"),
		ciphertext: ciphertext.toString("base64"),
	};
	return JSON.stringify(payload, null, 2);
}

export function decryptStoragePayload(serialized: string, secret: string | null): DecryptionResult {
	const payload = parseEncryptedPayload(serialized);
	if (!payload) {
		return { plaintext: serialized, encrypted: false, requiresSecret: false };
	}
	if (!secret) {
		return { plaintext: "", encrypted: true, requiresSecret: true };
	}
	const key = payload.version === 2
		? deriveKeyWithSalt(secret, Buffer.from(payload.salt ?? "", "base64"))
		: deriveKey(secret);
	const iv = Buffer.from(payload.iv, "base64");
	const ciphertext = Buffer.from(payload.ciphertext, "base64");
	const decipher = createDecipheriv("aes-256-gcm", key, iv);
	decipher.setAuthTag(Buffer.from(payload.tag, "base64"));
	const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
	return { plaintext, encrypted: true, requiresSecret: false };
}

export function isEncryptedPayload(serialized: string): boolean {
	return parseEncryptedPayload(serialized) !== null;
}
