import { afterEach, describe, expect, it } from "vitest";
import {
	clearAccounts,
	getAccountStorageAdapterId,
	loadAccounts,
	saveAccounts,
	setAccountStorageAdapter,
	setStoragePathDirect,
	withAccountStorageTransaction,
	type AccountStorageAdapter,
	type AccountStorageV3,
} from "../lib/storage.js";

function cloneStorage(storage: AccountStorageV3): AccountStorageV3 {
	return JSON.parse(JSON.stringify(storage)) as AccountStorageV3;
}

describe("account storage adapter boundary", () => {
	afterEach(() => {
		setAccountStorageAdapter(null);
		setStoragePathDirect(null);
	});

	it("routes load/save/clear through a custom adapter", async () => {
		setStoragePathDirect("C:\\virtual\\accounts.json");

		const state = new Map<string, AccountStorageV3>();
		const calls = { load: 0, save: 0, clear: 0 };
		const adapter: AccountStorageAdapter = {
			id: "memory",
			load: async (path) => {
				calls.load++;
				const snapshot = state.get(path);
				return snapshot ? cloneStorage(snapshot) : null;
			},
			save: async (path, storage) => {
				calls.save++;
				state.set(path, cloneStorage(storage));
			},
			clear: async (path) => {
				calls.clear++;
				state.delete(path);
			},
		};
		setAccountStorageAdapter(adapter);

		expect(getAccountStorageAdapterId()).toBe("memory");
		await expect(loadAccounts()).resolves.toBeNull();

		await saveAccounts({
			version: 3,
			activeIndex: 0,
			accounts: [
				{
					accountId: "acct-1",
					refreshToken: "refresh-1",
					addedAt: 1,
					lastUsed: 1,
				},
			],
		});

		const loaded = await loadAccounts();
		expect(loaded?.accounts).toHaveLength(1);
		expect(loaded?.accounts[0]?.accountId).toBe("acct-1");

		await clearAccounts();
		await expect(loadAccounts()).resolves.toBeNull();
		expect(calls.save).toBe(1);
		expect(calls.clear).toBe(1);
		expect(calls.load).toBeGreaterThanOrEqual(3);
	});

	it("uses custom adapter persistence inside transactions", async () => {
		setStoragePathDirect("C:\\virtual\\transaction.json");

		const state = new Map<string, AccountStorageV3>();
		const adapter: AccountStorageAdapter = {
			id: "memory",
			load: async (path) => {
				const snapshot = state.get(path);
				return snapshot ? cloneStorage(snapshot) : null;
			},
			save: async (path, storage) => {
				state.set(path, cloneStorage(storage));
			},
			clear: async (path) => {
				state.delete(path);
			},
		};
		setAccountStorageAdapter(adapter);

		await withAccountStorageTransaction(async (current, persist) => {
			expect(current).toBeNull();
			await persist({
				version: 3,
				activeIndex: 0,
				accounts: [
					{
						accountId: "acct-transaction",
						refreshToken: "refresh-transaction",
						addedAt: 10,
						lastUsed: 20,
					},
				],
			});
			return undefined;
		});

		const loaded = await loadAccounts();
		expect(loaded?.accounts[0]?.accountId).toBe("acct-transaction");
	});
});
