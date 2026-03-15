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
	// Intentionally retain live tokens so a mid-sync crash can fully restore pruned accounts.
	// The backup is stored under the user's config home; on Windows its ACLs are the real boundary
	// because the later write path's `mode: 0o600` hint is not strictly enforced there.
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
