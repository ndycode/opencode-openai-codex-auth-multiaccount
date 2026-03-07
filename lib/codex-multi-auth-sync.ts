import { existsSync, readFileSync, promises as fs } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, win32 } from "node:path";
import { ACCOUNT_LIMITS } from "./constants.js";
import {
	deduplicateAccounts,
	deduplicateAccountsByEmail,
	importAccounts,
	normalizeAccountStorage,
	previewImportAccounts,
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

export class CodexMultiAuthSyncCapacityError extends Error {
	readonly details: CodexMultiAuthSyncCapacityDetails;

	constructor(details: CodexMultiAuthSyncCapacityDetails) {
		super(
			`Sync would exceed the maximum of ${details.maxAccounts} accounts ` +
				`(current ${details.currentCount}, source ${details.sourceCount}, deduped total ${details.dedupedTotal}). ` +
				`Remove at least ${details.needToRemove} account(s) before syncing.`,
		);
		this.name = "CodexMultiAuthSyncCapacityError";
		this.details = details;
	}
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

async function withNormalizedImportFile<T>(
	storage: AccountStorageV3,
	handler: (filePath: string) => Promise<T>,
): Promise<T> {
	try {
		const secureTempRoot = join(getResolvedUserHomeDir(), ".opencode", "tmp");
		await fs.mkdir(secureTempRoot, { recursive: true, mode: 0o700 }).catch(() => undefined);
		const tempDir = await fs.mkdtemp(join(secureTempRoot, "oc-chatgpt-multi-auth-sync-"));
		await fs.chmod(tempDir, 0o700).catch(() => undefined);
		const tempPath = join(tempDir, "accounts.json");
		await fs.writeFile(tempPath, `${JSON.stringify(storage, null, 2)}\n`, {
			encoding: "utf-8",
			mode: 0o600,
			flag: "wx",
		});
		try {
			return await handler(tempPath);
		} finally {
			await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
		}
	} catch {
		// fall back to the process temp directory if the secure path is unavailable
	}

	const tempDir = await fs.mkdtemp(join(tmpdir(), "oc-chatgpt-multi-auth-sync-"));
	try {
		await fs.chmod(tempDir, 0o700).catch(() => undefined);
		const tempPath = join(tempDir, "accounts.json");
		await fs.writeFile(tempPath, `${JSON.stringify(storage, null, 2)}\n`, {
			encoding: "utf-8",
			mode: 0o600,
			flag: "wx",
		});
		return await handler(tempPath);
	} finally {
		await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
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
	const deduplicated: AccountStorageV3["accounts"] = [];
	const emailToIndex = new Map<string, number>();

	for (const account of accounts) {
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

function filterSourceAccountsAgainstExistingEmails(
	sourceStorage: AccountStorageV3,
	existingAccounts: AccountStorageV3["accounts"],
): AccountStorageV3 {
	const existingEmails = new Set(
		existingAccounts
			.map((account) => normalizeIdentity(account.email))
			.filter((email): email is string => typeof email === "string" && email.length > 0),
	);

	return {
		...sourceStorage,
		accounts: deduplicateSourceAccountsByEmail(sourceStorage.accounts).filter((account) => {
			const normalizedEmail = normalizeIdentity(account.email);
			if (!normalizedEmail) return true;
			return !existingEmails.has(normalizedEmail);
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

function normalizeIdentity(value: string | undefined): string | undefined {
	const trimmed = value?.trim();
	return trimmed && trimmed.length > 0 ? trimmed.toLowerCase() : undefined;
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

export function getCodexMultiAuthSourceRootDir(): string {
	const fromEnv = (process.env.CODEX_MULTI_AUTH_DIR ?? "").trim();
	if (fromEnv.length > 0) {
		return fromEnv;
	}

	const userHome = getResolvedUserHomeDir();
	const primary = join(getCodexHomeDir(), EXTERNAL_ROOT_SUFFIX);
	const candidates = deduplicatePaths([
		primary,
		join(userHome, "DevTools", "config", "codex", EXTERNAL_ROOT_SUFFIX),
		join(userHome, ".codex", EXTERNAL_ROOT_SUFFIX),
	]);

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

	return primary;
}

function getProjectScopedAccountsPath(rootDir: string, projectPath: string): string | undefined {
	const projectRoot = findProjectRoot(projectPath);
	if (!projectRoot) {
		return undefined;
	}

	const projectKey = getProjectStorageKey(projectRoot);
	for (const fileName of EXTERNAL_ACCOUNT_FILE_NAMES) {
		const candidate = join(rootDir, "projects", projectKey, fileName);
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

export function loadCodexMultiAuthSourceStorage(
	projectPath = process.cwd(),
): CodexMultiAuthResolvedSource & { storage: AccountStorageV3 } {
	const resolved = resolveCodexMultiAuthAccountsSource(projectPath);
	const raw = readFileSync(resolved.accountsPath, "utf-8");
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
	const resolved = loadCodexMultiAuthSourceStorage(projectPath);
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
	const currentStorage = await withAccountStorageTransaction((current) => Promise.resolve(current));
	const finalStorage = filterSourceAccountsAgainstExistingEmails(
		resolved.storage,
		currentStorage?.accounts ?? [],
	);
	let result: ImportAccountsResult;
	try {
		result = await withNormalizedImportFile(
			finalStorage,
			(filePath) =>
				importAccounts(
					filePath,
					{
						preImportBackupPrefix: "codex-multi-auth-sync-backup",
						backupMode: "required",
					},
					(normalizedStorage, existing) =>
						filterSourceAccountsAgainstExistingEmails(
							normalizedStorage,
							existing?.accounts ?? [],
						),
				),
		);
	} catch (error) {
		if (
			error instanceof CodexMultiAuthSyncCapacityError ||
			(error instanceof Error && /exceed(?: the)? maximum/i.test(error.message))
		) {
			await assertSyncWithinCapacity(resolved);
		}
		throw error;
	}
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

export async function cleanupCodexMultiAuthSyncedOverlaps(): Promise<CodexMultiAuthCleanupResult> {
	return withAccountStorageTransaction(async (current, persist) => {
		const existing = current ?? {
			version: 3 as const,
			accounts: [],
			activeIndex: 0,
			activeIndexByFamily: {},
		};
		const before = existing.accounts.length;
		const normalized = normalizeAccountStorage(normalizeSourceStorage(existing));
		if (!normalized) {
			return {
				before,
				after: before,
				removed: 0,
				updated: 0,
			};
		}

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

		if (removed > 0 || after !== before || JSON.stringify(normalized) !== JSON.stringify(existing)) {
			await persist(normalized);
		}

		return {
			before,
			after,
			removed,
			updated,
		};
	});
}

async function assertSyncWithinCapacity(
	resolved: CodexMultiAuthResolvedSource & { storage: AccountStorageV3 },
): Promise<void> {
	if (!Number.isFinite(ACCOUNT_LIMITS.MAX_ACCOUNTS)) {
		return;
	}
	const details = await withAccountStorageTransaction<CodexMultiAuthSyncCapacityDetails | null>((current) => {
		const existing = current ?? {
			version: 3 as const,
			accounts: [],
			activeIndex: 0,
			activeIndexByFamily: {},
		};
		const sourceDedupedTotal = buildMergedDedupedAccounts([], resolved.storage.accounts).length;
		const mergedAccounts = buildMergedDedupedAccounts(existing.accounts, resolved.storage.accounts);
		if (mergedAccounts.length <= ACCOUNT_LIMITS.MAX_ACCOUNTS) {
			return Promise.resolve(null);
		}

		const currentCount = existing.accounts.length;
		const sourceCount = resolved.storage.accounts.length;
		const dedupedTotal = mergedAccounts.length;
		const importableNewAccounts = Math.max(0, dedupedTotal - currentCount);
		const skippedOverlaps = Math.max(0, sourceCount - importableNewAccounts);
		if (sourceDedupedTotal > ACCOUNT_LIMITS.MAX_ACCOUNTS) {
			return Promise.resolve({
				rootDir: resolved.rootDir,
				accountsPath: resolved.accountsPath,
				scope: resolved.scope,
				currentCount,
				sourceCount,
				sourceDedupedTotal,
				dedupedTotal: sourceDedupedTotal,
				maxAccounts: ACCOUNT_LIMITS.MAX_ACCOUNTS,
				needToRemove: sourceDedupedTotal - ACCOUNT_LIMITS.MAX_ACCOUNTS,
				importableNewAccounts: sourceDedupedTotal,
				skippedOverlaps: Math.max(0, sourceCount - sourceDedupedTotal),
				suggestedRemovals: [],
			} satisfies CodexMultiAuthSyncCapacityDetails);
		}
		const sourceIdentities = buildSourceIdentitySet(resolved.storage);
		const suggestedRemovals = existing.accounts
			.map((account, index) => {
				const matchesSource = accountMatchesSource(account, sourceIdentities);
				const isCurrentAccount = index === existing.activeIndex;
				const hypotheticalAccounts = existing.accounts.filter((_, candidateIndex) => candidateIndex !== index);
				const hypotheticalTotal = buildMergedDedupedAccounts(hypotheticalAccounts, resolved.storage.accounts).length;
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
			.slice(0, Math.max(5, dedupedTotal - ACCOUNT_LIMITS.MAX_ACCOUNTS))
			.map(({ index, email, accountLabel, isCurrentAccount, score, reason }) => ({
				index,
				email,
				accountLabel,
				isCurrentAccount,
				score,
				reason,
			}));

		return Promise.resolve({
			rootDir: resolved.rootDir,
			accountsPath: resolved.accountsPath,
			scope: resolved.scope,
			currentCount,
			sourceCount,
			sourceDedupedTotal,
			dedupedTotal,
			maxAccounts: ACCOUNT_LIMITS.MAX_ACCOUNTS,
			needToRemove: dedupedTotal - ACCOUNT_LIMITS.MAX_ACCOUNTS,
			importableNewAccounts,
			skippedOverlaps,
			suggestedRemovals,
		} satisfies CodexMultiAuthSyncCapacityDetails);
	});

	if (details) {
		throw new CodexMultiAuthSyncCapacityError(details);
	}
}
