import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

import {
	clearTuiQuotaSnapshot,
	createTuiQuotaSnapshot,
	getTuiQuotaCachePath,
	parseTuiQuotaSnapshotFromHeaders,
	readTuiQuotaSnapshot,
	writeTuiQuotaSnapshot,
} from "../lib/tui-quota-cache.js";

describe("TUI quota cache", () => {
	it("parses Codex quota response headers into a prompt snapshot", () => {
		const headers = new Headers({
			"x-codex-primary-used-percent": "20",
			"x-codex-primary-window-minutes": "300",
			"x-codex-secondary-used-percent": "16",
			"x-codex-secondary-window-minutes": "10080",
			"x-codex-plan-type": "plus",
			"x-codex-active-limit": "40",
		});

		const snapshot = parseTuiQuotaSnapshotFromHeaders(headers, {
			fingerprint: "acct",
			accountIndex: 2,
			accountCount: 3,
			accountEmail: "user2@example.com",
			accountLabel: "Account 2",
			fetchedAt: 1000,
		});

		expect(snapshot).toEqual(
			expect.objectContaining({
				fingerprint: "acct",
				source: "headers",
				accountIndex: 2,
				accountCount: 3,
				accountEmail: "user2@example.com",
				accountLabel: "Account 2",
				planType: "plus",
				activeLimit: 40,
			}),
		);
		expect(snapshot?.limits).toEqual([
			expect.objectContaining({
				label: "5h",
				leftPercent: 80,
				usedPercent: 20,
				windowMinutes: 300,
			}),
			expect.objectContaining({
				label: "7d",
				leftPercent: 84,
				usedPercent: 16,
				windowMinutes: 10080,
			}),
		]);
	});

	it("returns undefined when response headers do not include quota", () => {
		expect(
			parseTuiQuotaSnapshotFromHeaders(new Headers(), {
				fingerprint: "acct",
			}),
		).toBeUndefined();
	});

	it("round-trips the shared quota cache file", async () => {
		const dir = await mkdtemp(join(tmpdir(), "tui-quota-cache-"));
		const path = getTuiQuotaCachePath(dir);
		try {
			const snapshot = createTuiQuotaSnapshot({
				fingerprint: "acct",
				source: "usage",
				fetchedAt: 1000,
				limits: [{ label: "5h", leftPercent: 99 }],
			});
			await writeTuiQuotaSnapshot(snapshot, path);
			await expect(readTuiQuotaSnapshot(path)).resolves.toEqual(snapshot);
			await clearTuiQuotaSnapshot(path);
			await expect(readTuiQuotaSnapshot(path)).resolves.toBeUndefined();
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});
