import { describe, expect, it } from "vitest";
import { createSyncPruneBackupPayload } from "../lib/sync-prune-backup.js";
import type { AccountStorageV3 } from "../lib/storage.js";

describe("sync prune backup payload", () => {
	it("omits live tokens from the prune backup payload", () => {
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

		expect(payload.accounts.accounts[0]).not.toHaveProperty("accessToken");
		expect(payload.accounts.accounts[0]).not.toHaveProperty("refreshToken");
		expect(payload.accounts.accounts[0]).not.toHaveProperty("idToken");
		expect(payload.flagged.accounts[0]).not.toHaveProperty("accessToken");
		expect(payload.flagged.accounts[0]).not.toHaveProperty("refreshToken");
		expect(payload.flagged.accounts[0]).not.toHaveProperty("idToken");
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

		const payload = createSyncPruneBackupPayload(storage, flagged);

		storage.accounts[0]!.accountTags?.push("mutated");
		storage.accounts[0]!.lastSelectedModelByFamily = { codex: "gpt-5.5" };
		flagged.accounts[0]!.metadata.source = "mutated";

		expect(payload.accounts.accounts[0]?.accountTags).toEqual(["work"]);
		expect(payload.accounts.accounts[0]?.lastSelectedModelByFamily).toEqual({ codex: "gpt-5.4" });
		expect(payload.accounts.accounts[0]).not.toHaveProperty("idToken");
		expect(payload.flagged.accounts[0]).toMatchObject({
			metadata: {
				source: "flagged",
			},
		});
		expect(payload.flagged.accounts[0]).not.toHaveProperty("refreshToken");
		expect(payload.flagged.accounts[0]).not.toHaveProperty("idToken");
	});
});
