/**
 * RC-9: process-boundary schemas added to lib/schemas.ts.
 *
 * Covers env-var parsers (`EnvBooleanSchema`, `EnvNumberSchema`,
 * `makeEnvEnumSchema`), the account-id override schema, the JWT payload
 * schema, the on-disk cache metadata schemas, and the Codex CLI cross-process
 * accounts schema. Each boundary must accept the documented shape and fall
 * back (to `undefined` / `null`) on invalid input without throwing.
 */
import { describe, it, expect } from "vitest";
import {
	AccountIdOverrideSchema,
	CacheMetadataSchema,
	CodexCliAccountEntrySchema,
	CodexCliAccountsSchema,
	EnvBooleanSchema,
	EnvNumberSchema,
	JWTPayloadSchema,
	OpenCodeCodexCacheMetaSchema,
	makeEnvEnumSchema,
	parseAccountIdOverride,
	safeParseCacheMetadata,
	safeParseJWTPayload,
	safeParseOpenCodeCodexCacheMeta,
} from "../lib/schemas.js";

describe("EnvBooleanSchema (RC-9 env-boundary)", () => {
	it("treats literal '1' as true (historical contract)", () => {
		const result = EnvBooleanSchema.safeParse("1");
		expect(result.success).toBe(true);
		if (result.success) expect(result.data).toBe(true);
	});

	it("treats any other non-empty string as false (historical contract)", () => {
		for (const value of ["0", "true", "yes", "on", "TRUE", "2"]) {
			const result = EnvBooleanSchema.safeParse(value);
			expect(result.success).toBe(true);
			if (result.success) expect(result.data).toBe(false);
		}
	});

	it("passes undefined through so callers fall back to config/default", () => {
		const result = EnvBooleanSchema.safeParse(undefined);
		expect(result.success).toBe(true);
		if (result.success) expect(result.data).toBeUndefined();
	});

	it("rejects non-string, non-undefined inputs (e.g. numbers, objects)", () => {
		expect(EnvBooleanSchema.safeParse(1).success).toBe(false);
		expect(EnvBooleanSchema.safeParse({}).success).toBe(false);
		expect(EnvBooleanSchema.safeParse(null).success).toBe(false);
	});
});

describe("EnvNumberSchema (RC-9 env-boundary)", () => {
	it("parses finite numeric strings", () => {
		const result = EnvNumberSchema.safeParse("42");
		expect(result.success).toBe(true);
		if (result.success) expect(result.data).toBe(42);
	});

	it("parses negative and fractional numbers", () => {
		const neg = EnvNumberSchema.safeParse("-3.5");
		expect(neg.success).toBe(true);
		if (neg.success) expect(neg.data).toBe(-3.5);
	});

	it("falls back to undefined on non-finite input", () => {
		for (const value of ["", "abc", "NaN", "Infinity", "-Infinity"]) {
			const result = EnvNumberSchema.safeParse(value);
			expect(result.success).toBe(true);
			if (result.success) expect(result.data).toBeUndefined();
		}
	});

	it("passes undefined through", () => {
		const result = EnvNumberSchema.safeParse(undefined);
		expect(result.success).toBe(true);
		if (result.success) expect(result.data).toBeUndefined();
	});
});

describe("makeEnvEnumSchema (RC-9 env-boundary)", () => {
	const schema = makeEnvEnumSchema(["alpha", "beta", "gamma"] as const);

	it("accepts exact allowed values", () => {
		const result = schema.safeParse("alpha");
		expect(result.success).toBe(true);
		if (result.success) expect(result.data).toBe("alpha");
	});

	it("normalizes case and surrounding whitespace", () => {
		const result = schema.safeParse("  BETA  ");
		expect(result.success).toBe(true);
		if (result.success) expect(result.data).toBe("beta");
	});

	it("falls back to undefined on unknown values", () => {
		const result = schema.safeParse("delta");
		expect(result.success).toBe(true);
		if (result.success) expect(result.data).toBeUndefined();
	});

	it("falls back to undefined on empty / whitespace-only strings", () => {
		for (const value of ["", "   "]) {
			const result = schema.safeParse(value);
			expect(result.success).toBe(true);
			if (result.success) expect(result.data).toBeUndefined();
		}
	});

	it("accepts a ReadonlySet of allowed values", () => {
		const setSchema = makeEnvEnumSchema(new Set(["one", "two"]));
		expect(setSchema.safeParse("one").success).toBe(true);
		const res = setSchema.safeParse("three");
		expect(res.success).toBe(true);
		if (res.success) expect(res.data).toBeUndefined();
	});
});

describe("AccountIdOverrideSchema + parseAccountIdOverride (RC-9 env-boundary)", () => {
	it("accepts a trimmed, non-empty account id", () => {
		expect(parseAccountIdOverride("acct_123")).toBe("acct_123");
		expect(parseAccountIdOverride("  acct_123  ")).toBe("acct_123");
	});

	it("rejects empty / whitespace-only overrides by returning undefined", () => {
		expect(parseAccountIdOverride("")).toBeUndefined();
		expect(parseAccountIdOverride("   ")).toBeUndefined();
	});

	it("rejects overrides longer than the documented maximum (256)", () => {
		const huge = "a".repeat(257);
		expect(parseAccountIdOverride(huge)).toBeUndefined();
	});

	it("keeps overrides exactly at the maximum length", () => {
		const atMax = "a".repeat(256);
		expect(parseAccountIdOverride(atMax)).toBe(atMax);
	});

	it("passes undefined through (env var not set)", () => {
		expect(parseAccountIdOverride(undefined)).toBeUndefined();
	});

	it("schema itself rejects non-string inputs", () => {
		expect(AccountIdOverrideSchema.safeParse(123).success).toBe(false);
		expect(AccountIdOverrideSchema.safeParse({}).success).toBe(false);
	});
});

describe("JWTPayloadSchema + safeParseJWTPayload (RC-9 boundary)", () => {
	it("accepts a minimal payload and preserves unknown claims", () => {
		const raw = {
			email: "user@example.com",
			"https://api.openai.com/auth": {
				chatgpt_account_id: "acct_123",
				email: "user@example.com",
			},
			custom_claim: "preserved",
		};
		const parsed = safeParseJWTPayload(raw);
		expect(parsed).not.toBeNull();
		expect(parsed?.email).toBe("user@example.com");
		// catchall preserves unknown claims at the top level
		expect((parsed as Record<string, unknown> | null)?.custom_claim).toBe("preserved");
	});

	it("returns null when the top-level value is not an object", () => {
		expect(safeParseJWTPayload("not-an-object")).toBeNull();
		expect(safeParseJWTPayload(42)).toBeNull();
		expect(safeParseJWTPayload(null)).toBeNull();
	});

	it("rejects payloads where the auth claim has a wrong shape", () => {
		const result = JWTPayloadSchema.safeParse({
			"https://api.openai.com/auth": "not-an-object",
		});
		expect(result.success).toBe(false);
	});
});

describe("CacheMetadataSchema + safeParseCacheMetadata (RC-9 boundary)", () => {
	it("accepts a well-formed cache metadata record", () => {
		const result = safeParseCacheMetadata({
			etag: "W/\"abc\"",
			tag: "v1",
			lastChecked: 1_700_000_000,
			url: "https://example.com/prompt.md",
		});
		expect(result).not.toBeNull();
		expect(result?.tag).toBe("v1");
	});

	it("allows etag to be null (first fetch without an ETag)", () => {
		const result = safeParseCacheMetadata({
			etag: null,
			tag: "v1",
			lastChecked: 1,
			url: "https://example.com/x",
		});
		expect(result).not.toBeNull();
		expect(result?.etag).toBeNull();
	});

	it("returns null on malformed metadata", () => {
		expect(safeParseCacheMetadata({})).toBeNull();
		expect(
			safeParseCacheMetadata({
				etag: "abc",
				tag: 1,
				lastChecked: 1,
				url: "x",
			}),
		).toBeNull();
		expect(safeParseCacheMetadata(null)).toBeNull();
	});
});

describe("OpenCodeCodexCacheMetaSchema + safeParseOpenCodeCodexCacheMeta (RC-9 boundary)", () => {
	it("accepts a well-formed opencode-codex cache metadata record", () => {
		const result = safeParseOpenCodeCodexCacheMeta({
			etag: "W/\"xyz\"",
			lastChecked: 1_700_000_000,
			sourceUrl: "https://example.com/opencode-codex.md",
		});
		expect(result).not.toBeNull();
		expect(result?.etag).toBe("W/\"xyz\"");
	});

	it("returns null on malformed metadata", () => {
		expect(safeParseOpenCodeCodexCacheMeta({})).toBeNull();
		expect(
			safeParseOpenCodeCodexCacheMeta({
				etag: 1,
				lastChecked: 1,
			}),
		).toBeNull();
	});

	it("requires etag and lastChecked (the only non-optional fields)", () => {
		const missingEtag = OpenCodeCodexCacheMetaSchema.safeParse({
			lastChecked: 1,
		});
		const missingLastChecked = OpenCodeCodexCacheMetaSchema.safeParse({
			etag: "abc",
		});
		expect(missingEtag.success).toBe(false);
		expect(missingLastChecked.success).toBe(false);
	});
});

describe("CodexCliAccountsSchema + CodexCliAccountEntrySchema (RC-9 cross-process)", () => {
	it("accepts a file with an accounts array of well-formed entries", () => {
		const raw = {
			accounts: [
				{
					email: "user@example.com",
					accountId: "acct_123",
					auth: {
						tokens: {
							access_token: "at",
							refresh_token: "rt",
							id_token: "idt",
						},
					},
				},
			],
		};
		const result = CodexCliAccountsSchema.safeParse(raw);
		expect(result.success).toBe(true);
	});

	it("preserves unknown fields via catchall (forward compat)", () => {
		const raw = {
			accounts: [
				{
					email: "user@example.com",
					auth: { tokens: { access_token: "at", bonus_claim: "kept" } },
					future_field: { nested: true },
				},
			],
			metadata: { schema_version: 9001 },
		};
		const result = CodexCliAccountsSchema.safeParse(raw);
		expect(result.success).toBe(true);
	});

	it("accepts an empty accounts file (accounts: [])", () => {
		const result = CodexCliAccountsSchema.safeParse({ accounts: [] });
		expect(result.success).toBe(true);
	});

	it("rejects entries where auth.tokens has wrong field types", () => {
		const result = CodexCliAccountEntrySchema.safeParse({
			auth: { tokens: { access_token: 123 } },
		});
		expect(result.success).toBe(false);
	});

	it("rejects a top-level non-object file", () => {
		expect(CodexCliAccountsSchema.safeParse("not-an-object").success).toBe(false);
		expect(CodexCliAccountsSchema.safeParse(null).success).toBe(false);
	});
});
