import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
	clearRateLimitBackoffState,
	getRateLimitBackoff,
	resetRateLimitBackoff,
} from "../lib/request/rate-limit-backoff.js";

describe("Rate limit backoff", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date(0));
		clearRateLimitBackoffState();
	});

	afterEach(() => {
		clearRateLimitBackoffState();
		vi.useRealTimers();
	});

	it("deduplicates concurrent 429s within the window", () => {
		const first = getRateLimitBackoff(0, "codex", 1000);
		expect(first).toEqual({ attempt: 1, delayMs: 1000, isDuplicate: false });

		vi.setSystemTime(new Date(1000));
		const second = getRateLimitBackoff(0, "codex", 1000);
		expect(second.attempt).toBe(1);
		expect(second.delayMs).toBe(1000);
		expect(second.isDuplicate).toBe(true);
	});

	it("increments after dedup window", () => {
		getRateLimitBackoff(0, "codex", 1000);
		vi.setSystemTime(new Date(2500));
		const second = getRateLimitBackoff(0, "codex", 1000);
		expect(second.attempt).toBe(2);
		expect(second.delayMs).toBe(2000);
		expect(second.isDuplicate).toBe(false);
	});

	it("resets after quiet period", () => {
		getRateLimitBackoff(0, "codex", 1000);
		vi.setSystemTime(new Date(121_000));
		const next = getRateLimitBackoff(0, "codex", 1000);
		expect(next.attempt).toBe(1);
	});

	it("resetRateLimitBackoff clears state", () => {
		getRateLimitBackoff(0, "codex", 1000);
		resetRateLimitBackoff(0, "codex");
		const next = getRateLimitBackoff(0, "codex", 1000);
		expect(next.attempt).toBe(1);
		expect(next.isDuplicate).toBe(false);
	});
});
