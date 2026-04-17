import { describe, it, expect } from "vitest";
import {
	CodexCliAccountsSchema,
	CodexCliAccountEntrySchema,
} from "../lib/schemas.js";

/**
 * Audit top-20 #11: Codex CLI accounts file is a cross-process input written
 * by a separate process. The plugin previously validated it with ad-hoc
 * isRecord/typeof checks; anything outside those specific fields was trusted
 * implicitly. These tests pin the Zod schema to:
 *   1. accept the well-formed shape produced by the real Codex CLI,
 *   2. reject a handful of attacker-shaped / version-drift variants in a way
 *      the plugin can detect via `safeParse().success === false`,
 *   3. never throw — validation must return a typed result, not crash.
 */
describe("CodexCliAccountsSchema", () => {
	it("accepts a realistic well-formed accounts file", () => {
		const valid = {
			accounts: [
				{
					email: "user@example.com",
					accountId: "acct_abc123",
					auth: {
						tokens: {
							access_token: "access-value",
							refresh_token: "refresh-value",
							id_token: "id-value",
						},
					},
				},
			],
		};

		const result = CodexCliAccountsSchema.safeParse(valid);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.accounts?.[0]?.email).toBe("user@example.com");
			expect(result.data.accounts?.[0]?.auth?.tokens?.refresh_token).toBe(
				"refresh-value",
			);
		}
	});

	it("accepts a file with unknown top-level keys (forward-compat via catchall)", () => {
		const valid = {
			accounts: [{ email: "user@example.com" }],
			schemaVersion: 99,
			generatedBy: "codex-cli-vNext",
			// Future-added field the plugin does not know about must not break parsing.
			unknownExtension: { some: "future-shape" },
		};

		const result = CodexCliAccountsSchema.safeParse(valid);
		expect(result.success).toBe(true);
	});

	it("accepts an empty accounts file (loader treats as no accounts)", () => {
		const result = CodexCliAccountsSchema.safeParse({ accounts: [] });
		expect(result.success).toBe(true);
	});

	it("accepts a file with the accounts key omitted", () => {
		// Older Codex CLI builds may ship a file with only `accounts` absent.
		// Schema must accept it; the loader will then treat the cache as empty.
		const result = CodexCliAccountsSchema.safeParse({});
		expect(result.success).toBe(true);
	});

	it("rejects a file whose accounts key is not an array (attacker payload)", () => {
		const attacker = {
			accounts: { email: "user@example.com" }, // not an array
		};
		const result = CodexCliAccountsSchema.safeParse(attacker);
		expect(result.success).toBe(false);
	});

	it("rejects non-object root (defensive against raw strings / numbers)", () => {
		expect(CodexCliAccountsSchema.safeParse("not an object").success).toBe(false);
		expect(CodexCliAccountsSchema.safeParse(123).success).toBe(false);
		expect(CodexCliAccountsSchema.safeParse(null).success).toBe(false);
	});

	it("rejects an account entry whose email is not a string", () => {
		const attacker = {
			accounts: [{ email: { $ne: null } }],
		};
		const result = CodexCliAccountsSchema.safeParse(attacker);
		expect(result.success).toBe(false);
	});

	it("rejects an account entry whose tokens block has non-string token fields", () => {
		const attacker = {
			accounts: [
				{
					email: "user@example.com",
					auth: {
						tokens: {
							access_token: ["payload", "injection"],
						},
					},
				},
			],
		};
		const result = CodexCliAccountsSchema.safeParse(attacker);
		expect(result.success).toBe(false);
	});

	it("does not throw on parse failure — safeParse returns typed result", () => {
		// Direct parse-throwing APIs exist on Zod, but the production code must
		// only ever use safeParse. Verify the schema yields a typed failure for
		// a grossly malformed input rather than raising an exception.
		expect(() => CodexCliAccountsSchema.safeParse(undefined)).not.toThrow();
		expect(CodexCliAccountsSchema.safeParse(undefined).success).toBe(false);
	});

	it("CodexCliAccountEntrySchema accepts entries with only optional fields present", () => {
		// Real files in the wild often omit accountId and even the auth block
		// for partially-onboarded accounts. Loader treats these as skip-worthy
		// but the schema MUST still accept them — throwing here would take
		// down the whole cache load.
		expect(
			CodexCliAccountEntrySchema.safeParse({ email: "user@example.com" }).success,
		).toBe(true);
		expect(CodexCliAccountEntrySchema.safeParse({}).success).toBe(true);
	});
});
