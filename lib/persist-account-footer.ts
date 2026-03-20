import type { AccountIdSource } from "./types.js";

export const PERSIST_ACCOUNT_FOOTER_STYLES = [
	"label-masked-email",
	"full-email",
	"label-only",
] as const;

export type PersistAccountFooterStyle =
	(typeof PERSIST_ACCOUNT_FOOTER_STYLES)[number];

export type PersistedAccountDetails = {
	accountId?: string;
	accountIdSource?: AccountIdSource;
	accountLabel?: string;
	email?: string;
	access?: string;
	accessToken?: string;
};

export type SessionModelRef = {
	providerID: string;
	modelID: string;
};

export type PersistedAccountIndicatorEntry = {
	label: string;
	revision: number;
};
