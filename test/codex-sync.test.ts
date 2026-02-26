import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	CodexSyncError,
	discoverCodexAuthSource,
	loadCodexCliTokenCacheEntriesByEmail,
	readCodexCurrentAccount,
	writeCodexAuthJsonSession,
	writeCodexMultiAuthPool,
} from "../lib/codex-sync.js";

function createJwt(payload: Record<string, unknown>): string {
	const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
	const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
	return `${header}.${body}.`;
}

const tempDirs: string[] = [];

async function createCodexDir(name: string): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), `${name}-`));
	tempDirs.push(dir);
	return dir;
}

afterEach(async () => {
	await Promise.all(
		tempDirs.splice(0, tempDirs.length).map(async (dir) => {
			await rm(dir, { recursive: true, force: true });
		}),
	);
});

describe("codex-sync", () => {
	it("prefers auth.json over legacy accounts.json during discovery", async () => {
		const codexDir = await createCodexDir("codex-sync-discovery");
		await writeFile(join(codexDir, "auth.json"), JSON.stringify({ auth_mode: "chatgpt" }), "utf-8");
		await writeFile(join(codexDir, "accounts.json"), JSON.stringify({ accounts: [] }), "utf-8");

		const source = await discoverCodexAuthSource({ codexDir });
		expect(source?.type).toBe("auth.json");
		expect(source?.path).toContain("auth.json");
	});

	it("reads current account from auth.json", async () => {
		const codexDir = await createCodexDir("codex-sync-auth-read");
		const accessToken = createJwt({
			exp: Math.floor(Date.now() / 1000) + 3600,
			"https://api.openai.com/auth": {
				chatgpt_account_id: "acc-from-access",
				chatgpt_user_email: "sync@example.com",
			},
		});
		const authPath = join(codexDir, "auth.json");
		await writeFile(
			authPath,
			JSON.stringify(
				{
					auth_mode: "chatgpt",
					tokens: {
						access_token: accessToken,
						refresh_token: "refresh-1",
					},
				},
				null,
				2,
			),
			"utf-8",
		);

		const current = await readCodexCurrentAccount({ codexDir });
		expect(current.sourceType).toBe("auth.json");
		expect(current.refreshToken).toBe("refresh-1");
		expect(current.accountId).toBe("acc-from-access");
		expect(current.email).toBe("sync@example.com");
		expect(typeof current.expiresAt).toBe("number");
	});

	it("blocks sync when auth_mode is not chatgpt", async () => {
		const codexDir = await createCodexDir("codex-sync-auth-mode");
		await writeFile(
			join(codexDir, "auth.json"),
			JSON.stringify(
				{
					auth_mode: "api_key",
					tokens: {
						access_token: "x",
						refresh_token: "y",
					},
				},
				null,
				2,
			),
			"utf-8",
		);

		await expect(readCodexCurrentAccount({ codexDir })).rejects.toMatchObject({
			name: "CodexSyncError",
			code: "unsupported-auth-mode",
		} satisfies Partial<CodexSyncError>);
	});

	it("parses legacy accounts.json cache entries when auth.json is absent", async () => {
		const codexDir = await createCodexDir("codex-sync-legacy-cache");
		const accessToken = createJwt({
			exp: Math.floor(Date.now() / 1000) + 3600,
			"https://api.openai.com/auth": {
				chatgpt_account_id: "legacy-acc",
			},
			email: "legacy@example.com",
		});
		await writeFile(
			join(codexDir, "accounts.json"),
			JSON.stringify(
				{
					accounts: [
						{
							email: "legacy@example.com",
							accountId: "legacy-acc",
							auth: {
								tokens: {
									access_token: accessToken,
									refresh_token: "legacy-refresh",
								},
							},
						},
					],
				},
				null,
				2,
			),
			"utf-8",
		);

		const entries = await loadCodexCliTokenCacheEntriesByEmail({ codexDir });
		expect(entries).toHaveLength(1);
		expect(entries[0]?.sourceType).toBe("accounts.json");
		expect(entries[0]?.email).toBe("legacy@example.com");
		expect(entries[0]?.accountId).toBe("legacy-acc");
	});

	it("falls back to legacy cache entries when auth.json is unusable", async () => {
		const codexDir = await createCodexDir("codex-sync-cache-fallback");
		await writeFile(
			join(codexDir, "auth.json"),
			JSON.stringify(
				{
					auth_mode: "chatgpt",
					tokens: {
						refresh_token: "missing-access-token",
					},
				},
				null,
				2,
			),
			"utf-8",
		);

		const legacyAccessToken = createJwt({
			exp: Math.floor(Date.now() / 1000) + 3600,
			"https://api.openai.com/auth": {
				chatgpt_account_id: "legacy-fallback-acc",
			},
			email: "legacy-fallback@example.com",
		});
		await writeFile(
			join(codexDir, "accounts.json"),
			JSON.stringify(
				{
					accounts: [
						{
							email: "legacy-fallback@example.com",
							accountId: "legacy-fallback-acc",
							auth: {
								tokens: {
									access_token: legacyAccessToken,
									refresh_token: "legacy-fallback-refresh",
								},
							},
						},
					],
				},
				null,
				2,
			),
			"utf-8",
		);

		const entries = await loadCodexCliTokenCacheEntriesByEmail({ codexDir });
		expect(entries).toHaveLength(1);
		expect(entries[0]?.sourceType).toBe("accounts.json");
		expect(entries[0]?.email).toBe("legacy-fallback@example.com");
		expect(entries[0]?.accountId).toBe("legacy-fallback-acc");
	});

	it("writes auth.json with backup and preserves unrelated keys", async () => {
		const codexDir = await createCodexDir("codex-sync-auth-write");
		const authPath = join(codexDir, "auth.json");
		await writeFile(
			authPath,
			JSON.stringify(
				{
					auth_mode: "chatgpt",
					OPENAI_API_KEY: "keep-me",
					tokens: {
						access_token: "old-access",
						refresh_token: "old-refresh",
					},
				},
				null,
				2,
			),
			"utf-8",
		);

		const accessToken = createJwt({
			exp: Math.floor(Date.now() / 1000) + 3600,
			"https://api.openai.com/auth": {
				chatgpt_account_id: "new-account",
			},
		});
		const result = await writeCodexAuthJsonSession(
			{
				accessToken,
				refreshToken: "new-refresh",
				accountId: "new-account",
			},
			{ codexDir },
		);

		expect(result.path).toBe(authPath);
		expect(result.backupPath).toBeDefined();
		if (result.backupPath) {
			const backupStats = await stat(result.backupPath);
			expect(backupStats.isFile()).toBe(true);
		}

		const saved = JSON.parse(await readFile(authPath, "utf-8")) as Record<string, unknown>;
		expect(saved.auth_mode).toBe("chatgpt");
		expect(saved.OPENAI_API_KEY).toBe("keep-me");
		const savedTokens = saved.tokens as Record<string, unknown>;
		expect(savedTokens.access_token).toBe(accessToken);
		expect(savedTokens.refresh_token).toBe("new-refresh");
		expect(savedTokens.account_id).toBe("new-account");
	});

	it("clears stale account and id token keys when payload omits them", async () => {
		const codexDir = await createCodexDir("codex-sync-clear-stale-token-keys");
		const authPath = join(codexDir, "auth.json");
		await writeFile(
			authPath,
			JSON.stringify(
				{
					auth_mode: "chatgpt",
					tokens: {
						access_token: "old-access",
						refresh_token: "old-refresh",
						account_id: "old-account-id",
						id_token: "old-id-token",
					},
				},
				null,
				2,
			),
			"utf-8",
		);

		const accessToken = createJwt({ exp: Math.floor(Date.now() / 1000) + 3600 });
		await writeCodexAuthJsonSession(
			{
				accessToken,
				refreshToken: "new-refresh-only",
			},
			{ codexDir },
		);

		const saved = JSON.parse(await readFile(authPath, "utf-8")) as {
			tokens?: Record<string, unknown>;
		};
		const savedTokens = saved.tokens ?? {};
		expect(savedTokens.access_token).toBe(accessToken);
		expect(savedTokens.refresh_token).toBe("new-refresh-only");
		expect(savedTokens).not.toHaveProperty("account_id");
		expect(savedTokens).not.toHaveProperty("id_token");
	});

	it("updates existing account in codex multi-auth pool and sets active index", async () => {
		const codexDir = await createCodexDir("codex-sync-pool-write");
		const poolDir = join(codexDir, "multi-auth");
		await mkdir(poolDir, { recursive: true });
		const poolPath = join(poolDir, "openai-codex-accounts.json");

		await writeFile(
			poolPath,
			JSON.stringify(
				{
					version: 3,
					activeIndex: 0,
					activeIndexByFamily: { codex: 0, "gpt-5-codex": 0, "codex-max": 0 },
					accounts: [
						{
							accountId: "pool-acc",
							email: "pool@example.com",
							refreshToken: "pool-refresh",
							accessToken: "old-access",
							addedAt: Date.now() - 1000,
							lastUsed: Date.now() - 1000,
						},
					],
				},
				null,
				2,
			),
			"utf-8",
		);

		const newAccess = createJwt({
			exp: Math.floor(Date.now() / 1000) + 7200,
			"https://api.openai.com/auth": {
				chatgpt_account_id: "pool-acc",
			},
		});
		const result = await writeCodexMultiAuthPool(
			{
				accessToken: newAccess,
				refreshToken: "pool-refresh",
				accountId: "pool-acc",
				email: "pool@example.com",
			},
			{ codexDir },
		);

		expect(result.path).toBe(poolPath);
		expect(result.created).toBe(false);
		expect(result.updated).toBe(true);
		expect(result.totalAccounts).toBe(1);
		expect(result.activeIndex).toBe(0);

		const saved = JSON.parse(await readFile(poolPath, "utf-8")) as {
			accounts: Array<{ accessToken?: string }>;
			activeIndex: number;
		};
		expect(saved.accounts).toHaveLength(1);
		expect(saved.accounts[0]?.accessToken).toBe(newAccess);
		expect(saved.activeIndex).toBe(0);
	});
});
