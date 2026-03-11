import type { AccountStorageV3 } from "./storage.js";

type FlaggedSnapshot<TAccount extends object> = {
	version: 1;
	accounts: TAccount[];
};

type TokenRedacted<TAccount extends object> =
	Omit<TAccount, "accessToken" | "refreshToken" | "idToken"> & {
		accessToken?: undefined;
		refreshToken?: undefined;
		idToken?: undefined;
	};

function cloneWithoutTokens<TAccount extends object>(account: TAccount): TokenRedacted<TAccount> {
	const clone = structuredClone(account) as TokenRedacted<TAccount>;
	delete clone.accessToken;
	delete clone.refreshToken;
	delete clone.idToken;
	return clone;
}

export function createSyncPruneBackupPayload<TFlaggedAccount extends object>(
	currentAccountsStorage: AccountStorageV3,
	currentFlaggedStorage: FlaggedSnapshot<TFlaggedAccount>,
): {
	version: 1;
	accounts: Omit<AccountStorageV3, "accounts"> & {
		accounts: Array<TokenRedacted<AccountStorageV3["accounts"][number]>>;
	};
	flagged: FlaggedSnapshot<TokenRedacted<TFlaggedAccount>>;
} {
	return {
		version: 1,
		accounts: {
			...currentAccountsStorage,
			accounts: currentAccountsStorage.accounts.map((account) => cloneWithoutTokens(account)),
			activeIndexByFamily: { ...(currentAccountsStorage.activeIndexByFamily ?? {}) },
		},
		flagged: {
			...currentFlaggedStorage,
			accounts: currentFlaggedStorage.accounts.map((flagged) => cloneWithoutTokens(flagged)),
		},
	};
}
