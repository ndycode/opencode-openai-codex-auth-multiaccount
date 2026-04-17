/**
 * Persistence surface for {@link AccountManager}: debounced disk saves,
 * pending-save coalescing, and shutdown-flush registration.
 *
 * All on-disk format concerns live in `lib/storage.ts`. This module owns the
 * *lifecycle* (when to save, how to flush before exit, how to dispose the
 * shutdown hook) rather than the serialization shape itself.
 */

import { createLogger } from "../logger.js";
import { MODEL_FAMILIES, type ModelFamily } from "../prompts/codex.js";
import { registerCleanup, unregisterCleanup } from "../shutdown.js";
import { saveAccounts, type AccountStorageV3 } from "../storage.js";
import { clampNonNegativeInt } from "./rate-limits.js";
import type { AccountState } from "./state.js";

const log = createLogger("accounts");

/**
 * Upper bound the shutdown handler will wait for `flushPendingSave` so that a
 * jammed save cannot stall SIGINT/SIGTERM indefinitely.
 */
const SHUTDOWN_FLUSH_TIMEOUT_MS = 5_000;

export class AccountPersistence {
	private saveDebounceTimer: ReturnType<typeof setTimeout> | null = null;
	private pendingSave: Promise<void> | null = null;
	private shutdownHandler: (() => Promise<void>) | null = null;

	constructor(private readonly state: AccountState) {}

	async saveToDisk(): Promise<void> {
		const activeIndexByFamily: Partial<Record<ModelFamily, number>> = {};
		for (const family of MODEL_FAMILIES) {
			const raw = this.state.currentAccountIndexByFamily[family];
			activeIndexByFamily[family] = clampNonNegativeInt(raw, 0);
		}

		const activeIndex = clampNonNegativeInt(activeIndexByFamily.codex, 0);

		const storage: AccountStorageV3 = {
			version: 3,
			accounts: this.state.accounts.map((account) => ({
				accountId: account.accountId,
				organizationId: account.organizationId,
				accountIdSource: account.accountIdSource,
				accountLabel: account.accountLabel,
				accountTags: account.accountTags,
				accountNote: account.accountNote,
				email: account.email,
				refreshToken: account.refreshToken,
				accessToken: account.access,
				expiresAt: account.expires,
				enabled: account.enabled === false ? false : undefined,
				addedAt: account.addedAt,
				lastUsed: account.lastUsed,
				lastSwitchReason: account.lastSwitchReason,
				rateLimitResetTimes:
					Object.keys(account.rateLimitResetTimes).length > 0
						? account.rateLimitResetTimes
						: undefined,
				coolingDownUntil: account.coolingDownUntil,
				cooldownReason: account.cooldownReason,
			})),
			activeIndex,
			activeIndexByFamily,
		};

		await saveAccounts(storage);
	}

	saveToDiskDebounced(delayMs = 500): void {
		this.ensureShutdownFlushRegistered();
		if (this.saveDebounceTimer) {
			clearTimeout(this.saveDebounceTimer);
		}
		this.saveDebounceTimer = setTimeout(() => {
			this.saveDebounceTimer = null;
			const doSave = async () => {
				try {
					if (this.pendingSave) {
						await this.pendingSave;
					}
					this.pendingSave = this.saveToDisk().finally(() => {
						this.pendingSave = null;
					});
					await this.pendingSave;
				} catch (error) {
					log.warn("Debounced save failed", {
						error: error instanceof Error ? error.message : String(error),
					});
				}
			};
			void doSave();
		}, delayMs);
	}

	async flushPendingSave(): Promise<void> {
		if (this.saveDebounceTimer) {
			clearTimeout(this.saveDebounceTimer);
			this.saveDebounceTimer = null;
			await this.saveToDisk();
		}
		if (this.pendingSave) {
			await this.pendingSave;
		}
	}

	/**
	 * Registers a process-shutdown cleanup that awaits any pending debounced
	 * save. Without this, a rotation queued inside the 500ms debounce window
	 * would be lost when SIGINT/SIGTERM fires before the timer resolves.
	 * Registration is lazy (only when `saveToDiskDebounced` is first invoked)
	 * so idle managers do not leak handlers into the shutdown queue.
	 */
	private ensureShutdownFlushRegistered(): void {
		if (this.shutdownHandler) return;
		const handler = async (): Promise<void> => {
			// One-shot: clear the slot first so that if `runCleanup()` fires
			// externally (e.g. tests reusing a manager across cycles, or any
			// other caller that drains the global cleanup queue), a subsequent
			// `saveToDiskDebounced()` can re-register a fresh handler. Without
			// this the guard above returns early and the next pending save
			// goes unprotected on shutdown.
			this.shutdownHandler = null;
			let timeoutTimer: ReturnType<typeof setTimeout> | null = null;
			try {
				await Promise.race([
					this.flushPendingSave(),
					new Promise<void>((_resolve, reject) => {
						timeoutTimer = setTimeout(() => {
							reject(
								new Error(
									`flushPendingSave timed out after ${SHUTDOWN_FLUSH_TIMEOUT_MS}ms`,
								),
							);
						}, SHUTDOWN_FLUSH_TIMEOUT_MS);
					}),
				]);
			} catch (error) {
				log.warn("Shutdown flush failed", {
					error: error instanceof Error ? error.message : String(error),
				});
			} finally {
				if (timeoutTimer) clearTimeout(timeoutTimer);
			}
		};
		this.shutdownHandler = handler;
		registerCleanup(handler);
	}

	/**
	 * Removes this manager's shutdown cleanup registration. Call this when
	 * replacing an `AccountManager` instance (e.g., on cache invalidation)
	 * to avoid unbounded growth of the global cleanup queue.
	 */
	disposeShutdownHandler(): void {
		if (!this.shutdownHandler) return;
		unregisterCleanup(this.shutdownHandler);
		this.shutdownHandler = null;
	}
}
