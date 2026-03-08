import { existsSync, promises as fs } from "node:fs";
import { homedir } from "node:os";
import { join, win32 } from "node:path";
import { ACCOUNT_LIMITS } from "./constants.js";
import { logWarn } from "./logger.js";
import {
	deduplicateAccounts,
	deduplicateAccountsByEmail,
	getStoragePath,
	importAccounts,
	normalizeAccountStorage,
	previewImportAccounts,
	withAccountStorageTransaction,
	type AccountStorageV3,
	type ImportAccountsResult,
} from "./storage.js";
import { findProjectRoot, getProjectStorageKeyCandidates } from "./storage/paths.js";

const EXTERNAL_ROOT_SUFFIX = "multi-auth";
const EXTERNAL_ACCOUNT_FILE_NAMES = [
	"openai-codex-accounts.json",
	"codex-accounts.json",
];
const SYNC_ACCOUNT_TAG = "codex-multi-auth-sync";
const SYNC_MAX_ACCOUNTS_OVERRIDE_ENV = "CODEX_AUTH_SYNC_MAX_ACCOUNTS";

export interface CodexMultiAuthResolvedSource {
	rootDir: string;
	accountsPath: string;
	scope: "project" | "global";
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
	tempCleanupWarning?: string;
	tempCleanupPath?: string;
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
		isCurrentAccount: boolean;
		score: number;
		reason: string;
	}>;
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

const TEMP_CLEANUP_RETRY_DELAYS_MS = [100, 250, 500] as const;

function sleepAsync(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function removeNormalizedImportTempDir(
	tempDir: string,
	tempPath: string,
	options: NormalizedImportFileOptions,
): Promise<void> {
	let lastMessage = "unknown cleanup failure";
	for (let attempt = 0; attempt <= TEMP_CLEANUP_RETRY_DELAYS_MS.length; attempt += 1) {
		try {
			await fs.rm(tempDir, { recursive: true, force: true });
			return;
		} catch (cleanupError) {
			lastMessage = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
			if (attempt < TEMP_CLEANUP_RETRY_DELAYS_MS.length) {
				await sleepAsync(TEMP_CLEANUP_RETRY_DELAYS_MS[attempt] ?? 0);
				continue;
			}
		}
	}

	logWarn(`Failed to remove temporary codex sync directory ${tempDir}: ${lastMessage}`);
	options.onPostSuccessCleanupFailure?.({ tempDir, tempPath, message: lastMessage });
	if (options.postSuccessCleanupFailureMode !== "warn") {
		throw new Error(`Failed to remove temporary codex sync directory ${tempDir}: ${lastMessage}`);
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
		await fs.writeFile(tempPath, `${JSON.stringify(storage, null, 2)}\n`, {
			encoding: "utf-8",
			mode: 0o600,
			flag: "wx",
		});
		let result: T;
		try {
			result = await handler(tempPath);
		} catch (error) {
			try {
				await removeNormalizedImportTempDir(tempDir, tempPath, { postSuccessCleanupFailureMode: "warn" });
			} catch (cleanupError) {
				const message = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
				logWarn(`Failed to remove temporary codex sync directory ${tempDir}: ${message}`);
			}
			throw error;
		}
		await removeNormalizedImportTempDir(tempDir, tempPath, options);
		return result;
	};

	const secureTempRoot = join(getResolvedUserHomeDir(), ".opencode", "tmp");
	await fs.mkdir(secureTempRoot, { recursive: true, mode: 0o700 });
	const tempDir = await fs.mkdtemp(join(secureTempRoot, "oc-chatgpt-multi-auth-sync-"));
	return runWithTempDir(tempDir);
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
		const refreshToken = normalizeIdentity(account.refreshToken);
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
			const normalizedEmail = normalizeIdentity(account.email);
			if (normalizedEmail && existingState.emails.has(normalizedEmail)) {
				return false;
			}
			const organizationId = normalizeIdentity(account.organizationId);
			if (organizationId) {
				return !existingState.organizationIds.has(organizationId);
			}
			const accountId = normalizeIdentity(account.accountId);
			if (accountId) {
				return !existingState.accountIds.has(accountId);
			}
			const refreshToken = normalizeIdentity(account.refreshToken);
			if (refreshToken && existingState.refreshTokens.has(refreshToken)) {
				return false;
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
		.map(({ index, email, accountLabel, isCurrentAccount, score, reason }) => ({
			index,
			email,
			accountLabel,
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
	const refreshToken = normalizeIdentity(account.refreshToken);
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
		if (organizationId) identities.add(`org:${organizationId}`);
		if (accountId) identities.add(`account:${accountId}`);
		if (email) identities.add(`email:${email}`);
	}
	return identities;
}

function accountMatchesSource(account: AccountStorageV3["accounts"][number], sourceIdentities: Set<string>): boolean {
	const organizationId = normalizeIdentity(account.organizationId);
	const accountId = normalizeIdentity(account.accountId);
	const email = normalizeIdentity(account.email);
	return (
		(organizationId ? sourceIdentities.has(`org:${organizationId}`) : false) ||
		(accountId ? sourceIdentities.has(`account:${accountId}`) : false) ||
		(email ? sourceIdentities.has(`email:${email}`) : false)
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

function hasAccountsStorage(dir: string): boolean {
	return EXTERNAL_ACCOUNT_FILE_NAMES.some((fileName) => {
		return existsSync(join(dir, fileName));
	});
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
		if (normalized.startsWith("\\\\") || normalized.startsWith("\\?\\") || normalized.startsWith("\\.\\")) {
			throw new Error("CODEX_MULTI_AUTH_DIR must use a local absolute path on Windows");
		}
		if (!/^[a-zA-Z]:\\/.test(normalized)) {
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

	for (const candidateKey of getProjectStorageKeyCandidates(projectRoot)) {
		for (const fileName of EXTERNAL_ACCOUNT_FILE_NAMES) {
			const candidate = join(rootDir, "projects", candidateKey, fileName);
			if (existsSync(candidate)) {
				return candidate;
			}
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
	const rootDir = getCodexMultiAuthSourceRootDir();
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

	throw new Error(
		`No codex-multi-auth accounts file found under ${rootDir}`,
	);
}

function getSyncCapacityLimit(): number {
	const override = (process.env[SYNC_MAX_ACCOUNTS_OVERRIDE_ENV] ?? "").trim();
	if (override.length === 0) {
		return ACCOUNT_LIMITS.MAX_ACCOUNTS;
	}
	const parsed = Number(override);
	if (Number.isFinite(parsed) && parsed >= 0) {
		return parsed;
	}
	return ACCOUNT_LIMITS.MAX_ACCOUNTS;
}

export async function loadCodexMultiAuthSourceStorage(
	projectPath = process.cwd(),
): Promise<CodexMultiAuthResolvedSource & { storage: AccountStorageV3 }> {
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

async function loadPreparedCodexMultiAuthSourceStorage(
	projectPath = process.cwd(),
): Promise<CodexMultiAuthResolvedSource & { storage: AccountStorageV3 }> {
	const resolved = await loadCodexMultiAuthSourceStorage(projectPath);
	const currentStorage = await withAccountStorageTransaction((current) => Promise.resolve(current));
	const preparedStorage = filterSourceAccountsAgainstExistingEmails(
		resolved.storage,
		currentStorage?.accounts ?? [],
	);
	return {
		...resolved,
		storage: preparedStorage,
	};
}

export async function previewSyncFromCodexMultiAuth(
	projectPath = process.cwd(),
): Promise<CodexMultiAuthSyncPreview> {
	const resolved = await loadPreparedCodexMultiAuthSourceStorage(projectPath);
	await assertSyncWithinCapacity(resolved);
	const preview = await withNormalizedImportFile(
		resolved.storage,
		(filePath) => previewImportAccounts(filePath),
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
): Promise<CodexMultiAuthSyncResult> {
	const resolved = await loadPreparedCodexMultiAuthSourceStorage(projectPath);
	await assertSyncWithinCapacity(resolved);
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
	const normalized = {
		...existing,
		accounts: [...preservedAccounts, ...normalizedSyncedStorage.accounts],
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
		const key = account.organizationId ?? account.accountId ?? account.refreshToken;
		if (key) {
			originalAccountsByKey.set(key, account);
		}
	}
	const updated = normalized.accounts.reduce((count, account) => {
		const key = account.organizationId ?? account.accountId ?? account.refreshToken;
		if (!key) return count;
		const original = originalAccountsByKey.get(key);
		if (!original) return count;
		return JSON.stringify(original) === JSON.stringify(account) ? count : count + 1;
	}, 0);
	const changed =
		removed > 0 || after !== before || JSON.stringify(normalized) !== JSON.stringify(existing);

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

function normalizeOverlapCleanupSourceStorage(data: unknown): AccountStorageV3 | null {
	if (
		!data ||
		typeof data !== "object" ||
		!("version" in data) ||
		!((data as { version?: unknown }).version === 1 || (data as { version?: unknown }).version === 3) ||
		!("accounts" in data) ||
		!Array.isArray((data as { accounts?: unknown }).accounts)
	) {
		return null;
	}

	const record = data as {
		accounts: unknown[];
		activeIndex?: unknown;
		activeIndexByFamily?: unknown;
	};
	const accounts = record.accounts.filter((account): account is AccountStorageV3["accounts"][number] => {
		return (
			typeof account === "object" &&
			account !== null &&
			typeof (account as { refreshToken?: unknown }).refreshToken === "string" &&
			(account as { refreshToken: string }).refreshToken.trim().length > 0
		);
	});
	const activeIndexValue =
		typeof record.activeIndex === "number" && Number.isFinite(record.activeIndex)
			? record.activeIndex
			: 0;
	const activeIndex = Math.max(0, Math.min(accounts.length - 1, activeIndexValue));
	const rawActiveIndexByFamily =
		record.activeIndexByFamily && typeof record.activeIndexByFamily === "object"
			? record.activeIndexByFamily
			: {};
	const activeIndexByFamily = Object.fromEntries(
		Object.entries(rawActiveIndexByFamily).flatMap(([family, value]) => {
			if (typeof value !== "number" || !Number.isFinite(value)) {
				return [];
			}
			return [[family, Math.max(0, Math.min(accounts.length - 1, value))]];
		}),
	) as AccountStorageV3["activeIndexByFamily"];

	return {
		version: 3,
		accounts,
		activeIndex: accounts.length === 0 ? 0 : activeIndex,
		activeIndexByFamily,
	};
}

async function loadRawCodexMultiAuthOverlapCleanupStorage(
	fallback: AccountStorageV3,
): Promise<AccountStorageV3> {
	try {
		const raw = await fs.readFile(getStoragePath(), "utf-8");
		const parsed = JSON.parse(raw) as unknown;
		const normalized = normalizeOverlapCleanupSourceStorage(parsed);
		if (normalized) {
			return normalized;
		}
		throw new Error("Invalid raw storage snapshot for synced overlap cleanup.");
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code === "ENOENT") {
			return fallback;
		}
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`Failed to read raw storage snapshot for synced overlap cleanup: ${message}`);
	}
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
	return withAccountStorageTransaction(async (current) => {
		const fallback = current ?? {
			version: 3 as const,
			accounts: [],
			activeIndex: 0,
			activeIndexByFamily: {},
		};
		const existing = await loadRawCodexMultiAuthOverlapCleanupStorage(fallback);
		return buildCodexMultiAuthOverlapCleanupPlan(existing).result;
	});
}

export async function cleanupCodexMultiAuthSyncedOverlaps(): Promise<CodexMultiAuthCleanupResult> {
	return withAccountStorageTransaction(async (current, persist) => {
		const fallback = current ?? {
			version: 3 as const,
			accounts: [],
			activeIndex: 0,
			activeIndexByFamily: {},
		};
		const existing = await loadRawCodexMultiAuthOverlapCleanupStorage(fallback);
		const plan = buildCodexMultiAuthOverlapCleanupPlan(existing);
		if (plan.nextStorage) {
			await persist(plan.nextStorage);
		}
		return plan.result;
	});
}

async function assertSyncWithinCapacity(
	resolved: CodexMultiAuthResolvedSource & { storage: AccountStorageV3 },
): Promise<void> {
	// Unlimited remains the default, but a finite override keeps the sync prune/capacity
	// path testable and available for operators who intentionally enforce a soft cap.
	const maxAccounts = getSyncCapacityLimit();
	if (!Number.isFinite(maxAccounts)) {
		return;
	}
	const details = await withAccountStorageTransaction<CodexMultiAuthSyncCapacityDetails | null>((current) => {
		const existing = current ?? {
			version: 3 as const,
			accounts: [],
			activeIndex: 0,
			activeIndexByFamily: {},
		};
		return Promise.resolve(computeSyncCapacityDetails(resolved, resolved.storage, existing, maxAccounts));
	});

	if (details) {
		throw new CodexMultiAuthSyncCapacityError(details);
	}
}
