import type { AccountStorageV3 } from "./storage.js";

type FlaggedSnapshot<TAccount extends object> = {
	version: 1;
	accounts: TAccount[];
};

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
		accounts: structuredClone({
			...currentAccountsStorage,
			activeIndexByFamily: { ...(currentAccountsStorage.activeIndexByFamily ?? {}) },
		}),
		flagged: structuredClone({
			...currentFlaggedStorage,
		}),
	};
}
