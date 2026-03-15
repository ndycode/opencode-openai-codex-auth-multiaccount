import { describe, expect, it } from "vitest";
import { createSyncPruneBackupPayload } from "../lib/sync-prune-backup.js";
import type { AccountStorageV3 } from "../lib/storage.js";

describe("sync prune backup payload", () => {
	it("redacts live tokens by default", () => {
		const storage: AccountStorageV3 = {
			version: 3,
			activeIndex: 0,
			activeIndexByFamily: {},
			accounts: [
				{
					accountId: "org-sync",
					organizationId: "org-sync",
					accountIdSource: "org",
					refreshToken: "refresh-token",
					accessToken: "access-token",
					idToken: "id-token",
					addedAt: 1,
					lastUsed: 1,
				},
			],
		};
		const payload = createSyncPruneBackupPayload(storage, {
			version: 1,
			accounts: [
				{
					refreshToken: "refresh-token",
					accessToken: "flagged-access-token",
					idToken: "flagged-id-token",
				},
			],
		});

		expect(payload.accounts.accounts[0]).toMatchObject({
			refreshToken: "__redacted__",
			accessToken: undefined,
			idToken: undefined,
		});
		expect(payload.flagged.accounts[0]).toMatchObject({
			refreshToken: "__redacted__",
			accessToken: undefined,
			idToken: undefined,
		});
	});

	it("keeps live tokens when explicitly requested for crash recovery", () => {
		const storage: AccountStorageV3 = {
			version: 3,
			activeIndex: 0,
			activeIndexByFamily: {},
			accounts: [
				{
					accountId: "org-sync",
					organizationId: "org-sync",
					accountIdSource: "org",
					refreshToken: "refresh-token",
					accessToken: "access-token",
					idToken: "id-token",
					addedAt: 1,
					lastUsed: 1,
				},
			],
		};
		const payload = createSyncPruneBackupPayload(
			storage,
			{
				version: 1,
				accounts: [
					{
						refreshToken: "refresh-token",
						accessToken: "flagged-access-token",
						idToken: "flagged-id-token",
					},
				],
			},
			{ includeLiveTokens: true },
		);

		expect(payload.accounts.accounts[0]).toMatchObject({
			refreshToken: "refresh-token",
			accessToken: "access-token",
			idToken: "id-token",
		});
		expect(payload.flagged.accounts[0]).toMatchObject({
			refreshToken: "refresh-token",
			accessToken: "flagged-access-token",
			idToken: "flagged-id-token",
		});
	});

	it("deep-clones nested metadata so later mutations do not leak into the snapshot", () => {
		const storage: AccountStorageV3 = {
			version: 3,
			activeIndex: 0,
			activeIndexByFamily: {},
			accounts: [
				{
					accountId: "org-sync",
					organizationId: "org-sync",
					accountIdSource: "org",
					refreshToken: "refresh-token",
					accessToken: "access-token",
					idToken: "id-token",
					accountTags: ["work"],
					addedAt: 1,
					lastUsed: 1,
					lastSelectedModelByFamily: {
						codex: "gpt-5.4",
					},
				},
			],
		};
		const flagged = {
			version: 1 as const,
			accounts: [
				{
					refreshToken: "refresh-token",
					accessToken: "flagged-access-token",
					idToken: "flagged-id-token",
					metadata: {
						source: "flagged",
					},
				},
			],
		};

		const payload = createSyncPruneBackupPayload(storage, flagged, { includeLiveTokens: true });

		storage.accounts[0]!.accountTags?.push("mutated");
		storage.accounts[0]!.lastSelectedModelByFamily!.codex = "gpt-5.5";
		flagged.accounts[0]!.metadata.source = "mutated";

		expect(payload.accounts.accounts[0]?.accountTags).toEqual(["work"]);
		expect(payload.accounts.accounts[0]?.lastSelectedModelByFamily).toEqual({ codex: "gpt-5.4" });
		expect(payload.accounts.accounts[0]?.refreshToken).toBe("refresh-token");
		expect(payload.accounts.accounts[0]?.accessToken).toBe("access-token");
		expect(payload.accounts.accounts[0]?.idToken).toBe("id-token");
		expect(payload.flagged.accounts[0]).toMatchObject({
			refreshToken: "refresh-token",
			accessToken: "flagged-access-token",
			idToken: "flagged-id-token",
			metadata: {
				source: "flagged",
			},
		});
	});
});
