import type { AccountStorageV3 } from "./storage.js";

type FlaggedSnapshot<TAccount extends object> = {
	version: 1;
	accounts: TAccount[];
};

type SyncPruneBackupPayloadOptions = {
	includeLiveTokens?: boolean;
};

type TokenBearingRecord = {
	refreshToken?: string;
	accessToken?: string;
	idToken?: string;
};

type ReplaceTokenField<
	TAccount extends object,
	TKey extends keyof TokenBearingRecord,
	TValue,
> = TKey extends keyof TAccount
	? undefined extends TAccount[TKey]
		? Omit<TAccount, TKey> & { [K in TKey]?: TValue }
		: Omit<TAccount, TKey> & { [K in TKey]: TValue }
	: TAccount;

export type TokenRedacted<TAccount extends object> = ReplaceTokenField<
	ReplaceTokenField<ReplaceTokenField<TAccount, "refreshToken", "__redacted__">, "accessToken", undefined>,
	"idToken",
	undefined
>;

type RedactedAccountStorage = Omit<AccountStorageV3, "accounts"> & {
	accounts: Array<TokenRedacted<AccountStorageV3["accounts"][number]>>;
};

type SyncPruneBackupPayload<TAccountsStorage extends AccountStorageV3, TFlaggedAccount extends object> = {
	version: 1;
	accounts: TAccountsStorage;
	flagged: FlaggedSnapshot<TFlaggedAccount>;
};

function redactCredentialRecord<TAccount extends object>(account: TAccount): TokenRedacted<TAccount> {
	const clone = structuredClone(account) as TAccount & TokenBearingRecord;
	if (typeof clone.refreshToken === "string") {
		clone.refreshToken = "__redacted__";
	}
	if ("accessToken" in clone) {
		clone.accessToken = undefined;
	}
	if ("idToken" in clone) {
		clone.idToken = undefined;
	}
	return clone as TokenRedacted<TAccount>;
}

export function createSyncPruneBackupPayload<TFlaggedAccount extends object>(
	currentAccountsStorage: AccountStorageV3,
	currentFlaggedStorage: FlaggedSnapshot<TFlaggedAccount>,
	options?: { includeLiveTokens?: false | undefined },
): SyncPruneBackupPayload<RedactedAccountStorage, TokenRedacted<TFlaggedAccount>>;
export function createSyncPruneBackupPayload<TFlaggedAccount extends object>(
	currentAccountsStorage: AccountStorageV3,
	currentFlaggedStorage: FlaggedSnapshot<TFlaggedAccount>,
	options: { includeLiveTokens: true },
): SyncPruneBackupPayload<AccountStorageV3, TFlaggedAccount>;
export function createSyncPruneBackupPayload<TFlaggedAccount extends object>(
	currentAccountsStorage: AccountStorageV3,
	currentFlaggedStorage: FlaggedSnapshot<TFlaggedAccount>,
	options: SyncPruneBackupPayloadOptions = {},
):
	| SyncPruneBackupPayload<RedactedAccountStorage, TokenRedacted<TFlaggedAccount>>
	| SyncPruneBackupPayload<AccountStorageV3, TFlaggedAccount> {
	const accounts = structuredClone(currentAccountsStorage);
	const flagged = structuredClone(currentFlaggedStorage);
	if (options.includeLiveTokens) {
		return {
			version: 1,
			accounts,
			flagged,
		};
	}

	const redactedAccounts: RedactedAccountStorage = {
		...accounts,
		accounts: accounts.accounts.map((account) => redactCredentialRecord(account)),
	};
	const redactedFlagged: FlaggedSnapshot<TokenRedacted<TFlaggedAccount>> = {
		...flagged,
		accounts: flagged.accounts.map((account) => redactCredentialRecord(account)),
	};

	// Callers opt into live tokens only when crash recovery must fully restore pruned accounts.
	// On Windows the eventual file write still relies on config-home ACLs because `mode: 0o600`
	// is only a best-effort hint there.
	return {
		version: 1,
		accounts: redactedAccounts,
		flagged: redactedFlagged,
	};
}
