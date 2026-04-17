/**
 * Rotation + rate-limit + cooldown surface for {@link AccountManager}.
 *
 * Pure logic module: all state mutations land on a shared {@link AccountState}
 * reference. Integrates with the health and token-bucket trackers in
 * `lib/rotation.ts` (note: that file is the hybrid selection algorithm; this
 * module is the manager-facing wrapper that wires it to `AccountState`).
 */

import type { ModelFamily } from "../prompts/codex.js";
import {
	getHealthTracker,
	getTokenTracker,
	selectHybridAccount,
	type AccountWithMetrics,
	type HybridSelectionOptions,
} from "../rotation.js";
import type { CooldownReason } from "../storage.js";
import { nowMs } from "../utils.js";
import {
	clearExpiredRateLimits,
	getQuotaKey,
	isRateLimitedForFamily,
	type RateLimitReason,
} from "./rate-limits.js";
import type { AccountState, ManagedAccount } from "./state.js";

export class AccountRotation {
	constructor(private readonly state: AccountState) {}

	getCurrentOrNextForFamily(
		family: ModelFamily,
		model?: string | null,
	): ManagedAccount | null {
		const count = this.state.accounts.length;
		if (count === 0) return null;

		const cursor = this.state.cursorByFamily[family];

		for (let i = 0; i < count; i++) {
			const idx = (cursor + i) % count;
			const account = this.state.accounts[idx];
			if (!account) continue;
			if (account.enabled === false) continue;

			clearExpiredRateLimits(account);
			if (
				isRateLimitedForFamily(account, family, model) ||
				this.state.isAccountCoolingDown(account)
			) {
				continue;
			}

			this.state.cursorByFamily[family] = (idx + 1) % count;
			this.state.currentAccountIndexByFamily[family] = idx;
			account.lastUsed = nowMs();
			return account;
		}

		return null;
	}

	getNextForFamily(family: ModelFamily, model?: string | null): ManagedAccount | null {
		const count = this.state.accounts.length;
		if (count === 0) return null;

		const cursor = this.state.cursorByFamily[family];

		for (let i = 0; i < count; i++) {
			const idx = (cursor + i) % count;
			const account = this.state.accounts[idx];
			if (!account) continue;
			if (account.enabled === false) continue;

			clearExpiredRateLimits(account);
			if (
				isRateLimitedForFamily(account, family, model) ||
				this.state.isAccountCoolingDown(account)
			) {
				continue;
			}

			this.state.cursorByFamily[family] = (idx + 1) % count;
			account.lastUsed = nowMs();
			return account;
		}

		return null;
	}

	getCurrentOrNextForFamilyHybrid(
		family: ModelFamily,
		model?: string | null,
		options?: HybridSelectionOptions,
	): ManagedAccount | null {
		const count = this.state.accounts.length;
		if (count === 0) return null;

		const currentIndex = this.state.currentAccountIndexByFamily[family];
		if (currentIndex >= 0 && currentIndex < count) {
			const currentAccount = this.state.accounts[currentIndex];
			if (currentAccount) {
				if (currentAccount.enabled === false) {
					// Fall through to hybrid selection.
				} else {
					clearExpiredRateLimits(currentAccount);
					if (
						!isRateLimitedForFamily(currentAccount, family, model) &&
						!this.state.isAccountCoolingDown(currentAccount)
					) {
						currentAccount.lastUsed = nowMs();
						return currentAccount;
					}
				}
			}
		}

		const quotaKey = model ? `${family}:${model}` : family;
		const healthTracker = getHealthTracker();
		const tokenTracker = getTokenTracker();

		const accountsWithMetrics: AccountWithMetrics[] = this.state.accounts
			.map((account): AccountWithMetrics | null => {
				if (!account) return null;
				if (account.enabled === false) return null;
				clearExpiredRateLimits(account);
				const isAvailable =
					!isRateLimitedForFamily(account, family, model) &&
					!this.state.isAccountCoolingDown(account);
				return {
					index: account.index,
					isAvailable,
					lastUsed: account.lastUsed,
				};
			})
			.filter((a): a is AccountWithMetrics => a !== null);

		const selected = selectHybridAccount(
			accountsWithMetrics,
			healthTracker,
			tokenTracker,
			quotaKey,
			{},
			options,
		);
		if (!selected) return null;

		const account = this.state.accounts[selected.index];
		if (!account) return null;

		this.state.currentAccountIndexByFamily[family] = account.index;
		this.state.cursorByFamily[family] = (account.index + 1) % count;
		account.lastUsed = nowMs();
		return account;
	}

	recordSuccess(
		account: ManagedAccount,
		family: ModelFamily,
		model?: string | null,
	): void {
		const quotaKey = model ? `${family}:${model}` : family;
		getHealthTracker().recordSuccess(account.index, quotaKey);
	}

	recordRateLimit(
		account: ManagedAccount,
		family: ModelFamily,
		model?: string | null,
	): void {
		const quotaKey = model ? `${family}:${model}` : family;
		getHealthTracker().recordRateLimit(account.index, quotaKey);
		getTokenTracker().drain(account.index, quotaKey);
	}

	recordFailure(
		account: ManagedAccount,
		family: ModelFamily,
		model?: string | null,
	): void {
		const quotaKey = model ? `${family}:${model}` : family;
		getHealthTracker().recordFailure(account.index, quotaKey);
	}

	consumeToken(
		account: ManagedAccount,
		family: ModelFamily,
		model?: string | null,
	): boolean {
		const quotaKey = model ? `${family}:${model}` : family;
		return getTokenTracker().tryConsume(account.index, quotaKey);
	}

	/**
	 * Refund a token consumed within the refund window (30 seconds).
	 * Use this when a request fails due to network errors (not rate limits).
	 * @returns true if refund was successful, false if no valid consumption found
	 */
	refundToken(
		account: ManagedAccount,
		family: ModelFamily,
		model?: string | null,
	): boolean {
		const quotaKey = model ? `${family}:${model}` : family;
		return getTokenTracker().refundToken(account.index, quotaKey);
	}

	markRateLimited(
		account: ManagedAccount,
		retryAfterMs: number,
		family: ModelFamily,
		model?: string | null,
	): void {
		this.markRateLimitedWithReason(account, retryAfterMs, family, "unknown", model);
	}

	markRateLimitedWithReason(
		account: ManagedAccount,
		retryAfterMs: number,
		family: ModelFamily,
		reason: RateLimitReason,
		model?: string | null,
	): void {
		const retryMs = Math.max(0, Math.floor(retryAfterMs));
		const resetAt = nowMs() + retryMs;

		const baseKey = getQuotaKey(family);
		account.rateLimitResetTimes[baseKey] = resetAt;

		if (model) {
			const modelKey = getQuotaKey(family, model);
			account.rateLimitResetTimes[modelKey] = resetAt;
		}

		account.lastRateLimitReason = reason;
	}

	markAccountCoolingDown(
		account: ManagedAccount,
		cooldownMs: number,
		reason: CooldownReason,
	): void {
		const ms = Math.max(0, Math.floor(cooldownMs));
		account.coolingDownUntil = nowMs() + ms;
		account.cooldownReason = reason;
	}

	/**
	 * Mark every in-memory account sharing a refresh token as cooling down.
	 * @returns Number of live accounts updated.
	 */
	markAccountsWithRefreshTokenCoolingDown(
		refreshToken: string,
		cooldownMs: number,
		reason: CooldownReason,
	): number {
		const matches = this.state.accounts.filter(
			(account) => account.refreshToken === refreshToken,
		);
		for (const account of matches) {
			this.markAccountCoolingDown(account, cooldownMs, reason);
		}
		return matches.length;
	}

	getMinWaitTimeForFamily(family: ModelFamily, model?: string | null): number {
		const now = nowMs();
		const enabledAccounts = this.state.accounts.filter(
			(account) => account.enabled !== false,
		);
		const available = enabledAccounts.filter((account) => {
			clearExpiredRateLimits(account);
			return (
				!isRateLimitedForFamily(account, family, model) &&
				!this.state.isAccountCoolingDown(account)
			);
		});
		if (available.length > 0) return 0;
		if (enabledAccounts.length === 0) return 0;

		const waitTimes: number[] = [];
		const baseKey = getQuotaKey(family);
		const modelKey = model ? getQuotaKey(family, model) : null;

		for (const account of enabledAccounts) {
			const baseResetAt = account.rateLimitResetTimes[baseKey];
			if (typeof baseResetAt === "number") {
				waitTimes.push(Math.max(0, baseResetAt - now));
			}

			if (modelKey) {
				const modelResetAt = account.rateLimitResetTimes[modelKey];
				if (typeof modelResetAt === "number") {
					waitTimes.push(Math.max(0, modelResetAt - now));
				}
			}

			if (typeof account.coolingDownUntil === "number") {
				waitTimes.push(Math.max(0, account.coolingDownUntil - now));
			}
		}

		return waitTimes.length > 0 ? Math.min(...waitTimes) : 0;
	}
}
