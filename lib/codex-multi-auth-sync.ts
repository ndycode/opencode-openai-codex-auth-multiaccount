import { existsSync, readdirSync, promises as fs } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, win32 } from "node:path";
import { ACCOUNT_LIMITS } from "./constants.js";
import { logWarn } from "./logger.js";
import {
	deduplicateAccounts,
	deduplicateAccountsByEmail,
	importAccounts,
	loadAccounts,
	normalizeAccountStorage,
	previewImportAccountsWithExistingStorage,
	withAccountStorageTransaction,
	type AccountStorageV3,
	type ImportAccountsResult,
} from "./storage.js";
import { findProjectRoot, getProjectStorageKey } from "./storage/paths.js";

const EXTERNAL_ROOT_SUFFIX = "multi-auth";
const EXTERNAL_ACCOUNT_FILE_NAMES = [
	"openai-codex-accounts.json",
	"codex-accounts.json",
];
const SYNC_ACCOUNT_TAG = "codex-multi-auth-sync";
const SYNC_MAX_ACCOUNTS_OVERRIDE_ENV = "CODEX_AUTH_SYNC_MAX_ACCOUNTS";
const NORMALIZED_IMPORT_TEMP_PREFIX = "oc-chatgpt-multi-auth-sync-";
const STALE_NORMALIZED_IMPORT_MAX_AGE_MS = 10 * 60 * 1000;

export interface CodexMultiAuthResolvedSource {
	rootDir: string;
	accountsPath: string;
	scope: "project" | "global";
}

export interface LoadedCodexMultiAuthSourceStorage extends CodexMultiAuthResolvedSource {
	storage: AccountStorageV3;
}

export interface CodexMultiAuthSyncPreview extends CodexMultiAuthResolvedSource {
	imported: number;
	skipped: number;
	total: number;
}

export interface CodexMultiAuthSyncResult extends CodexMultiAuthSyncPreview {
	backupStatus: ImportAccountsResult["backupStatus"];
	backupPath?: string;
	backupError?: string;
}

export interface CodexMultiAuthCleanupResult {
	before: number;
	after: number;
	removed: number;
	updated: number;
}

export interface CodexMultiAuthSyncCapacityDetails extends CodexMultiAuthResolvedSource {
	currentCount: number;
	sourceCount: number;
	sourceDedupedTotal: number;
	dedupedTotal: number;
	maxAccounts: number;
	needToRemove: number;
	importableNewAccounts: number;
	skippedOverlaps: number;
	suggestedRemovals: Array<{
		index: number;
		email?: string;
		accountLabel?: string;
		refreshToken: string;
		organizationId?: string;
		accountId?: string;
		isCurrentAccount: boolean;
		score: number;
		reason: string;
	}>;
}

function normalizeTrimmedIdentity(value: string | undefined): string | undefined {
	const trimmed = value?.trim();
	return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function normalizeSourceStorage(storage: AccountStorageV3): AccountStorageV3 {
	const normalizedAccounts = storage.accounts.map((account) => {
		const accountId = account.accountId?.trim();
		const organizationId = account.organizationId?.trim();
		const inferredOrganizationId =
			!organizationId &&
			account.accountIdSource === "org" &&
			accountId &&
			accountId.startsWith("org-")
				? accountId
				: organizationId;

		if (inferredOrganizationId && inferredOrganizationId !== organizationId) {
			return {
				...account,
				organizationId: inferredOrganizationId,
			};
		}
		return account;
	});

	return {
		...storage,
		accounts: normalizedAccounts,
	};
}

type NormalizedImportFileOptions = {
	postSuccessCleanupFailureMode?: "throw" | "warn";
	onPostSuccessCleanupFailure?: (details: { tempDir: string; tempPath: string; message: string }) => void;
};

interface PreparedCodexMultiAuthPreviewStorage {
	resolved: CodexMultiAuthResolvedSource & { storage: AccountStorageV3 };
	existing: AccountStorageV3;
}

const TEMP_CLEANUP_RETRY_DELAYS_MS = [100, 250, 500] as const;
const STALE_TEMP_CLEANUP_RETRY_DELAY_MS = 150;

function sleepAsync(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function removeNormalizedImportTempDir(
	tempDir: string,
	tempPath: string,
	options: NormalizedImportFileOptions,
): Promise<void> {
	const retryableCodes = new Set(["EBUSY", "EAGAIN", "ENOTEMPTY", "EACCES", "EPERM"]);
	let lastMessage = "unknown cleanup failure";
	for (let attempt = 0; attempt <= TEMP_CLEANUP_RETRY_DELAYS_MS.length; attempt += 1) {
		try {
			await fs.rm(tempDir, { recursive: true, force: true });
			return;
		} catch (cleanupError) {
			const code = (cleanupError as NodeJS.ErrnoException).code;
			lastMessage = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
			if ((!code || retryableCodes.has(code)) && attempt < TEMP_CLEANUP_RETRY_DELAYS_MS.length) {
				const delayMs = TEMP_CLEANUP_RETRY_DELAYS_MS[attempt];
				if (delayMs !== undefined) {
					await sleepAsync(delayMs);
				}
				continue;
			}
			break;
		}
	}

	logWarn(`Failed to remove temporary codex sync directory ${tempDir}: ${lastMessage}`);
	options.onPostSuccessCleanupFailure?.({ tempDir, tempPath, message: lastMessage });
	if (options.postSuccessCleanupFailureMode !== "warn") {
		throw new Error(`Failed to remove temporary codex sync directory ${tempDir}: ${lastMessage}`);
	}
}

function normalizeCleanupRateLimitResetTimes(
	value: AccountStorageV3["accounts"][number]["rateLimitResetTimes"],
): Array<[string, number]> {
	return Object.entries(value ?? {})
		.filter((entry): entry is [string, number] => typeof entry[1] === "number" && Number.isFinite(entry[1]))
		.sort(([left], [right]) => left.localeCompare(right));
}

function normalizeCleanupTags(tags: string[] | undefined): string[] {
	return [...(tags ?? [])].sort((left, right) => left.localeCompare(right));
}

function cleanupComparableAccount(account: AccountStorageV3["accounts"][number]): Record<string, unknown> {
	return {
		refreshToken: account.refreshToken,
		accessToken: account.accessToken,
		expiresAt: account.expiresAt,
		accountId: account.accountId,
		organizationId: account.organizationId,
		accountIdSource: account.accountIdSource,
		accountLabel: account.accountLabel,
		email: account.email,
		enabled: account.enabled,
		addedAt: account.addedAt,
		lastUsed: account.lastUsed,
		coolingDownUntil: account.coolingDownUntil,
		cooldownReason: account.cooldownReason,
		lastSwitchReason: account.lastSwitchReason,
		accountNote: account.accountNote,
		accountTags: normalizeCleanupTags(account.accountTags),
		rateLimitResetTimes: normalizeCleanupRateLimitResetTimes(account.rateLimitResetTimes),
	};
}

function accountsEqualForCleanup(
	left: AccountStorageV3["accounts"][number],
	right: AccountStorageV3["accounts"][number],
): boolean {
	return JSON.stringify(cleanupComparableAccount(left)) === JSON.stringify(cleanupComparableAccount(right));
}

function storagesEqualForCleanup(left: AccountStorageV3, right: AccountStorageV3): boolean {
	if (left.activeIndex !== right.activeIndex) return false;

	const leftFamilyIndices = (left.activeIndexByFamily ?? {}) as Record<string, number>;
	const rightFamilyIndices = (right.activeIndexByFamily ?? {}) as Record<string, number>;
	const familyKeys = new Set([...Object.keys(leftFamilyIndices), ...Object.keys(rightFamilyIndices)]);

	for (const family of familyKeys) {
		if ((leftFamilyIndices[family] ?? left.activeIndex) !== (rightFamilyIndices[family] ?? right.activeIndex)) {
			return false;
		}
	}

	if (left.accounts.length !== right.accounts.length) return false;
	return left.accounts.every((account, index) => {
		const candidate = right.accounts[index];
		return candidate ? accountsEqualForCleanup(account, candidate) : false;
	});
}

function createCleanupRedactedStorage(storage: AccountStorageV3): AccountStorageV3 {
	return {
		...storage,
		accounts: storage.accounts.map((account) => ({
			...account,
			refreshToken: "__redacted__",
			accessToken: undefined,
			idToken: undefined,
		})),
	};
}

async function redactNormalizedImportTempFile(tempPath: string, storage: AccountStorageV3): Promise<void> {
	try {
		const redactedStorage = createCleanupRedactedStorage(storage);
		await fs.writeFile(tempPath, `${JSON.stringify(redactedStorage, null, 2)}\n`, {
			encoding: "utf-8",
			mode: 0o600,
			flag: "w",
		});
	} catch (error) {
		logWarn(
			`Failed to redact temporary codex sync file ${tempPath} before cleanup: ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
	}
}

async function withNormalizedImportFile<T>(
	storage: AccountStorageV3,
	handler: (filePath: string) => Promise<T>,
	options: NormalizedImportFileOptions = {},
): Promise<T> {
	const runWithTempDir = async (tempDir: string): Promise<T> => {
		await fs.chmod(tempDir, 0o700).catch(() => undefined);
		const tempPath = join(tempDir, "accounts.json");
		try {
			await fs.writeFile(tempPath, `${JSON.stringify(storage, null, 2)}\n`, {
				encoding: "utf-8",
				mode: 0o600,
				flag: "wx",
			});
			const result = await handler(tempPath);
			await redactNormalizedImportTempFile(tempPath, storage);
			await removeNormalizedImportTempDir(tempDir, tempPath, options);
			return result;
		} catch (error) {
			await redactNormalizedImportTempFile(tempPath, storage);
			try {
				await removeNormalizedImportTempDir(tempDir, tempPath, { postSuccessCleanupFailureMode: "warn" });
			} catch (cleanupError) {
				const message = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
				logWarn(`Failed to remove temporary codex sync directory ${tempDir}: ${message}`);
			}
			throw error;
		}
	};

	const secureTempRoot = join(getResolvedUserHomeDir(), ".opencode", "tmp");
	// On Windows the mode/chmod calls are ignored; the home-directory ACLs remain
	// the actual isolation boundary for this temporary token material.
	await fs.mkdir(secureTempRoot, { recursive: true, mode: 0o700 });
	await cleanupStaleNormalizedImportTempDirs(secureTempRoot);
	const tempDir = await fs.mkdtemp(join(secureTempRoot, NORMALIZED_IMPORT_TEMP_PREFIX));
	return runWithTempDir(tempDir);
}

async function cleanupStaleNormalizedImportTempDirs(
	secureTempRoot: string,
	now = Date.now(),
): Promise<void> {
	try {
		const entries = await fs.readdir(secureTempRoot, { withFileTypes: true });
		for (const entry of entries) {
			if (!entry.isDirectory() || !entry.name.startsWith(NORMALIZED_IMPORT_TEMP_PREFIX)) {
				continue;
			}

			const candidateDir = join(secureTempRoot, entry.name);
			try {
				const stats = await fs.stat(candidateDir);
				if (now - stats.mtimeMs < STALE_NORMALIZED_IMPORT_MAX_AGE_MS) {
					continue;
				}
				await fs.rm(candidateDir, { recursive: true, force: true });
			} catch (error) {
				let code = (error as NodeJS.ErrnoException).code;
				if (code === "ENOENT") {
					continue;
				}
				let message = error instanceof Error ? error.message : String(error);
				if (code === "EBUSY" || code === "EACCES" || code === "EPERM") {
					await sleepAsync(STALE_TEMP_CLEANUP_RETRY_DELAY_MS);
					try {
						await fs.rm(candidateDir, { recursive: true, force: true });
						continue;
					} catch (retryError) {
						code = (retryError as NodeJS.ErrnoException).code;
						if (code === "ENOENT") {
							continue;
						}
						message = retryError instanceof Error ? retryError.message : String(retryError);
					}
				}
				logWarn(`Failed to sweep stale codex sync temp directory ${candidateDir}: ${message}`);
			}
		}
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code === "ENOENT") {
			return;
		}
		const message = error instanceof Error ? error.message : String(error);
		logWarn(`Failed to list codex sync temp root ${secureTempRoot}: ${message}`);
	}
}

function deduplicateAccountsForSync(storage: AccountStorageV3): AccountStorageV3 {
	return {
		...storage,
		accounts: deduplicateAccountsByEmail(deduplicateAccounts(storage.accounts)),
	};
}

function selectNewestByTimestamp<T extends { addedAt?: number; lastUsed?: number }>(
	current: T,
	candidate: T,
): T {
	const currentLastUsed = current.lastUsed ?? 0;
	const candidateLastUsed = candidate.lastUsed ?? 0;
	if (candidateLastUsed > currentLastUsed) return candidate;
	if (candidateLastUsed < currentLastUsed) return current;
	const currentAddedAt = current.addedAt ?? 0;
	const candidateAddedAt = candidate.addedAt ?? 0;
	return candidateAddedAt >= currentAddedAt ? candidate : current;
}

function deduplicateSourceAccountsByEmail(
	accounts: AccountStorageV3["accounts"],
): AccountStorageV3["accounts"] {
	const deduplicatedInput = deduplicateAccounts(accounts);
	const deduplicated: AccountStorageV3["accounts"] = [];
	const emailToIndex = new Map<string, number>();

	for (const account of deduplicatedInput) {
		if (normalizeIdentity(account.organizationId) || normalizeIdentity(account.accountId)) {
			deduplicated.push(account);
			continue;
		}
		const normalizedEmail = normalizeIdentity(account.email);
		if (!normalizedEmail) {
			deduplicated.push(account);
			continue;
		}

		const existingIndex = emailToIndex.get(normalizedEmail);
		if (existingIndex === undefined) {
			emailToIndex.set(normalizedEmail, deduplicated.length);
			deduplicated.push(account);
			continue;
		}

		const existing = deduplicated[existingIndex];
		if (!existing) continue;
		const newest = selectNewestByTimestamp(existing, account);
		const older = newest === existing ? account : existing;
		deduplicated[existingIndex] = {
			...older,
			...newest,
			email: newest.email ?? older.email,
			accountLabel: newest.accountLabel ?? older.accountLabel,
			accountId: newest.accountId ?? older.accountId,
			organizationId: newest.organizationId ?? older.organizationId,
			accountIdSource: newest.accountIdSource ?? older.accountIdSource,
			refreshToken: newest.refreshToken ?? older.refreshToken,
		};
	}

	return deduplicated;
}

function buildExistingSyncIdentityState(existingAccounts: AccountStorageV3["accounts"]): {
	organizationIds: Set<string>;
	accountIds: Set<string>;
	refreshTokens: Set<string>;
	emails: Set<string>;
} {
	const organizationIds = new Set<string>();
	const accountIds = new Set<string>();
	const refreshTokens = new Set<string>();
	const emails = new Set<string>();

	for (const account of existingAccounts) {
		const organizationId = normalizeIdentity(account.organizationId);
		const accountId = normalizeIdentity(account.accountId);
		const refreshToken = normalizeTrimmedIdentity(account.refreshToken);
		const email = normalizeIdentity(account.email);
		if (organizationId) organizationIds.add(organizationId);
		if (accountId) accountIds.add(accountId);
		if (refreshToken) refreshTokens.add(refreshToken);
		if (email) emails.add(email);
	}

	return {
		organizationIds,
		accountIds,
		refreshTokens,
		emails,
	};
}

function filterSourceAccountsAgainstExistingEmails(
	sourceStorage: AccountStorageV3,
	existingAccounts: AccountStorageV3["accounts"],
): AccountStorageV3 {
	const existingState = buildExistingSyncIdentityState(existingAccounts);

	return {
		...sourceStorage,
		accounts: deduplicateSourceAccountsByEmail(sourceStorage.accounts).filter((account) => {
			const organizationId = normalizeIdentity(account.organizationId);
			if (organizationId) {
				return !existingState.organizationIds.has(organizationId);
			}
			const accountId = normalizeIdentity(account.accountId);
			if (accountId) {
				return !existingState.accountIds.has(accountId);
			}
			const refreshToken = normalizeTrimmedIdentity(account.refreshToken);
			if (refreshToken && existingState.refreshTokens.has(refreshToken)) {
				return false;
			}
			const normalizedEmail = normalizeIdentity(account.email);
			if (normalizedEmail) {
				return !existingState.emails.has(normalizedEmail);
			}
			return true;
		}),
	};
}

function buildMergedDedupedAccounts(
	currentAccounts: AccountStorageV3["accounts"],
	sourceAccounts: AccountStorageV3["accounts"],
): AccountStorageV3["accounts"] {
	return deduplicateAccountsForSync({
		version: 3,
		accounts: [...currentAccounts, ...sourceAccounts],
		activeIndex: 0,
		activeIndexByFamily: {},
	}).accounts;
}

function computeSyncCapacityDetails(
	resolved: CodexMultiAuthResolvedSource,
	sourceStorage: AccountStorageV3,
	existing: AccountStorageV3,
	maxAccounts: number,
): CodexMultiAuthSyncCapacityDetails | null {
	const sourceDedupedTotal = buildMergedDedupedAccounts([], sourceStorage.accounts).length;
	const mergedAccounts = buildMergedDedupedAccounts(existing.accounts, sourceStorage.accounts);
	if (mergedAccounts.length <= maxAccounts) {
		return null;
	}

	const currentCount = existing.accounts.length;
	const sourceCount = sourceStorage.accounts.length;
	const dedupedTotal = mergedAccounts.length;
	const importableNewAccounts = Math.max(0, dedupedTotal - currentCount);
	const skippedOverlaps = Math.max(0, sourceCount - importableNewAccounts);
	if (sourceDedupedTotal > maxAccounts) {
		return {
			rootDir: resolved.rootDir,
			accountsPath: resolved.accountsPath,
			scope: resolved.scope,
			currentCount,
			sourceCount,
			sourceDedupedTotal,
			dedupedTotal: sourceDedupedTotal,
			maxAccounts,
			needToRemove: sourceDedupedTotal - maxAccounts,
			importableNewAccounts: 0,
			skippedOverlaps: Math.max(0, sourceCount - sourceDedupedTotal),
			suggestedRemovals: [],
		};
	}

	const sourceIdentities = buildSourceIdentitySet(sourceStorage);
	const suggestedRemovals = existing.accounts
		.map((account, index) => {
			const matchesSource = accountMatchesSource(account, sourceIdentities);
			const isCurrentAccount = index === existing.activeIndex;
			const hypotheticalAccounts = existing.accounts.filter((_, candidateIndex) => candidateIndex !== index);
			const hypotheticalTotal = buildMergedDedupedAccounts(hypotheticalAccounts, sourceStorage.accounts).length;
			const capacityRelief = Math.max(0, dedupedTotal - hypotheticalTotal);
			return {
				index,
				email: account.email,
				accountLabel: account.accountLabel,
				refreshToken: account.refreshToken,
				organizationId: account.organizationId,
				accountId: account.accountId,
				isCurrentAccount,
				enabled: account.enabled !== false,
				matchesSource,
				lastUsed: account.lastUsed ?? 0,
				capacityRelief,
				score: buildRemovalScore(account, { matchesSource, isCurrentAccount, capacityRelief }),
				reason: buildRemovalExplanation(account, { matchesSource, capacityRelief }),
			};
		})
		.sort((left, right) => {
			if (left.score !== right.score) {
				return right.score - left.score;
			}
			if (left.lastUsed !== right.lastUsed) {
				return left.lastUsed - right.lastUsed;
			}
			return left.index - right.index;
		})
		.slice(0, Math.max(5, dedupedTotal - maxAccounts))
		.map(({ index, email, accountLabel, refreshToken, organizationId, accountId, isCurrentAccount, score, reason }) => ({
			index,
			email,
			accountLabel,
			refreshToken,
			organizationId,
			accountId,
			isCurrentAccount,
			score,
			reason,
		}));

	return {
		rootDir: resolved.rootDir,
		accountsPath: resolved.accountsPath,
		scope: resolved.scope,
		currentCount,
		sourceCount,
		sourceDedupedTotal,
		dedupedTotal,
		maxAccounts,
		needToRemove: dedupedTotal - maxAccounts,
		importableNewAccounts,
		skippedOverlaps,
		suggestedRemovals,
	};
}

function normalizeIdentity(value: string | undefined): string | undefined {
	const trimmed = value?.trim();
	return trimmed && trimmed.length > 0 ? trimmed.toLowerCase() : undefined;
}

function toCleanupIdentityKeys(account: {
	organizationId?: string;
	accountId?: string;
	refreshToken: string;
}): string[] {
	const keys: string[] = [];
	const organizationId = normalizeIdentity(account.organizationId);
	if (organizationId) keys.push(`org:${organizationId}`);
	const accountId = normalizeIdentity(account.accountId);
	if (accountId) keys.push(`account:${accountId}`);
	const refreshToken = normalizeTrimmedIdentity(account.refreshToken);
	if (refreshToken) keys.push(`refresh:${refreshToken}`);
	return keys;
}

function extractCleanupActiveKeys(
	accounts: AccountStorageV3["accounts"],
	activeIndex: number,
): string[] {
	const candidate = accounts[activeIndex];
	if (!candidate) return [];
	return toCleanupIdentityKeys({
		organizationId: candidate.organizationId,
		accountId: candidate.accountId,
		refreshToken: candidate.refreshToken,
	});
}

function findCleanupAccountIndexByIdentityKeys(
	accounts: AccountStorageV3["accounts"],
	identityKeys: string[],
): number {
	if (identityKeys.length === 0) return -1;
	for (const identityKey of identityKeys) {
		const index = accounts.findIndex((account) =>
			toCleanupIdentityKeys({
				organizationId: account.organizationId,
				accountId: account.accountId,
				refreshToken: account.refreshToken,
			}).includes(identityKey),
		);
		if (index >= 0) return index;
	}
	return -1;
}

function buildSourceIdentitySet(storage: AccountStorageV3): Set<string> {
	const identities = new Set<string>();
	for (const account of storage.accounts) {
		const organizationId = normalizeIdentity(account.organizationId);
		const accountId = normalizeIdentity(account.accountId);
		const email = normalizeIdentity(account.email);
		const refreshToken = normalizeTrimmedIdentity(account.refreshToken);
		if (organizationId) identities.add(`org:${organizationId}`);
		if (accountId) identities.add(`account:${accountId}`);
		if (email) identities.add(`email:${email}`);
		if (refreshToken) identities.add(`refresh:${refreshToken}`);
	}
	return identities;
}

function accountMatchesSource(account: AccountStorageV3["accounts"][number], sourceIdentities: Set<string>): boolean {
	const organizationId = normalizeIdentity(account.organizationId);
	const accountId = normalizeIdentity(account.accountId);
	const email = normalizeIdentity(account.email);
	const refreshToken = normalizeTrimmedIdentity(account.refreshToken);
	return (
		(organizationId ? sourceIdentities.has(`org:${organizationId}`) : false) ||
		(accountId ? sourceIdentities.has(`account:${accountId}`) : false) ||
		(email ? sourceIdentities.has(`email:${email}`) : false) ||
		(refreshToken ? sourceIdentities.has(`refresh:${refreshToken}`) : false)
	);
}

function buildRemovalScore(
	account: AccountStorageV3["accounts"][number],
	options: { matchesSource: boolean; isCurrentAccount: boolean; capacityRelief: number },
): number {
	let score = 0;
	if (options.isCurrentAccount) {
		score -= 1000;
	}
	score += options.capacityRelief * 1000;
	if (account.enabled === false) {
		score += 120;
	}
	if (!options.matchesSource) {
		score += 80;
	}
	const lastUsed = account.lastUsed ?? 0;
	if (lastUsed > 0) {
		const ageDays = Math.max(0, Math.floor((Date.now() - lastUsed) / 86_400_000));
		score += Math.min(60, ageDays);
	} else {
		score += 40;
	}
	return score;
}

function buildRemovalExplanation(
	account: AccountStorageV3["accounts"][number],
	options: { matchesSource: boolean; capacityRelief: number },
): string {
	const details: string[] = [];
	if (options.capacityRelief > 0) {
		details.push(`frees ${options.capacityRelief} sync slot${options.capacityRelief === 1 ? "" : "s"}`);
	}
	if (account.enabled === false) {
		details.push("disabled");
	}
	if (!options.matchesSource) {
		details.push("not present in codex-multi-auth source");
	}
	if (details.length === 0) {
		details.push("least recently used");
	}
	return details.join(", ");
}

function firstNonEmpty(values: Array<string | undefined>): string | null {
	for (const value of values) {
		const trimmed = (value ?? "").trim();
		if (trimmed.length > 0) {
			return trimmed;
		}
	}
	return null;
}

function getResolvedUserHomeDir(): string {
	if (process.platform === "win32") {
		const homeDrive = (process.env.HOMEDRIVE ?? "").trim();
		const homePath = (process.env.HOMEPATH ?? "").trim();
		const drivePathHome =
			homeDrive.length > 0 && homePath.length > 0
				? win32.resolve(`${homeDrive}\\`, homePath)
				: undefined;
		return (
			firstNonEmpty([
				process.env.USERPROFILE,
				process.env.HOME,
				drivePathHome,
				homedir(),
			]) ?? homedir()
		);
	}
	return firstNonEmpty([process.env.HOME, homedir()]) ?? homedir();
}

function deduplicatePaths(paths: string[]): string[] {
	const seen = new Set<string>();
	const result: string[] = [];
	for (const candidate of paths) {
		const trimmed = candidate.trim();
		if (trimmed.length === 0) continue;
		const key = process.platform === "win32" ? trimmed.toLowerCase() : trimmed;
		if (seen.has(key)) continue;
		seen.add(key);
		result.push(trimmed);
	}
	return result;
}

function hasStorageSignals(dir: string): boolean {
	for (const fileName of [...EXTERNAL_ACCOUNT_FILE_NAMES, "settings.json", "dashboard-settings.json", "config.json"]) {
		if (existsSync(join(dir, fileName))) {
			return true;
		}
	}
	return existsSync(join(dir, "projects"));
}

function hasProjectScopedAccountsStorage(dir: string): boolean {
	const projectsDir = join(dir, "projects");
	try {
		for (const entry of readdirSync(projectsDir, { withFileTypes: true })) {
			if (!entry.isDirectory()) {
				continue;
			}
			for (const fileName of EXTERNAL_ACCOUNT_FILE_NAMES) {
				if (existsSync(join(projectsDir, entry.name, fileName))) {
					return true;
				}
			}
		}
	} catch {
		// best-effort probe; missing or unreadable project roots simply mean "no signal"
	}
	return false;
}

function hasAccountsStorage(dir: string): boolean {
	return (
		EXTERNAL_ACCOUNT_FILE_NAMES.some((fileName) => existsSync(join(dir, fileName))) ||
		hasProjectScopedAccountsStorage(dir)
	);
}

function getCodexHomeDir(): string {
	const fromEnv = (process.env.CODEX_HOME ?? "").trim();
	return fromEnv.length > 0 ? fromEnv : join(getResolvedUserHomeDir(), ".codex");
}

function getCodexMultiAuthRootCandidates(userHome: string): string[] {
	const candidates = [
		join(userHome, "DevTools", "config", "codex", EXTERNAL_ROOT_SUFFIX),
		join(userHome, ".codex", EXTERNAL_ROOT_SUFFIX),
	];
	const explicitCodexHome = (process.env.CODEX_HOME ?? "").trim();
	if (explicitCodexHome.length > 0) {
		candidates.unshift(join(getCodexHomeDir(), EXTERNAL_ROOT_SUFFIX));
	}
	return deduplicatePaths(candidates);
}

function validateCodexMultiAuthRootDir(pathValue: string): string {
	const trimmed = pathValue.trim();
	if (trimmed.length === 0) {
		throw new Error("CODEX_MULTI_AUTH_DIR must not be empty");
	}
	if (process.platform === "win32") {
		const normalized = trimmed.replace(/\//g, "\\");
		const isExtendedDrivePath = /^\\\\[?.]\\[a-zA-Z]:\\/.test(normalized);
		if (normalized.startsWith("\\\\") && !isExtendedDrivePath) {
			throw new Error("CODEX_MULTI_AUTH_DIR must use a local absolute path, not a UNC network share");
		}
		if (!/^[a-zA-Z]:\\/.test(normalized) && !isExtendedDrivePath) {
			throw new Error("CODEX_MULTI_AUTH_DIR must be an absolute local path");
		}
		return normalized;
	}
	if (!trimmed.startsWith("/")) {
		throw new Error("CODEX_MULTI_AUTH_DIR must be an absolute path");
	}
	return trimmed;
}

function tagSyncedAccounts(storage: AccountStorageV3): AccountStorageV3 {
	return {
		...storage,
		accounts: storage.accounts.map((account) => {
			const existingTags = Array.isArray(account.accountTags) ? account.accountTags : [];
			return {
				...account,
				accountTags: existingTags.includes(SYNC_ACCOUNT_TAG)
					? existingTags
					: [...existingTags, SYNC_ACCOUNT_TAG],
			};
		}),
	};
}

export function getCodexMultiAuthSourceRootDir(): string {
	const fromEnv = (process.env.CODEX_MULTI_AUTH_DIR ?? "").trim();
	if (fromEnv.length > 0) {
		return validateCodexMultiAuthRootDir(fromEnv);
	}

	const userHome = getResolvedUserHomeDir();
	const candidates = getCodexMultiAuthRootCandidates(userHome);

	for (const candidate of candidates) {
		if (hasAccountsStorage(candidate)) {
			return candidate;
		}
	}

	for (const candidate of candidates) {
		if (hasStorageSignals(candidate)) {
			return candidate;
		}
	}

	return candidates[0] ?? join(userHome, ".codex", EXTERNAL_ROOT_SUFFIX);
}

function getProjectScopedAccountsPath(rootDir: string, projectPath: string): string | undefined {
	const projectRoot = findProjectRoot(projectPath);
	if (!projectRoot) {
		return undefined;
	}

	const candidateKey = getProjectStorageKey(projectRoot);
	for (const fileName of EXTERNAL_ACCOUNT_FILE_NAMES) {
		const candidate = join(rootDir, "projects", candidateKey, fileName);
		if (existsSync(candidate)) {
			return candidate;
		}
	}
	return undefined;
}

function getGlobalAccountsPath(rootDir: string): string | undefined {
	for (const fileName of EXTERNAL_ACCOUNT_FILE_NAMES) {
		const candidate = join(rootDir, fileName);
		if (existsSync(candidate)) {
			return candidate;
		}
	}
	return undefined;
}

export function resolveCodexMultiAuthAccountsSource(projectPath = process.cwd()): CodexMultiAuthResolvedSource {
	const fromEnv = (process.env.CODEX_MULTI_AUTH_DIR ?? "").trim();
	const userHome = getResolvedUserHomeDir();
	const candidates =
		fromEnv.length > 0
			? [validateCodexMultiAuthRootDir(fromEnv)]
			: getCodexMultiAuthRootCandidates(userHome);

	for (const rootDir of candidates) {
		const projectScopedPath = getProjectScopedAccountsPath(rootDir, projectPath);
		if (projectScopedPath) {
			return {
				rootDir,
				accountsPath: projectScopedPath,
				scope: "project",
			};
		}

		const globalPath = getGlobalAccountsPath(rootDir);
		if (globalPath) {
			return {
				rootDir,
				accountsPath: globalPath,
				scope: "global",
			};
		}
	}

	const hintedRoot = candidates.find((candidate) => hasAccountsStorage(candidate) || hasStorageSignals(candidate)) ?? candidates[0];
	throw new Error(`No codex-multi-auth accounts file found under ${hintedRoot}`);
}

function getSyncCapacityLimit(): number {
	const override = (process.env[SYNC_MAX_ACCOUNTS_OVERRIDE_ENV] ?? "").trim();
	if (override.length === 0) {
		return ACCOUNT_LIMITS.MAX_ACCOUNTS;
	}
	if (/^\d+$/.test(override)) {
		const parsed = Number.parseInt(override, 10);
		if (parsed > 0) {
			return Number.isFinite(ACCOUNT_LIMITS.MAX_ACCOUNTS)
				? Math.min(parsed, ACCOUNT_LIMITS.MAX_ACCOUNTS)
				: parsed;
		}
	}
	const message = `${SYNC_MAX_ACCOUNTS_OVERRIDE_ENV} override value "${override}" is not a positive integer; ignoring.`;
	logWarn(message);
	try {
		process.stderr.write(`${message}\n`);
	} catch {
		// best-effort warning for non-interactive shells
	}
	return ACCOUNT_LIMITS.MAX_ACCOUNTS;
}

export async function loadCodexMultiAuthSourceStorage(
	projectPath = process.cwd(),
): Promise<LoadedCodexMultiAuthSourceStorage> {
	const resolved = resolveCodexMultiAuthAccountsSource(projectPath);
	const raw = await fs.readFile(resolved.accountsPath, "utf-8");
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw) as unknown;
	} catch {
		throw new Error(`Invalid JSON in codex-multi-auth accounts file: ${resolved.accountsPath}`);
	}

	const storage = normalizeAccountStorage(parsed);
	if (!storage) {
		throw new Error(`Invalid codex-multi-auth account storage format: ${resolved.accountsPath}`);
	}

	return {
		...resolved,
		storage: normalizeSourceStorage(storage),
	};
}

function createEmptyAccountStorage(): AccountStorageV3 {
	return {
		version: 3,
		accounts: [],
		activeIndex: 0,
		activeIndexByFamily: {},
	};
}

async function prepareCodexMultiAuthPreviewStorage(
	resolved: CodexMultiAuthResolvedSource & { storage: AccountStorageV3 },
): Promise<PreparedCodexMultiAuthPreviewStorage> {
	const current = await loadAccounts();
	const existing = current ?? createEmptyAccountStorage();
	const preparedStorage = filterSourceAccountsAgainstExistingEmails(
		resolved.storage,
		existing.accounts,
	);
	const maxAccounts = getSyncCapacityLimit();
	// Infinity is the sentinel for the default unlimited-account mode.
	if (Number.isFinite(maxAccounts)) {
		const details = computeSyncCapacityDetails(resolved, preparedStorage, existing, maxAccounts);
		if (details) {
			throw new CodexMultiAuthSyncCapacityError(details);
		}
	}
	return {
		resolved: {
			...resolved,
			storage: preparedStorage,
		},
		existing,
	};
}

export async function previewSyncFromCodexMultiAuth(
	projectPath = process.cwd(),
	loadedSource?: LoadedCodexMultiAuthSourceStorage,
): Promise<CodexMultiAuthSyncPreview> {
	const source = loadedSource ?? (await loadCodexMultiAuthSourceStorage(projectPath));
	const { resolved, existing } = await prepareCodexMultiAuthPreviewStorage(source);
	const preview = await withNormalizedImportFile(
		resolved.storage,
		(filePath) => previewImportAccountsWithExistingStorage(filePath, existing),
		{ postSuccessCleanupFailureMode: "warn" },
	);
	return {
		rootDir: resolved.rootDir,
		accountsPath: resolved.accountsPath,
		scope: resolved.scope,
		...preview,
	};
}

export async function syncFromCodexMultiAuth(
	projectPath = process.cwd(),
	loadedSource?: LoadedCodexMultiAuthSourceStorage,
): Promise<CodexMultiAuthSyncResult> {
	const resolved = loadedSource ?? (await loadCodexMultiAuthSourceStorage(projectPath));
	const result: ImportAccountsResult = await withNormalizedImportFile(
		tagSyncedAccounts(resolved.storage),
		(filePath) => {
			const maxAccounts = getSyncCapacityLimit();
			return importAccounts(
				filePath,
				{
					preImportBackupPrefix: "codex-multi-auth-sync-backup",
					backupMode: "required",
				},
				(normalizedStorage, existing) => {
					const filteredStorage = filterSourceAccountsAgainstExistingEmails(
						normalizedStorage,
						existing?.accounts ?? [],
					);
					// Infinity is the sentinel for the default unlimited-account mode.
					if (Number.isFinite(maxAccounts)) {
						const details = computeSyncCapacityDetails(
							resolved,
							filteredStorage,
							existing ??
								({
									version: 3,
									accounts: [],
									activeIndex: 0,
									activeIndexByFamily: {},
								} satisfies AccountStorageV3),
							maxAccounts,
						);
						if (details) {
							throw new CodexMultiAuthSyncCapacityError(details);
						}
					}
					return filteredStorage;
				},
			);
		},
		{ postSuccessCleanupFailureMode: "warn" },
	);
	return {
		rootDir: resolved.rootDir,
		accountsPath: resolved.accountsPath,
		scope: resolved.scope,
		backupStatus: result.backupStatus,
		backupPath: result.backupPath,
		backupError: result.backupError,
		imported: result.imported,
		skipped: result.skipped,
		total: result.total,
	};
}

function buildCodexMultiAuthOverlapCleanupPlan(existing: AccountStorageV3): {
	result: CodexMultiAuthCleanupResult;
	nextStorage?: AccountStorageV3;
} {
	const before = existing.accounts.length;
	const syncedAccounts = existing.accounts.filter((account) =>
		Array.isArray(account.accountTags) && account.accountTags.includes(SYNC_ACCOUNT_TAG),
	);
	if (syncedAccounts.length === 0) {
		return {
			result: {
				before,
				after: before,
				removed: 0,
				updated: 0,
			},
		};
	}
	const preservedAccounts = existing.accounts.filter(
		(account) => !(Array.isArray(account.accountTags) && account.accountTags.includes(SYNC_ACCOUNT_TAG)),
	);
	const normalizedSyncedStorage = normalizeAccountStorage(
		normalizeSourceStorage({
			...existing,
			accounts: syncedAccounts,
		}),
	);
	if (!normalizedSyncedStorage) {
		return {
			result: {
				before,
				after: before,
				removed: 0,
				updated: 0,
			},
		};
	}
	const filteredSyncedAccounts = filterSourceAccountsAgainstExistingEmails(
		normalizedSyncedStorage,
		preservedAccounts,
	).accounts;
	const deduplicatedSyncedAccounts = deduplicateAccounts(filteredSyncedAccounts);
	const normalized = {
		...existing,
		accounts: [...preservedAccounts, ...deduplicatedSyncedAccounts],
	} satisfies AccountStorageV3;
	const existingActiveKeys = extractCleanupActiveKeys(existing.accounts, existing.activeIndex);
	const mappedActiveIndex = (() => {
		const byIdentity = findCleanupAccountIndexByIdentityKeys(normalized.accounts, existingActiveKeys);
		return byIdentity >= 0
			? byIdentity
			: Math.min(existing.activeIndex, Math.max(0, normalized.accounts.length - 1));
	})();
	const activeIndexByFamily = Object.fromEntries(
		Object.entries(existing.activeIndexByFamily ?? {}).map(([family, index]) => {
			const identityKeys = extractCleanupActiveKeys(existing.accounts, index);
			const mappedIndex = findCleanupAccountIndexByIdentityKeys(normalized.accounts, identityKeys);
			return [family, mappedIndex >= 0 ? mappedIndex : mappedActiveIndex];
		}),
	) as AccountStorageV3["activeIndexByFamily"];
	normalized.activeIndex = mappedActiveIndex;
	normalized.activeIndexByFamily = activeIndexByFamily;

	const after = normalized.accounts.length;
	const removed = Math.max(0, before - after);
	const originalAccountsByKey = new Map<string, AccountStorageV3["accounts"][number]>();
	for (const account of existing.accounts) {
		const key = toCleanupIdentityKeys(account)[0];
		if (key) {
			originalAccountsByKey.set(key, account);
		}
	}
	const updated = normalized.accounts.reduce((count, account) => {
		const key = toCleanupIdentityKeys(account)[0];
		if (!key) return count;
		const original = originalAccountsByKey.get(key);
		if (!original) return count;
		return accountsEqualForCleanup(original, account) ? count : count + 1;
	}, 0);
	const changed = removed > 0 || after !== before || !storagesEqualForCleanup(normalized, existing);

	return {
		result: {
			before,
			after,
			removed,
			updated,
		},
		nextStorage: changed ? normalized : undefined,
	};
}

function sourceExceedsCapacityWithoutLocalRelief(details: CodexMultiAuthSyncCapacityDetails): boolean {
	return (
		details.sourceDedupedTotal > details.maxAccounts &&
		details.importableNewAccounts === 0 &&
		details.suggestedRemovals.length === 0
	);
}

export function isCodexMultiAuthSourceTooLargeForCapacity(
	details: CodexMultiAuthSyncCapacityDetails,
): boolean {
	return sourceExceedsCapacityWithoutLocalRelief(details);
}

export function getCodexMultiAuthCapacityErrorMessage(
	details: CodexMultiAuthSyncCapacityDetails,
): string {
	if (sourceExceedsCapacityWithoutLocalRelief(details)) {
		return (
			`Sync source alone exceeds the maximum of ${details.maxAccounts} accounts ` +
			`(${details.sourceDedupedTotal} deduped source accounts). Reduce the source set or raise ${SYNC_MAX_ACCOUNTS_OVERRIDE_ENV}.`
		);
	}
	return (
		`Sync would exceed the maximum of ${details.maxAccounts} accounts ` +
		`(current ${details.currentCount}, source ${details.sourceCount}, deduped total ${details.dedupedTotal}). ` +
		`Remove at least ${details.needToRemove} account(s) before syncing.`
	);
}

export class CodexMultiAuthSyncCapacityError extends Error {
	readonly details: CodexMultiAuthSyncCapacityDetails;

	constructor(details: CodexMultiAuthSyncCapacityDetails) {
		super(getCodexMultiAuthCapacityErrorMessage(details));
		this.name = "CodexMultiAuthSyncCapacityError";
		this.details = details;
	}
}

export async function previewCodexMultiAuthSyncedOverlapCleanup(): Promise<CodexMultiAuthCleanupResult> {
	const current = await loadAccounts();
	return buildCodexMultiAuthOverlapCleanupPlan(current ?? createEmptyAccountStorage()).result;
}

export async function cleanupCodexMultiAuthSyncedOverlaps(
	backupPath?: string,
): Promise<CodexMultiAuthCleanupResult> {
	return withAccountStorageTransaction(async (current, persist) => {
		const fallback = current ?? {
			version: 3 as const,
			accounts: [],
			activeIndex: 0,
			activeIndexByFamily: {},
		};
		if (backupPath) {
			await fs.mkdir(dirname(backupPath), { recursive: true });
			const tempBackupPath = `${backupPath}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`;
			try {
				await fs.writeFile(tempBackupPath, `${JSON.stringify(fallback, null, 2)}\n`, {
					encoding: "utf-8",
					mode: 0o600,
				});
				await fs.rename(tempBackupPath, backupPath);
			} catch (error) {
				try {
					await fs.unlink(tempBackupPath);
				} catch {
					// Best effort temp-backup cleanup.
				}
				throw error;
			}
		}
		const plan = buildCodexMultiAuthOverlapCleanupPlan(fallback);
		if (plan.nextStorage) {
			await persist(plan.nextStorage);
		}
		return plan.result;
	});
}
