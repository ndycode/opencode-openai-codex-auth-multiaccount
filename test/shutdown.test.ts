import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
	registerCleanup,
	unregisterCleanup,
	runCleanup,
	getCleanupCount,
} from "../lib/shutdown.js";

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

	it("drains cleanup functions registered while cleanup is already running", async () => {
		const order: number[] = [];
		registerCleanup(async () => {
			order.push(1);
			registerCleanup(() => {
				order.push(2);
			});
		});

		await runCleanup();

		expect(order).toEqual([1, 2]);
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
			
			const processOnSpy = vi.spyOn(process, "on").mockImplementation((event: string | symbol, handler: (...args: unknown[]) => void) => {
				capturedHandlers.set(String(event), handler);
				return process;
			});
			const processExitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

			vi.resetModules();
			const { registerCleanup: freshRegister, runCleanup: freshRunCleanup } = await import("../lib/shutdown.js");
			await freshRunCleanup();

			const cleanupFn = vi.fn();
			freshRegister(cleanupFn);

			try {
				const sigintHandler = capturedHandlers.get("SIGINT");
				expect(sigintHandler).toBeDefined();

				sigintHandler!();
				await vi.waitFor(() => {
					expect(cleanupFn).toHaveBeenCalled();
					expect(processExitSpy).toHaveBeenCalledWith(0);
				});
			} finally {
				processOnSpy.mockRestore();
				processExitSpy.mockRestore();
			}
		});

		it("SIGTERM handler runs cleanup and exits with code 0", async () => {
			const capturedHandlers = new Map<string, (...args: unknown[]) => void>();
			
			const processOnSpy = vi.spyOn(process, "on").mockImplementation((event: string | symbol, handler: (...args: unknown[]) => void) => {
				capturedHandlers.set(String(event), handler);
				return process;
			});
			const processExitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

			vi.resetModules();
			const { registerCleanup: freshRegister, runCleanup: freshRunCleanup } = await import("../lib/shutdown.js");
			await freshRunCleanup();

			const cleanupFn = vi.fn();
			freshRegister(cleanupFn);

			try {
				const sigtermHandler = capturedHandlers.get("SIGTERM");
				expect(sigtermHandler).toBeDefined();

				sigtermHandler!();
				await vi.waitFor(() => {
					expect(cleanupFn).toHaveBeenCalled();
					expect(processExitSpy).toHaveBeenCalledWith(0);
				});
			} finally {
				processOnSpy.mockRestore();
				processExitSpy.mockRestore();
			}
		});

		it("keeps shutdown handlers installed until async cleanup completes", async () => {
			const capturedHandlers = new Map<string, (...args: unknown[]) => void>();

			const processOnSpy = vi.spyOn(process, "on").mockImplementation((event: string | symbol, handler: (...args: unknown[]) => void) => {
				capturedHandlers.set(String(event), handler);
				return process;
			});
			const processOffSpy = vi.spyOn(process, "off").mockImplementation(() => process);
			const processExitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

			vi.resetModules();
			const { registerCleanup: freshRegister, runCleanup: freshRunCleanup } = await import("../lib/shutdown.js");
			await freshRunCleanup();

			let resolveCleanup!: () => void;
			const cleanupPromise = new Promise<void>((resolve) => {
				resolveCleanup = resolve;
			});
			freshRegister(async () => {
				await cleanupPromise;
			});

			try {
				const sigtermHandler = capturedHandlers.get("SIGTERM");
				expect(sigtermHandler).toBeDefined();

				sigtermHandler!();
				await Promise.resolve();
				expect(processOffSpy).not.toHaveBeenCalled();

				resolveCleanup();
				await vi.waitFor(() => {
					expect(processExitSpy).toHaveBeenCalledWith(0);
				});
				expect(processOffSpy).toHaveBeenCalled();
			} finally {
				processOnSpy.mockRestore();
				processOffSpy.mockRestore();
				processExitSpy.mockRestore();
			}
		});

		it("ignores repeated signals while async cleanup is already running", async () => {
			const capturedHandlers = new Map<string, (...args: unknown[]) => void>();

			const processOnSpy = vi.spyOn(process, "on").mockImplementation((event: string | symbol, handler: (...args: unknown[]) => void) => {
				capturedHandlers.set(String(event), handler);
				return process;
			});
			const processExitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

			vi.resetModules();
			const { registerCleanup: freshRegister, runCleanup: freshRunCleanup } = await import("../lib/shutdown.js");
			await freshRunCleanup();

			let resolveCleanup!: () => void;
			const cleanupPromise = new Promise<void>((resolve) => {
				resolveCleanup = resolve;
			});
			const cleanupFn = vi.fn(async () => {
				await cleanupPromise;
			});
			freshRegister(cleanupFn);

			try {
				const sigtermHandler = capturedHandlers.get("SIGTERM");
				expect(sigtermHandler).toBeDefined();

				sigtermHandler!();
				sigtermHandler!();
				await Promise.resolve();

				expect(cleanupFn).toHaveBeenCalledTimes(1);
				expect(processExitSpy).not.toHaveBeenCalled();

				resolveCleanup();
				await vi.waitFor(() => {
					expect(processExitSpy).toHaveBeenCalledTimes(1);
					expect(processExitSpy).toHaveBeenCalledWith(0);
				});
			} finally {
				processOnSpy.mockRestore();
				processExitSpy.mockRestore();
			}
		});

		it("forces exit if signal cleanup stalls past the timeout", async () => {
			vi.useFakeTimers();
			const capturedHandlers = new Map<string, (...args: unknown[]) => void>();

			const processOnSpy = vi.spyOn(process, "on").mockImplementation((event: string | symbol, handler: (...args: unknown[]) => void) => {
				capturedHandlers.set(String(event), handler);
				return process;
			});
			const processExitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

			vi.resetModules();
			const { registerCleanup: freshRegister, runCleanup: freshRunCleanup } = await import("../lib/shutdown.js");
			await freshRunCleanup();

			const cleanupFn = vi.fn(async () => {
				await new Promise<void>(() => {
					// Intentionally never resolves so the timeout path can force exit.
				});
			});
			freshRegister(cleanupFn);

			try {
				const sigtermHandler = capturedHandlers.get("SIGTERM");
				expect(sigtermHandler).toBeDefined();

				sigtermHandler!();
				await Promise.resolve();

				expect(cleanupFn).toHaveBeenCalledTimes(1);
				expect(processExitSpy).not.toHaveBeenCalled();

				await vi.advanceTimersByTimeAsync(5_000);

				expect(processExitSpy).toHaveBeenCalledTimes(1);
				expect(processExitSpy).toHaveBeenCalledWith(0);
			} finally {
				vi.useRealTimers();
				processOnSpy.mockRestore();
				processExitSpy.mockRestore();
			}
		});

		it("allows later signals again if process exit is intercepted", async () => {
			const capturedHandlers = new Map<string, (...args: unknown[]) => void>();

			const processOnSpy = vi.spyOn(process, "on").mockImplementation((event: string | symbol, handler: (...args: unknown[]) => void) => {
				capturedHandlers.set(String(event), handler);
				return process;
			});
			const processExitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

			vi.resetModules();
			const { registerCleanup: freshRegister, runCleanup: freshRunCleanup } = await import("../lib/shutdown.js");
			await freshRunCleanup();

			const cleanupFn = vi.fn();
			freshRegister(cleanupFn);

			try {
				const sigtermHandler = capturedHandlers.get("SIGTERM");
				expect(sigtermHandler).toBeDefined();

				sigtermHandler!();
				await vi.waitFor(() => {
					expect(cleanupFn).toHaveBeenCalledTimes(1);
					expect(processExitSpy).toHaveBeenCalledTimes(1);
				});

				sigtermHandler!();
				await vi.waitFor(() => {
					expect(processExitSpy).toHaveBeenCalledTimes(2);
				});

				expect(cleanupFn).toHaveBeenCalledTimes(1);
			} finally {
				processOnSpy.mockRestore();
				processExitSpy.mockRestore();
			}
		});

		it("beforeExit handler runs cleanup without calling exit", async () => {
			const capturedHandlers = new Map<string, (...args: unknown[]) => void>();
			
			const processOnSpy = vi.spyOn(process, "on").mockImplementation((event: string | symbol, handler: (...args: unknown[]) => void) => {
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

			try {
				beforeExitHandler!();
				await vi.waitFor(() => {
					expect(cleanupFn).toHaveBeenCalled();
				});
				expect(processExitSpy).not.toHaveBeenCalled();
			} finally {
				processOnSpy.mockRestore();
				processExitSpy.mockRestore();
			}
		});

		it("keeps handlers installed when a signal arrives during beforeExit cleanup", async () => {
			const capturedHandlers = new Map<string, (...args: unknown[]) => void>();

			const processOnSpy = vi.spyOn(process, "on").mockImplementation((event: string | symbol, handler: (...args: unknown[]) => void) => {
				capturedHandlers.set(String(event), handler);
				return process;
			});
			const processOffSpy = vi.spyOn(process, "off").mockImplementation(() => process);
			const processExitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

			vi.resetModules();
			const { registerCleanup: freshRegister, runCleanup: freshRunCleanup } = await import("../lib/shutdown.js");
			await freshRunCleanup();

			let resolveCleanup!: () => void;
			const cleanupPromise = new Promise<void>((resolve) => {
				resolveCleanup = resolve;
			});
			const cleanupFn = vi.fn(async () => {
				await cleanupPromise;
			});
			freshRegister(cleanupFn);

			try {
				const beforeExitHandler = capturedHandlers.get("beforeExit");
				const sigtermHandler = capturedHandlers.get("SIGTERM");
				expect(beforeExitHandler).toBeDefined();
				expect(sigtermHandler).toBeDefined();

				beforeExitHandler!();
				await Promise.resolve();
				sigtermHandler!();
				await Promise.resolve();

				expect(cleanupFn).toHaveBeenCalledTimes(1);
				expect(processExitSpy).not.toHaveBeenCalled();
				expect(processOffSpy).not.toHaveBeenCalled();

				resolveCleanup();
				await vi.waitFor(() => {
					expect(processExitSpy).toHaveBeenCalledWith(0);
				});
				expect(processOffSpy).toHaveBeenCalled();
			} finally {
				processOnSpy.mockRestore();
				processOffSpy.mockRestore();
				processExitSpy.mockRestore();
			}
		});

		it("signal handlers are only registered once", async () => {
			const processOnSpy = vi.spyOn(process, "on").mockImplementation(() => process);

			vi.resetModules();
			const { registerCleanup: freshRegister } = await import("../lib/shutdown.js");

			freshRegister(() => {});
			const firstCallCount = processOnSpy.mock.calls.length;

			freshRegister(() => {});
			expect(processOnSpy.mock.calls.length).toBe(firstCallCount);

			processOnSpy.mockRestore();
		});

		it("re-registers signal handlers after cleanup resets shutdown state", async () => {
			const processOnSpy = vi.spyOn(process, "on").mockImplementation(() => process);
			const processOffSpy = vi.spyOn(process, "off").mockImplementation(() => process);

			vi.resetModules();
			const {
				registerCleanup: freshRegister,
				runCleanup: freshRunCleanup,
			} = await import("../lib/shutdown.js");

			freshRegister(() => {});
			expect(processOnSpy).toHaveBeenCalledTimes(3);

			await freshRunCleanup();
			expect(processOffSpy).toHaveBeenCalledTimes(3);
			freshRegister(() => {});
			expect(processOnSpy).toHaveBeenCalledTimes(6);

			processOnSpy.mockRestore();
			processOffSpy.mockRestore();
		});

		it("reinstalls signal handlers when cleanup is registered during teardown", async () => {
			const processOnSpy = vi.spyOn(process, "on").mockImplementation(() => process);

			vi.resetModules();
			const {
				registerCleanup: freshRegister,
				runCleanup: freshRunCleanup,
				getCleanupCount: freshGetCleanupCount,
			} = await import("../lib/shutdown.js");
			await freshRunCleanup();

			let registeredDuringTeardown = false;
			const processOffSpy = vi.spyOn(process, "off").mockImplementation((event: string | symbol) => {
				if (!registeredDuringTeardown && String(event) === "beforeExit") {
					registeredDuringTeardown = true;
					freshRegister(() => {});
				}
				return process;
			});

			try {
				freshRegister(() => {});
				expect(processOnSpy).toHaveBeenCalledTimes(3);

				await freshRunCleanup();

				expect(freshGetCleanupCount()).toBe(1);
				expect(processOffSpy).toHaveBeenCalledTimes(3);
				expect(processOnSpy).toHaveBeenCalledTimes(6);
			} finally {
				processOnSpy.mockRestore();
				processOffSpy.mockRestore();
			}
		});
	});
});
