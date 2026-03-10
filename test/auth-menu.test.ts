import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	showAuthMenu,
	showAccountDetails,
	showSettingsMenu,
	showSyncPruneMenu,
	type AccountInfo,
} from "../lib/ui/auth-menu.js";
import { setUiRuntimeOptions, resetUiRuntimeOptions } from "../lib/ui/runtime.js";
import { select } from "../lib/ui/select.js";
import { confirm } from "../lib/ui/confirm.js";

vi.mock("../lib/ui/select.js", () => ({
	select: vi.fn(),
}));

vi.mock("../lib/ui/confirm.js", () => ({
	confirm: vi.fn(),
}));

describe("auth-menu", () => {
	beforeEach(() => {
		vi.mocked(select).mockReset();
		vi.mocked(confirm).mockReset();
		resetUiRuntimeOptions();
		setUiRuntimeOptions({
			v2Enabled: false,
			colorProfile: "ansi16",
			glyphMode: "ascii",
		});
	});

	it("renders same-email accounts with workspace and id details", async () => {
		vi.mocked(select).mockResolvedValueOnce({ type: "cancel" });

		const accounts: AccountInfo[] = [
			{
				index: 0,
				email: "shared@example.com",
				accountLabel: "Workspace A",
				accountId: "org-aaaa1111bbbb2222",
			},
			{
				index: 1,
				email: "shared@example.com",
				accountLabel: "Workspace B",
				accountId: "org-cccc1111dddd3333",
			},
		];

		await showAuthMenu(accounts);

		const firstCall = vi.mocked(select).mock.calls[0];
		expect(firstCall).toBeDefined();
		const items = firstCall?.[0] as Array<{ label: string; kind?: string; value?: { type?: string } }>;
		const accountRows = items.filter((item) => item.value?.type === "select-account");
		expect(accountRows).toHaveLength(2);
		expect(accountRows[0]?.label).toContain("shared@example.com");
		expect(accountRows[0]?.label).toContain("workspace:Workspace A");
		expect(accountRows[0]?.label).toContain("id:org-aaaa...bb2222");
		expect(accountRows[1]?.label).toContain("workspace:Workspace B");
		expect(accountRows[1]?.label).toContain("id:org-cccc...dd3333");
	});

	it("uses detailed account title in delete confirmation", async () => {
		vi.mocked(select).mockResolvedValueOnce("delete");
		vi.mocked(confirm).mockResolvedValueOnce(true);

		const action = await showAccountDetails({
			index: 0,
			email: "shared@example.com",
			accountLabel: "Workspace A",
			accountId: "org-aaaa1111bbbb2222",
		});

		expect(action).toBe("delete");
		expect(vi.mocked(confirm)).toHaveBeenCalledWith(
			expect.stringContaining("shared@example.com | workspace:Workspace A | id:org-aaaa...bb2222"),
		);
	});

	it("shows settings in the main auth menu", async () => {
		vi.mocked(select).mockResolvedValueOnce({ type: "cancel" });

		await showAuthMenu([]);

		const firstCall = vi.mocked(select).mock.calls[0];
		expect(firstCall).toBeDefined();
		const items = firstCall?.[0] as Array<{ label: string; value?: { type?: string } }>;
		expect(items.some((item) => item.value?.type === "settings")).toBe(true);
		expect(items.some((item) => item.label === "Settings" && item.kind === "heading")).toBe(true);
	});

	it("renders settings hub categories before sync actions", async () => {
		vi.mocked(select)
			.mockResolvedValueOnce("sync")
			.mockResolvedValueOnce("cancel");

		await showSettingsMenu(true);

		const firstCall = vi.mocked(select).mock.calls[0];
		expect(firstCall).toBeDefined();
		const hubItems = firstCall?.[0] as Array<{ label: string; value?: string; kind?: string }>;
		expect(hubItems.some((item) => item.label === "Categories")).toBe(true);
		expect(hubItems.some((item) => item.value === "sync")).toBe(true);
		expect(hubItems.some((item) => item.value === "maintenance")).toBe(true);

		const secondCall = vi.mocked(select).mock.calls[1];
		expect(secondCall).toBeDefined();
		const items = secondCall?.[0] as Array<{ label: string; value?: string }>;
		const toggleItem = items.find((item) => item.value === "toggle-sync");
		expect(toggleItem?.label).toContain("Sync from codex-multi-auth");
		expect(toggleItem?.label).toContain("[enabled]");
		expect(items.some((item) => item.label === "Sync")).toBe(true);
		expect(items.some((item) => item.label === "Navigation")).toBe(true);
	});

	it("preselects suggested prune candidates and exposes confirm action", async () => {
		vi.mocked(select).mockResolvedValueOnce({ type: "confirm" });

		const result = await showSyncPruneMenu(1, [
			{ index: 0, email: "current@example.com", isCurrentAccount: true, score: -1000, reason: "current" },
			{ index: 2, email: "old@example.com", score: 180, reason: "disabled, not present in codex-multi-auth source" },
		]);

		expect(result).toEqual([2]);
		const firstCall = vi.mocked(select).mock.calls[0];
		expect(firstCall).toBeDefined();
		const items = firstCall?.[0] as Array<{ label: string; value?: { type?: string } }>;
		expect(items.some((item) => item.label.includes("Continue With Selected Accounts"))).toBe(true);
		expect(firstCall?.[0][0]?.hint ?? "").toContain("score");
	});

	it("sanitizes quota summaries in account hints", async () => {
		vi.mocked(select).mockResolvedValueOnce({ type: "cancel" });

		await showAuthMenu([
			{
				index: 0,
				email: "safe@example.com",
				quotaSummary: "5h \u001b[31m100%\u001b[0m",
			},
		]);

		const firstCall = vi.mocked(select).mock.calls[0];
		const items = firstCall?.[0] as Array<{ hint?: string; value?: { type?: string } }>;
		const accountRow = items.find((item) => item.value?.type === "select-account");
		expect(accountRow?.hint ?? "").not.toContain("\u001b");
	});
});
