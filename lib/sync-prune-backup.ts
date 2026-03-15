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

function redactCredentialRecord<TAccount extends object>(account: TAccount): TAccount {
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
	return clone;
}

export function createSyncPruneBackupPayload<TFlaggedAccount extends object>(
	currentAccountsStorage: AccountStorageV3,
	currentFlaggedStorage: FlaggedSnapshot<TFlaggedAccount>,
	options: SyncPruneBackupPayloadOptions = {},
): {
	version: 1;
	accounts: AccountStorageV3;
	flagged: FlaggedSnapshot<TFlaggedAccount>;
} {
	const accounts = structuredClone(currentAccountsStorage);
	const flagged = structuredClone(currentFlaggedStorage);
	if (!options.includeLiveTokens) {
		accounts.accounts = accounts.accounts.map((account) => redactCredentialRecord(account));
		flagged.accounts = flagged.accounts.map((account) => redactCredentialRecord(account));
	}
	// Callers opt into live tokens only when crash recovery must fully restore pruned accounts.
	// On Windows the eventual file write still relies on config-home ACLs because `mode: 0o600`
	// is only a best-effort hint there.
	return {
		version: 1,
		accounts,
		flagged,
	};
}
