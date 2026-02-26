import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { decodeJWT } from "./auth/auth.js";
import { extractAccountEmail, extractAccountId, sanitizeEmail } from "./auth/token-utils.js";
import { createLogger } from "./logger.js";
import { MODEL_FAMILIES, type ModelFamily } from "./prompts/codex.js";
import {
	normalizeAccountStorage,
	type AccountMetadataV3,
	type AccountStorageV3,
} from "./storage.js";
import { isRecord } from "./utils.js";

const log = createLogger("codex-sync");

const WINDOWS_RENAME_RETRY_ATTEMPTS = 5;
const WINDOWS_RENAME_RETRY_BASE_DELAY_MS = 10;

export type CodexAuthSourceType = "auth.json" | "accounts.json";

export type CodexSyncErrorCode =
	| "missing-auth-file"
	| "invalid-auth-file"
	| "unsupported-auth-mode"
	| "missing-tokens"
	| "missing-refresh-token"
	| "write-failed";

export class CodexSyncError extends Error {
	readonly code: CodexSyncErrorCode;
	readonly path?: string;

	constructor(message: string, code: CodexSyncErrorCode, path?: string, cause?: Error) {
		super(message, { cause });
		this.name = "CodexSyncError";
		this.code = code;
		this.path = path;
	}
}

export interface CodexPathOptions {
	codexDir?: string;
}

export interface CodexAuthSource {
	type: CodexAuthSourceType;
	path: string;
}

export interface CodexCurrentAccount {
	sourceType: CodexAuthSourceType;
	sourcePath: string;
	email?: string;
	accountId?: string;
	accessToken: string;
	refreshToken: string;
	idToken?: string;
	expiresAt?: number;
}

export interface CodexCliTokenCacheEntryByEmail {
	email: string;
	accessToken: string;
	expiresAt?: number;
	refreshToken?: string;
	accountId?: string;
	sourceType: CodexAuthSourceType;
	sourcePath: string;
}

export interface CodexSyncAccountPayload {
	accessToken: string;
	refreshToken: string;
	idToken?: string;
	accountId?: string;
	email?: string;
	accountIdSource?: AccountMetadataV3["accountIdSource"];
	accountLabel?: string;
	organizationId?: string;
	enabled?: boolean;
}

export interface CodexWriteResult {
	path: string;
	backupPath?: string;
}

export interface CodexPoolWriteResult extends CodexWriteResult {
	totalAccounts: number;
	activeIndex: number;
	created: boolean;
	updated: boolean;
}

function resolveCodexDir(options?: CodexPathOptions): string {
	const override = options?.codexDir?.trim() || process.env.CODEX_AUTH_CLI_DIR?.trim();
	if (override) return override;
	return join(homedir(), ".codex");
}

export function getCodexAuthJsonPath(options?: CodexPathOptions): string {
	return join(resolveCodexDir(options), "auth.json");
}

export function getCodexLegacyAccountsPath(options?: CodexPathOptions): string {
	return join(resolveCodexDir(options), "accounts.json");
}

export function getCodexMultiAuthPoolPath(options?: CodexPathOptions): string {
	return join(resolveCodexDir(options), "multi-auth", "openai-codex-accounts.json");
}

function getNonEmptyString(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

function boolFromUnknown(value: unknown): boolean {
	if (typeof value === "boolean") return value;
	if (typeof value === "number") return value !== 0;
	if (typeof value === "string") {
		const normalized = value.trim().toLowerCase();
		return normalized === "true" || normalized === "1" || normalized === "yes";
	}
	return false;
}

function extractExpiresAt(accessToken: string): number | undefined {
	const decoded = decodeJWT(accessToken);
	const exp = decoded?.exp;
	if (typeof exp === "number" && Number.isFinite(exp)) {
		// JWT exp is in seconds since epoch.
		return exp * 1000;
	}
	return undefined;
}

async function fileExists(filePath: string): Promise<boolean> {
	try {
		await fs.access(filePath);
		return true;
	} catch {
		return false;
	}
}

export async function discoverCodexAuthSource(
	options?: CodexPathOptions,
): Promise<CodexAuthSource | null> {
	const authPath = getCodexAuthJsonPath(options);
	if (await fileExists(authPath)) {
		return { type: "auth.json", path: authPath };
	}

	const legacyPath = getCodexLegacyAccountsPath(options);
	if (await fileExists(legacyPath)) {
		return { type: "accounts.json", path: legacyPath };
	}

	return null;
}

async function readJsonRecord(path: string): Promise<Record<string, unknown>> {
	try {
		const content = await fs.readFile(path, "utf-8");
		const parsed = JSON.parse(content) as unknown;
		if (!isRecord(parsed)) {
			throw new CodexSyncError(`Invalid JSON object in ${path}`, "invalid-auth-file", path);
		}
		return parsed;
	} catch (error) {
		if (error instanceof CodexSyncError) {
			throw error;
		}
		const message = error instanceof Error ? error.message : String(error);
		throw new CodexSyncError(
			`Failed to read ${path}: ${message}`,
			"invalid-auth-file",
			path,
			error instanceof Error ? error : undefined,
		);
	}
}

function parseAuthJsonRecord(
	record: Record<string, unknown>,
	path: string,
	options?: { requireChatgptMode?: boolean; requireRefreshToken?: boolean },
): CodexCurrentAccount | null {
	const requireChatgptMode = options?.requireChatgptMode ?? true;
	const requireRefreshToken = options?.requireRefreshToken ?? true;
	const authMode = getNonEmptyString(record.auth_mode);

	if (authMode && authMode !== "chatgpt") {
		if (requireChatgptMode) {
			throw new CodexSyncError(
				`Codex auth mode is "${authMode}" at ${path}. Switch Codex CLI to ChatGPT OAuth mode before syncing.`,
				"unsupported-auth-mode",
				path,
			);
		}
		return null;
	}

	const tokenRecord = isRecord(record.tokens) ? record.tokens : null;
	const accessToken = getNonEmptyString(tokenRecord?.access_token);
	if (!accessToken) {
		throw new CodexSyncError(`Missing access token in ${path}`, "missing-tokens", path);
	}

	const refreshToken = getNonEmptyString(tokenRecord?.refresh_token);
	if (requireRefreshToken && !refreshToken) {
		throw new CodexSyncError(`Missing refresh token in ${path}`, "missing-refresh-token", path);
	}

	const idToken = getNonEmptyString(tokenRecord?.id_token);
	const accountId =
		getNonEmptyString(tokenRecord?.account_id) ??
		getNonEmptyString(record.account_id) ??
		extractAccountId(accessToken);
	const email =
		sanitizeEmail(getNonEmptyString(record.email)) ??
		sanitizeEmail(extractAccountEmail(accessToken, idToken));

	return {
		sourceType: "auth.json",
		sourcePath: path,
		email,
		accountId,
		accessToken,
		refreshToken: refreshToken ?? "",
		idToken,
		expiresAt: extractExpiresAt(accessToken),
	};
}

function parseLegacyAccountsEntry(
	entry: Record<string, unknown>,
	path: string,
): CodexCurrentAccount | null {
	const auth = isRecord(entry.auth) ? entry.auth : null;
	const tokens = isRecord(auth?.tokens) ? auth.tokens : null;
	const accessToken = getNonEmptyString(tokens?.access_token);
	const refreshToken = getNonEmptyString(tokens?.refresh_token);
	if (!accessToken || !refreshToken) return null;

	const idToken = getNonEmptyString(tokens?.id_token);
	const accountId =
		getNonEmptyString(entry.accountId) ??
		getNonEmptyString(entry.account_id) ??
		getNonEmptyString(tokens?.account_id) ??
		extractAccountId(accessToken);
	const email =
		sanitizeEmail(getNonEmptyString(entry.email)) ??
		sanitizeEmail(extractAccountEmail(accessToken, idToken));

	return {
		sourceType: "accounts.json",
		sourcePath: path,
		email,
		accountId,
		accessToken,
		refreshToken,
		idToken,
		expiresAt: extractExpiresAt(accessToken),
	};
}

function pickLegacyCurrentAccount(
	accounts: unknown[],
	path: string,
): CodexCurrentAccount | null {
	const scored: Array<{ score: number; account: CodexCurrentAccount }> = [];

	for (const entry of accounts) {
		if (!isRecord(entry)) continue;
		const parsed = parseLegacyAccountsEntry(entry, path);
		if (!parsed) continue;

		const score = boolFromUnknown(entry.active) || boolFromUnknown(entry.isActive)
			? 3
			: boolFromUnknown(entry.default) || boolFromUnknown(entry.is_default)
				? 2
				: boolFromUnknown(entry.selected) || boolFromUnknown(entry.current)
					? 1
					: 0;
		scored.push({ score, account: parsed });
	}

	if (scored.length === 0) return null;
	scored.sort((a, b) => b.score - a.score);
	return scored[0]?.account ?? null;
}

export async function readCodexCurrentAccount(
	options?: CodexPathOptions,
): Promise<CodexCurrentAccount> {
	const source = await discoverCodexAuthSource(options);
	if (!source) {
		throw new CodexSyncError(
			"No Codex auth source found. Expected ~/.codex/auth.json or ~/.codex/accounts.json.",
			"missing-auth-file",
		);
	}

	const record = await readJsonRecord(source.path);
	if (source.type === "auth.json") {
		const current = parseAuthJsonRecord(record, source.path, {
			requireChatgptMode: true,
			requireRefreshToken: true,
		});
		if (!current) {
			throw new CodexSyncError(`Unable to parse current account from ${source.path}`, "invalid-auth-file", source.path);
		}
		return current;
	}

	const accounts = Array.isArray(record.accounts) ? record.accounts : [];
	const current = pickLegacyCurrentAccount(accounts, source.path);
	if (!current) {
		throw new CodexSyncError(
			`No valid OAuth account found in ${source.path}`,
			"missing-tokens",
			source.path,
		);
	}
	return current;
}

function parseAuthJsonCacheEntries(path: string, record: Record<string, unknown>): CodexCliTokenCacheEntryByEmail[] {
	try {
		const parsed = parseAuthJsonRecord(record, path, {
			requireChatgptMode: false,
			requireRefreshToken: false,
		});
		if (!parsed) return [];
		if (!parsed.email) return [];
		return [
			{
				email: parsed.email,
				accessToken: parsed.accessToken,
				expiresAt: parsed.expiresAt,
				refreshToken: parsed.refreshToken || undefined,
				accountId: parsed.accountId,
				sourceType: "auth.json",
				sourcePath: path,
			},
		];
	} catch (error) {
		log.debug("Failed to parse Codex auth.json cache entries", { error: String(error), path });
		return [];
	}
}

function parseLegacyCacheEntries(path: string, record: Record<string, unknown>): CodexCliTokenCacheEntryByEmail[] {
	if (!Array.isArray(record.accounts)) return [];
	const result: CodexCliTokenCacheEntryByEmail[] = [];
	for (const rawEntry of record.accounts) {
		if (!isRecord(rawEntry)) continue;
		const parsed = parseLegacyAccountsEntry(rawEntry, path);
		if (!parsed || !parsed.email) continue;
		result.push({
			email: parsed.email,
			accessToken: parsed.accessToken,
			expiresAt: parsed.expiresAt,
			refreshToken: parsed.refreshToken,
			accountId: parsed.accountId,
			sourceType: "accounts.json",
			sourcePath: path,
		});
	}
	return result;
}

export async function loadCodexCliTokenCacheEntriesByEmail(
	options?: CodexPathOptions,
): Promise<CodexCliTokenCacheEntryByEmail[]> {
	const authPath = getCodexAuthJsonPath(options);
	const legacyPath = getCodexLegacyAccountsPath(options);
	const sourceCandidates: CodexAuthSource[] = [];

	if (await fileExists(authPath)) {
		sourceCandidates.push({ type: "auth.json", path: authPath });
	}
	if (await fileExists(legacyPath)) {
		sourceCandidates.push({ type: "accounts.json", path: legacyPath });
	}
	if (sourceCandidates.length === 0) return [];

	for (const source of sourceCandidates) {
		try {
			const record = await readJsonRecord(source.path);
			const entries =
				source.type === "auth.json"
					? parseAuthJsonCacheEntries(source.path, record)
					: parseLegacyCacheEntries(source.path, record);
			if (entries.length > 0) {
				return entries;
			}
		} catch (error) {
			log.debug("Failed to load Codex CLI token cache entries from source", {
				error: String(error),
				sourceType: source.type,
				sourcePath: source.path,
			});
		}
	}

	return [];
}

function formatBackupTimestamp(value: Date): string {
	const year = value.getFullYear();
	const month = String(value.getMonth() + 1).padStart(2, "0");
	const day = String(value.getDate()).padStart(2, "0");
	const hours = String(value.getHours()).padStart(2, "0");
	const minutes = String(value.getMinutes()).padStart(2, "0");
	const seconds = String(value.getSeconds()).padStart(2, "0");
	const millis = String(value.getMilliseconds()).padStart(3, "0");
	return `${year}${month}${day}-${hours}${minutes}${seconds}${millis}`;
}

function createBackupPath(path: string): string {
	const stamp = formatBackupTimestamp(new Date());
	const suffix = randomBytes(3).toString("hex");
	return join(dirname(path), `${basename(path)}.bak-${stamp}-${suffix}`);
}

function isWindowsLockError(error: unknown): error is NodeJS.ErrnoException {
	const code = (error as NodeJS.ErrnoException)?.code;
	return code === "EPERM" || code === "EBUSY";
}

async function renameWithWindowsRetry(sourcePath: string, destinationPath: string): Promise<void> {
	let lastError: NodeJS.ErrnoException | null = null;
	for (let attempt = 0; attempt < WINDOWS_RENAME_RETRY_ATTEMPTS; attempt += 1) {
		try {
			await fs.rename(sourcePath, destinationPath);
			return;
		} catch (error) {
			if (isWindowsLockError(error)) {
				lastError = error;
				await new Promise((resolve) =>
					setTimeout(resolve, WINDOWS_RENAME_RETRY_BASE_DELAY_MS * 2 ** attempt),
				);
				continue;
			}
			throw error;
		}
	}

	if (lastError) throw lastError;
}

async function writeJsonAtomicWithBackup(
	path: string,
	data: Record<string, unknown>,
): Promise<CodexWriteResult> {
	const uniqueSuffix = `${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
	const tempPath = `${path}.${uniqueSuffix}.tmp`;
	let backupPath: string | undefined;

	try {
		await fs.mkdir(dirname(path), { recursive: true });

		if (await fileExists(path)) {
			backupPath = createBackupPath(path);
			await fs.copyFile(path, backupPath);
		}

		const content = JSON.stringify(data, null, 2);
		await fs.writeFile(tempPath, content, { encoding: "utf-8", mode: 0o600 });
		await renameWithWindowsRetry(tempPath, path);
		return { path, backupPath };
	} catch (error) {
		try {
			await fs.unlink(tempPath);
		} catch {
			// Best effort temp cleanup.
		}
		throw new CodexSyncError(
			`Failed to write ${path}: ${error instanceof Error ? error.message : String(error)}`,
			"write-failed",
			path,
			error instanceof Error ? error : undefined,
		);
	}
}

function createFamilyIndexMap(index: number): Partial<Record<ModelFamily, number>> {
	const map: Partial<Record<ModelFamily, number>> = {};
	for (const family of MODEL_FAMILIES) {
		map[family] = index;
	}
	return map;
}

function toIdentityKeys(
	account: Pick<AccountMetadataV3, "organizationId" | "accountId" | "refreshToken">,
): string[] {
	const keys: string[] = [];
	const organizationId = getNonEmptyString(account.organizationId);
	if (organizationId) keys.push(`organizationId:${organizationId}`);
	const accountId = getNonEmptyString(account.accountId);
	if (accountId) keys.push(`accountId:${accountId}`);
	const refreshToken = getNonEmptyString(account.refreshToken);
	if (refreshToken) keys.push(`refreshToken:${refreshToken}`);
	return keys;
}

function findIndexByIdentity(
	accounts: Pick<AccountMetadataV3, "organizationId" | "accountId" | "refreshToken">[],
	identityKeys: string[],
): number {
	if (identityKeys.length === 0) return -1;
	for (const key of identityKeys) {
		const index = accounts.findIndex((candidate) => toIdentityKeys(candidate).includes(key));
		if (index >= 0) return index;
	}
	return -1;
}

function buildPoolAccountPayload(payload: CodexSyncAccountPayload): AccountMetadataV3 {
	const now = Date.now();
	return {
		accountId: payload.accountId,
		organizationId: payload.organizationId,
		accountIdSource: payload.accountIdSource ?? "token",
		accountLabel: payload.accountLabel,
		email: sanitizeEmail(payload.email),
		refreshToken: payload.refreshToken,
		accessToken: payload.accessToken,
		expiresAt: extractExpiresAt(payload.accessToken),
		enabled: payload.enabled === false ? false : undefined,
		addedAt: now,
		lastUsed: now,
	};
}

async function loadPoolStorage(path: string): Promise<AccountStorageV3 | null> {
	if (!(await fileExists(path))) return null;
	try {
		const record = await readJsonRecord(path);
		return normalizeAccountStorage(record);
	} catch (error) {
		log.debug("Failed to parse Codex multi-auth pool, defaulting to empty", {
			error: String(error),
			path,
		});
		return null;
	}
}

export async function writeCodexAuthJsonSession(
	payload: CodexSyncAccountPayload,
	options?: CodexPathOptions,
): Promise<CodexWriteResult> {
	const path = getCodexAuthJsonPath(options);
	let existing: Record<string, unknown> = {};

	if (await fileExists(path)) {
		existing = await readJsonRecord(path);
		const mode = getNonEmptyString(existing.auth_mode);
		if (mode && mode !== "chatgpt") {
			throw new CodexSyncError(
				`Codex auth mode is "${mode}" at ${path}. Switch Codex CLI to ChatGPT OAuth mode before syncing.`,
				"unsupported-auth-mode",
				path,
			);
		}
	}

	const tokens = isRecord(existing.tokens) ? { ...existing.tokens } : {};
	tokens.access_token = payload.accessToken;
	tokens.refresh_token = payload.refreshToken;
	const accountId = payload.accountId ?? extractAccountId(payload.accessToken);
	if (accountId) {
		tokens.account_id = accountId;
	} else {
		delete tokens.account_id;
	}
	if (payload.idToken) {
		tokens.id_token = payload.idToken;
	} else {
		delete tokens.id_token;
	}

	const next: Record<string, unknown> = {
		...existing,
		auth_mode: "chatgpt",
		tokens,
		last_refresh: new Date().toISOString(),
	};

	const existingSyncVersion = existing.codexMultiAuthSyncVersion;
	next.codexMultiAuthSyncVersion =
		typeof existingSyncVersion === "number" && Number.isFinite(existingSyncVersion)
			? existingSyncVersion
			: 1;

	return writeJsonAtomicWithBackup(path, next);
}

export async function writeCodexMultiAuthPool(
	payload: CodexSyncAccountPayload,
	options?: CodexPathOptions,
): Promise<CodexPoolWriteResult> {
	const path = getCodexMultiAuthPoolPath(options);
	const existing = await loadPoolStorage(path);
	const existingAccounts = existing?.accounts ?? [];
	const candidate = buildPoolAccountPayload(payload);
	const identityKeys = toIdentityKeys(candidate);
	const existingIndex = findIndexByIdentity(existingAccounts, identityKeys);

	const merged = [...existingAccounts, candidate];
	const candidateIndex = merged.length - 1;
	const normalized =
		normalizeAccountStorage({
			version: 3,
			accounts: merged,
			activeIndex: candidateIndex,
			activeIndexByFamily: createFamilyIndexMap(candidateIndex),
		}) ??
		({
			version: 3 as const,
			accounts: merged,
			activeIndex: candidateIndex,
			activeIndexByFamily: createFamilyIndexMap(candidateIndex),
		});

	const normalizedIdentityIndex = findIndexByIdentity(normalized.accounts, identityKeys);
	if (normalizedIdentityIndex >= 0) {
		normalized.activeIndex = normalizedIdentityIndex;
		normalized.activeIndexByFamily = createFamilyIndexMap(normalizedIdentityIndex);
	}

	const writeResult = await writeJsonAtomicWithBackup(path, normalized as unknown as Record<string, unknown>);
	return {
		...writeResult,
		totalAccounts: normalized.accounts.length,
		activeIndex: normalized.activeIndex,
		created: existingIndex < 0,
		updated: existingIndex >= 0,
	};
}
