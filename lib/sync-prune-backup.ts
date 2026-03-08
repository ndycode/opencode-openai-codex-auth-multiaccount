import type { AccountStorageV3 } from "./storage.js";

type FlaggedSnapshot<TAccount extends object> = {
	version: 1;
	accounts: TAccount[];
};

function cloneWithoutAccessToken<TAccount extends object>(account: TAccount): TAccount {
	const clone = structuredClone(account) as TAccount & { accessToken?: unknown };
	delete clone.accessToken;
	return clone as TAccount;
}

export function createSyncPruneBackupPayload<TFlaggedAccount extends object>(
	currentAccountsStorage: AccountStorageV3,
	currentFlaggedStorage: FlaggedSnapshot<TFlaggedAccount>,
): {
	version: 1;
	accounts: AccountStorageV3;
	flagged: FlaggedSnapshot<TFlaggedAccount>;
} {
	return {
		version: 1,
		accounts: {
			...currentAccountsStorage,
			accounts: currentAccountsStorage.accounts.map((account) => cloneWithoutAccessToken(account)),
			activeIndexByFamily: { ...(currentAccountsStorage.activeIndexByFamily ?? {}) },
		},
		flagged: {
			...currentFlaggedStorage,
			accounts: currentFlaggedStorage.accounts.map((flagged) => cloneWithoutAccessToken(flagged)),
		},
	};
}
