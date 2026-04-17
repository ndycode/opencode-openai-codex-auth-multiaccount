import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
	registerCleanup,
	unregisterCleanup,
	runCleanup,
	getCleanupCount,
} from "../lib/shutdown.js";
import { AccountManager } from "../lib/accounts.js";

vi.mock("../lib/storage.js", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../lib/storage.js")>();
	return {
		...actual,
		saveAccounts: vi.fn().mockResolvedValue(undefined),
	};
});

describe("Graceful shutdown", () => {
	beforeEach(async () => {
		await runCleanup();
	});

	it("registers and runs cleanup functions", async () => {
		const fn = vi.fn();
		registerCleanup(fn);
		expect(getCleanupCount()).toBe(1);
		await runCleanup();
		expect(fn).toHaveBeenCalledTimes(1);
		expect(getCleanupCount()).toBe(0);
	});

	it("unregisters cleanup functions", async () => {
		const fn = vi.fn();
		registerCleanup(fn);
		unregisterCleanup(fn);
		expect(getCleanupCount()).toBe(0);
		await runCleanup();
		expect(fn).not.toHaveBeenCalled();
	});

	it("runs multiple cleanup functions in order", async () => {
		const order: number[] = [];
		registerCleanup(() => { order.push(1); });
		registerCleanup(() => { order.push(2); });
		registerCleanup(() => { order.push(3); });
		await runCleanup();
		expect(order).toEqual([1, 2, 3]);
	});

	it("handles async cleanup functions", async () => {
		const fn = vi.fn(async () => {
			await new Promise((resolve) => setTimeout(resolve, 10));
		});
		registerCleanup(fn);
		await runCleanup();
		expect(fn).toHaveBeenCalledTimes(1);
	});

	it("continues cleanup even if one function throws", async () => {
		const fn1 = vi.fn(() => { throw new Error("fail"); });
		const fn2 = vi.fn();
		registerCleanup(fn1);
		registerCleanup(fn2);
		await runCleanup();
		expect(fn1).toHaveBeenCalled();
		expect(fn2).toHaveBeenCalled();
	});

	it("clears cleanup list after running", async () => {
		registerCleanup(() => {});
		registerCleanup(() => {});
		expect(getCleanupCount()).toBe(2);
		await runCleanup();
		expect(getCleanupCount()).toBe(0);
	});

	it("unregister is no-op for non-registered function", () => {
		const fn = vi.fn();
		unregisterCleanup(fn);
		expect(getCleanupCount()).toBe(0);
	});

	describe("process signal integration", () => {
		it("SIGINT handler runs cleanup and exits with code 0", async () => {
			const capturedHandlers = new Map<string, (...args: unknown[]) => void>();
			
			const processOnceSpy = vi.spyOn(process, "once").mockImplementation((event: string | symbol, handler: (...args: unknown[]) => void) => {
				capturedHandlers.set(String(event), handler);
				return process;
			});
			const processExitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

			vi.resetModules();
			const { registerCleanup: freshRegister, runCleanup: freshRunCleanup } = await import("../lib/shutdown.js");
			await freshRunCleanup();

			const cleanupFn = vi.fn();
			freshRegister(cleanupFn);

			const sigintHandler = capturedHandlers.get("SIGINT");
			expect(sigintHandler).toBeDefined();

			sigintHandler!();
			await new Promise((r) => setTimeout(r, 10));

			expect(cleanupFn).toHaveBeenCalled();
			expect(processExitSpy).toHaveBeenCalledWith(0);

			processOnceSpy.mockRestore();
			processExitSpy.mockRestore();
		});

		it("SIGTERM handler runs cleanup and exits with code 0", async () => {
			const capturedHandlers = new Map<string, (...args: unknown[]) => void>();
			
			const processOnceSpy = vi.spyOn(process, "once").mockImplementation((event: string | symbol, handler: (...args: unknown[]) => void) => {
				capturedHandlers.set(String(event), handler);
				return process;
			});
			const processExitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

			vi.resetModules();
			const { registerCleanup: freshRegister, runCleanup: freshRunCleanup } = await import("../lib/shutdown.js");
			await freshRunCleanup();

			const cleanupFn = vi.fn();
			freshRegister(cleanupFn);

			const sigtermHandler = capturedHandlers.get("SIGTERM");
			expect(sigtermHandler).toBeDefined();

			sigtermHandler!();
			await new Promise((r) => setTimeout(r, 10));

			expect(cleanupFn).toHaveBeenCalled();
			expect(processExitSpy).toHaveBeenCalledWith(0);

			processOnceSpy.mockRestore();
			processExitSpy.mockRestore();
		});

		it("beforeExit handler runs cleanup without calling exit", async () => {
			const capturedHandlers = new Map<string, (...args: unknown[]) => void>();
			
			const processOnceSpy = vi.spyOn(process, "once").mockImplementation((event: string | symbol, handler: (...args: unknown[]) => void) => {
				capturedHandlers.set(String(event), handler);
				return process;
			});
			const processExitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

			vi.resetModules();
			const { registerCleanup: freshRegister, runCleanup: freshRunCleanup } = await import("../lib/shutdown.js");
			await freshRunCleanup();

			const cleanupFn = vi.fn();
			freshRegister(cleanupFn);

			const beforeExitHandler = capturedHandlers.get("beforeExit");
			expect(beforeExitHandler).toBeDefined();

			beforeExitHandler!();
			await new Promise((r) => setTimeout(r, 10));

			expect(cleanupFn).toHaveBeenCalled();
			expect(processExitSpy).not.toHaveBeenCalled();

			processOnceSpy.mockRestore();
			processExitSpy.mockRestore();
		});

		it("signal handlers are only registered once", async () => {
			const processOnceSpy = vi.spyOn(process, "once").mockImplementation(() => process);

			vi.resetModules();
			const { registerCleanup: freshRegister } = await import("../lib/shutdown.js");

			freshRegister(() => {});
			const firstCallCount = processOnceSpy.mock.calls.length;

			freshRegister(() => {});
			expect(processOnceSpy.mock.calls.length).toBe(firstCallCount);

			processOnceSpy.mockRestore();
		});
	});

	describe("AccountManager integration (Phase 1 reliability)", () => {
		beforeEach(async () => {
			await runCleanup();
			const { saveAccounts } = await import("../lib/storage.js");
			vi.mocked(saveAccounts).mockClear();
			vi.mocked(saveAccounts).mockResolvedValue();
		});

		it("shutdown flushes pending AccountManager save before exit", async () => {
			const { saveAccounts } = await import("../lib/storage.js");
			const mockSaveAccounts = vi.mocked(saveAccounts);
			const now = Date.now();
			const manager = new AccountManager(undefined, {
				version: 3,
				activeIndex: 0,
				accounts: [{ refreshToken: "t1", addedAt: now, lastUsed: now }],
			});

			// Schedule a save well beyond the window of any realistic test run;
			// if the shutdown handler is wired up, it must flush immediately.
			manager.saveToDiskDebounced(10_000);
			expect(mockSaveAccounts).not.toHaveBeenCalled();
			expect(getCleanupCount()).toBeGreaterThan(0);

			await runCleanup();

			expect(mockSaveAccounts).toHaveBeenCalledTimes(1);
			expect(getCleanupCount()).toBe(0);

			manager.disposeShutdownHandler();
		});

		it("is a no-op when no debounced save is pending", async () => {
			const { saveAccounts } = await import("../lib/storage.js");
			const mockSaveAccounts = vi.mocked(saveAccounts);
			const now = Date.now();
			const manager = new AccountManager(undefined, {
				version: 3,
				activeIndex: 0,
				accounts: [{ refreshToken: "t1", addedAt: now, lastUsed: now }],
			});

			manager.saveToDiskDebounced(10_000);
			await manager.flushPendingSave();
			mockSaveAccounts.mockClear();

			await runCleanup();

			expect(mockSaveAccounts).not.toHaveBeenCalled();
			manager.disposeShutdownHandler();
		});

		it("disposeShutdownHandler removes the cleanup registration", async () => {
			const { saveAccounts } = await import("../lib/storage.js");
			const mockSaveAccounts = vi.mocked(saveAccounts);
			const now = Date.now();
			const manager = new AccountManager(undefined, {
				version: 3,
				activeIndex: 0,
				accounts: [{ refreshToken: "t1", addedAt: now, lastUsed: now }],
			});

			manager.saveToDiskDebounced(10_000);
			const countWithHandler = getCleanupCount();
			expect(countWithHandler).toBeGreaterThan(0);

			manager.disposeShutdownHandler();
			expect(getCleanupCount()).toBe(countWithHandler - 1);

			await runCleanup();
			expect(mockSaveAccounts).not.toHaveBeenCalled();
		});

		it("survives a flushPendingSave rejection without blocking other cleanup", async () => {
			const { saveAccounts } = await import("../lib/storage.js");
			const mockSaveAccounts = vi.mocked(saveAccounts);
			mockSaveAccounts.mockRejectedValueOnce(new Error("disk full"));

			const now = Date.now();
			const manager = new AccountManager(undefined, {
				version: 3,
				activeIndex: 0,
				accounts: [{ refreshToken: "t1", addedAt: now, lastUsed: now }],
			});
			const secondCleanup = vi.fn();
			registerCleanup(secondCleanup);

			manager.saveToDiskDebounced(10_000);

			await runCleanup();

			expect(mockSaveAccounts).toHaveBeenCalledTimes(1);
			expect(secondCleanup).toHaveBeenCalledTimes(1);

			manager.disposeShutdownHandler();
		});
	});
});
