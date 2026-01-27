import type { Auth } from "@opencode-ai/sdk";
import { decodeJWT } from "./auth/auth.js";
import { JWT_CLAIM_PATH } from "./constants.js";
import {
  loadAccounts,
  saveAccounts,
  type AccountStorageV3,
  type CooldownReason,
  type RateLimitStateV3,
} from "./storage.js";
import type { OAuthAuthDetails } from "./types.js";
import { MODEL_FAMILIES, type ModelFamily } from "./prompts/codex.js";
import {
  getHealthTracker,
  getTokenTracker,
  selectHybridAccount,
  type AccountWithMetrics,
} from "./rotation.js";

export type BaseQuotaKey = ModelFamily;
export type QuotaKey = BaseQuotaKey | `${BaseQuotaKey}:${string}`;

export type RateLimitReason = "quota" | "tokens" | "concurrent" | "unknown";

function nowMs(): number {
  return Date.now();
}

function clampNonNegativeInt(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return value < 0 ? 0 : Math.floor(value);
}

function getQuotaKey(family: ModelFamily, model?: string | null): QuotaKey {
  if (model) {
    return `${family}:${model}`;
  }
  return family;
}

/**
 * Extracts the ChatGPT account ID from a JWT access token.
 * @param accessToken - JWT access token from OAuth flow
 * @returns Account ID string or undefined if not found
 */
export function extractAccountId(accessToken?: string): string | undefined {
  if (!accessToken) return undefined;
  const decoded = decodeJWT(accessToken);
  const accountId = decoded?.[JWT_CLAIM_PATH]?.chatgpt_account_id;
  return typeof accountId === "string" && accountId.trim() ? accountId : undefined;
}

/**
 * Extracts the email address from OAuth tokens.
 * Checks id_token first (where OpenAI puts email), then falls back to access_token.
 */
export function extractAccountEmail(accessToken?: string, idToken?: string): string | undefined {
  // Try id_token first - OpenAI puts email here
  if (idToken) {
    const idDecoded = decodeJWT(idToken);
    const idEmail = idDecoded?.email as string | undefined;
    if (typeof idEmail === "string" && idEmail.includes("@") && idEmail.trim()) {
      return idEmail;
    }
  }

  // Fall back to access_token
  if (!accessToken) return undefined;
  const decoded = decodeJWT(accessToken);
  const nested = decoded?.[JWT_CLAIM_PATH] as Record<string, unknown> | undefined;
  const candidate =
    (nested?.email as string | undefined) ??
    (nested?.chatgpt_user_email as string | undefined) ??
    (decoded?.email as string | undefined) ??
    (decoded?.preferred_username as string | undefined);
  if (typeof candidate === "string" && candidate.includes("@") && candidate.trim()) {
    return candidate;
  }
  return undefined;
}

/**
 * Sanitizes an email address by trimming whitespace and lowercasing.
 * @param email - Email string to sanitize
 * @returns Sanitized email or undefined if invalid
 */
export function sanitizeEmail(email: string | undefined): string | undefined {
  if (!email) return undefined;
  const trimmed = email.trim();
  if (!trimmed || !trimmed.includes("@")) return undefined;
  return trimmed.toLowerCase();
}

/**
 * Represents a managed OAuth account with rate limiting and cooldown state.
 */
export interface ManagedAccount {
  index: number;
  accountId?: string;
  email?: string;
  refreshToken: string;
  access?: string;
  expires?: number;
  addedAt: number;
  lastUsed: number;
  lastSwitchReason?: "rate-limit" | "initial" | "rotation";
  lastRateLimitReason?: RateLimitReason;
  rateLimitResetTimes: RateLimitStateV3;
  coolingDownUntil?: number;
  cooldownReason?: CooldownReason;
}

function clearExpiredRateLimits(account: ManagedAccount): void {
  const now = nowMs();
  const keys = Object.keys(account.rateLimitResetTimes);
  for (const key of keys) {
    const resetTime = account.rateLimitResetTimes[key];
    if (resetTime !== undefined && now >= resetTime) {
      delete account.rateLimitResetTimes[key];
    }
  }
}

function isRateLimitedForQuotaKey(account: ManagedAccount, key: QuotaKey): boolean {
  const resetTime = account.rateLimitResetTimes[key];
  return resetTime !== undefined && nowMs() < resetTime;
}

function isRateLimitedForFamily(account: ManagedAccount, family: ModelFamily, model?: string | null): boolean {
  clearExpiredRateLimits(account);

  if (model) {
    const modelKey = getQuotaKey(family, model);
    if (isRateLimitedForQuotaKey(account, modelKey)) {
      return true;
    }
  }

  const baseKey = getQuotaKey(family);
  return isRateLimitedForQuotaKey(account, baseKey);
}

/**
 * Manages multiple OAuth accounts with automatic rotation on rate limits.
 * Tracks per-family active indices, rate limit reset times, and cooldowns.
 */
export class AccountManager {
  private accounts: ManagedAccount[] = [];
  // Per-family cursors for true round-robin rotation
  private cursorByFamily: Record<ModelFamily, number> = {
    "gpt-5.2-codex": 0,
    "codex-max": 0,
    codex: 0,
    "gpt-5.2": 0,
    "gpt-5.1": 0,
  };
  private currentAccountIndexByFamily: Record<ModelFamily, number> = {
    "gpt-5.2-codex": -1,
    "codex-max": -1,
    codex: -1,
    "gpt-5.2": -1,
    "gpt-5.1": -1,
  };
  private lastToastAccountIndex = -1;
  private lastToastTime = 0;
  private saveDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingSave: Promise<void> | null = null;

  /**
   * Loads account manager from disk storage with optional auth fallback.
   * @param authFallback - Current OAuth auth to use if storage is empty
   * @returns New AccountManager instance
   */
  static async loadFromDisk(authFallback?: OAuthAuthDetails): Promise<AccountManager> {
    const stored = await loadAccounts();
    return new AccountManager(authFallback, stored);
  }

  hasRefreshToken(refreshToken: string): boolean {
    return this.accounts.some((account) => account.refreshToken === refreshToken);
  }

  constructor(authFallback?: OAuthAuthDetails, stored?: AccountStorageV3 | null) {
    const fallbackAccountId = extractAccountId(authFallback?.access);
    const fallbackAccountEmail = extractAccountEmail(authFallback?.access);

    if (stored && stored.accounts.length > 0) {
      const baseNow = nowMs();
      this.accounts = stored.accounts
        .map((account, index): ManagedAccount | null => {
          if (!account.refreshToken || typeof account.refreshToken !== "string") {
            return null;
          }

          const matchesFallback =
            !!authFallback &&
            ((fallbackAccountId && account.accountId === fallbackAccountId) ||
              account.refreshToken === authFallback.refresh);

          const refreshToken = matchesFallback && authFallback ? authFallback.refresh : account.refreshToken;
 
           return {
             index,
             accountId: matchesFallback ? fallbackAccountId ?? account.accountId : account.accountId,
             email: matchesFallback
               ? sanitizeEmail(fallbackAccountEmail) ?? sanitizeEmail(account.email)
               : sanitizeEmail(account.email),
             refreshToken,
             access: matchesFallback && authFallback ? authFallback.access : undefined,
             expires: matchesFallback && authFallback ? authFallback.expires : undefined,
             addedAt: clampNonNegativeInt(account.addedAt, baseNow),
             lastUsed: clampNonNegativeInt(account.lastUsed, 0),
            lastSwitchReason: account.lastSwitchReason,
            rateLimitResetTimes: account.rateLimitResetTimes ?? {},
            coolingDownUntil: account.coolingDownUntil,
            cooldownReason: account.cooldownReason,
          };
        })
        .filter((account): account is ManagedAccount => account !== null);

      const hasMatchingFallback =
        !!authFallback &&
        this.accounts.some(
          (account) =>
            account.refreshToken === authFallback.refresh ||
            (fallbackAccountId && account.accountId === fallbackAccountId),
        );

      if (authFallback && !hasMatchingFallback) {
        const now = nowMs();
        this.accounts.push({
          index: this.accounts.length,
          accountId: fallbackAccountId,
          email: sanitizeEmail(fallbackAccountEmail),
          refreshToken: authFallback.refresh,
          access: authFallback.access,
          expires: authFallback.expires,
          addedAt: now,
          lastUsed: now,
          lastSwitchReason: "initial",
          rateLimitResetTimes: {},
        });
      }

      if (this.accounts.length > 0) {
        const defaultIndex = clampNonNegativeInt(stored.activeIndex, 0) % this.accounts.length;

        for (const family of MODEL_FAMILIES) {
          const rawIndex = stored.activeIndexByFamily?.[family];
          const nextIndex = clampNonNegativeInt(rawIndex, defaultIndex) % this.accounts.length;
          this.currentAccountIndexByFamily[family] = nextIndex;
          this.cursorByFamily[family] = nextIndex;
        }
      }
      return;
    }

    if (authFallback) {
      const now = nowMs();
      this.accounts = [
        {
          index: 0,
          accountId: fallbackAccountId,
          email: sanitizeEmail(fallbackAccountEmail),
          refreshToken: authFallback.refresh,
          access: authFallback.access,
          expires: authFallback.expires,
          addedAt: now,
          lastUsed: 0,
          lastSwitchReason: "initial",
          rateLimitResetTimes: {},
        },
      ];
      for (const family of MODEL_FAMILIES) {
        this.currentAccountIndexByFamily[family] = 0;
        this.cursorByFamily[family] = 0;
      }
    }
  }

  getAccountCount(): number {
    return this.accounts.length;
  }

  getActiveIndex(): number {
    return this.getActiveIndexForFamily("codex");
  }

  getActiveIndexForFamily(family: ModelFamily): number {
    const index = this.currentAccountIndexByFamily[family];
    if (index < 0 || index >= this.accounts.length) {
      return this.accounts.length > 0 ? 0 : -1;
    }
    return index;
  }

  getAccountsSnapshot(): ManagedAccount[] {
    return this.accounts.map((account) => ({
      ...account,
      rateLimitResetTimes: { ...account.rateLimitResetTimes },
    }));
  }

  setActiveIndex(index: number): ManagedAccount | null {
    if (!Number.isFinite(index)) return null;
    if (index < 0 || index >= this.accounts.length) return null;
    const account = this.accounts[index];
    if (!account) return null;

    for (const family of MODEL_FAMILIES) {
      this.currentAccountIndexByFamily[family] = index;
      this.cursorByFamily[family] = index;
    }

    account.lastUsed = nowMs();
    account.lastSwitchReason = "rotation";
    return account;
  }

  getCurrentAccount(): ManagedAccount | null {
    return this.getCurrentAccountForFamily("codex");
  }

  getCurrentAccountForFamily(family: ModelFamily): ManagedAccount | null {
    const index = this.currentAccountIndexByFamily[family];
    if (index < 0 || index >= this.accounts.length) {
      return null;
    }
    return this.accounts[index] ?? null;
  }

  getCurrentOrNext(): ManagedAccount | null {
    return this.getCurrentOrNextForFamily("codex");
  }

  getCurrentOrNextForFamily(family: ModelFamily, model?: string | null): ManagedAccount | null {
    const count = this.accounts.length;
    if (count === 0) return null;

    // True round-robin: always advance cursor and pick next available account
    const cursor = this.cursorByFamily[family];
    
    for (let i = 0; i < count; i++) {
      const idx = (cursor + i) % count;
      const account = this.accounts[idx];
      if (!account) continue;
      
      clearExpiredRateLimits(account);
      if (isRateLimitedForFamily(account, family, model) || this.isAccountCoolingDown(account)) {
        continue;
      }
      
      // Found available account - advance cursor for next request
      this.cursorByFamily[family] = (idx + 1) % count;
      this.currentAccountIndexByFamily[family] = idx;
      account.lastUsed = nowMs();
      return account;
    }

    // All accounts blocked
    return null;
  }

  getNextForFamily(family: ModelFamily, model?: string | null): ManagedAccount | null {
    const count = this.accounts.length;
    if (count === 0) return null;

    const cursor = this.cursorByFamily[family];
    
    for (let i = 0; i < count; i++) {
      const idx = (cursor + i) % count;
      const account = this.accounts[idx];
      if (!account) continue;
      
      clearExpiredRateLimits(account);
      if (isRateLimitedForFamily(account, family, model) || this.isAccountCoolingDown(account)) {
        continue;
      }
      
      this.cursorByFamily[family] = (idx + 1) % count;
      account.lastUsed = nowMs();
      return account;
    }

    return null;
  }

  getCurrentOrNextForFamilyHybrid(family: ModelFamily, model?: string | null): ManagedAccount | null {
    const count = this.accounts.length;
    if (count === 0) return null;

    // Preference: If the currently active account for this family is available (not rate-limited, not cooling down),
    // use it directly. This ensures manual switching is respected.
    const currentIndex = this.currentAccountIndexByFamily[family];
    if (currentIndex >= 0 && currentIndex < count) {
      const currentAccount = this.accounts[currentIndex];
      if (currentAccount) {
        clearExpiredRateLimits(currentAccount);
        if (
          !isRateLimitedForFamily(currentAccount, family, model) &&
          !this.isAccountCoolingDown(currentAccount)
        ) {
          currentAccount.lastUsed = nowMs();
          return currentAccount;
        }
      }
    }

    const quotaKey = model ? `${family}:${model}` : family;
    const healthTracker = getHealthTracker();
    const tokenTracker = getTokenTracker();

    const accountsWithMetrics: AccountWithMetrics[] = this.accounts
      .map((account): AccountWithMetrics | null => {
        if (!account) return null;
        clearExpiredRateLimits(account);
        const isAvailable =
          !isRateLimitedForFamily(account, family, model) && !this.isAccountCoolingDown(account);
        return {
          index: account.index,
          isAvailable,
          lastUsed: account.lastUsed,
        };
      })
      .filter((a): a is AccountWithMetrics => a !== null);

    const selected = selectHybridAccount(accountsWithMetrics, healthTracker, tokenTracker, quotaKey);
    if (!selected) return null;

    const account = this.accounts[selected.index];
    if (!account) return null;

    this.currentAccountIndexByFamily[family] = account.index;
    this.cursorByFamily[family] = (account.index + 1) % count;
    account.lastUsed = nowMs();
    return account;
  }

  recordSuccess(account: ManagedAccount, family: ModelFamily, model?: string | null): void {
    const quotaKey = model ? `${family}:${model}` : family;
    const healthTracker = getHealthTracker();
    healthTracker.recordSuccess(account.index, quotaKey);
  }

  recordRateLimit(account: ManagedAccount, family: ModelFamily, model?: string | null): void {
    const quotaKey = model ? `${family}:${model}` : family;
    const healthTracker = getHealthTracker();
    const tokenTracker = getTokenTracker();
    healthTracker.recordRateLimit(account.index, quotaKey);
    tokenTracker.drain(account.index, quotaKey);
  }

  recordFailure(account: ManagedAccount, family: ModelFamily, model?: string | null): void {
    const quotaKey = model ? `${family}:${model}` : family;
    const healthTracker = getHealthTracker();
    healthTracker.recordFailure(account.index, quotaKey);
  }

  markSwitched(account: ManagedAccount, reason: "rate-limit" | "initial" | "rotation", family: ModelFamily): void {
    account.lastSwitchReason = reason;
    this.currentAccountIndexByFamily[family] = account.index;
  }

  markRateLimited(account: ManagedAccount, retryAfterMs: number, family: ModelFamily, model?: string | null): void {
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

  markAccountCoolingDown(account: ManagedAccount, cooldownMs: number, reason: CooldownReason): void {
    const ms = Math.max(0, Math.floor(cooldownMs));
    account.coolingDownUntil = nowMs() + ms;
    account.cooldownReason = reason;
  }

  isAccountCoolingDown(account: ManagedAccount): boolean {
    if (account.coolingDownUntil === undefined) return false;
    if (nowMs() >= account.coolingDownUntil) {
      this.clearAccountCooldown(account);
      return false;
    }
    return true;
  }

  clearAccountCooldown(account: ManagedAccount): void {
    delete account.coolingDownUntil;
    delete account.cooldownReason;
  }

  shouldShowAccountToast(accountIndex: number, debounceMs = 30000): boolean {
    const now = nowMs();
    if (accountIndex === this.lastToastAccountIndex && now - this.lastToastTime < debounceMs) {
      return false;
    }
    return true;
  }

  markToastShown(accountIndex: number): void {
    this.lastToastAccountIndex = accountIndex;
    this.lastToastTime = nowMs();
  }

  updateFromAuth(account: ManagedAccount, auth: OAuthAuthDetails): void {
    account.refreshToken = auth.refresh;
    account.access = auth.access;
    account.expires = auth.expires;
    account.accountId = extractAccountId(auth.access) ?? account.accountId;
    account.email = sanitizeEmail(extractAccountEmail(auth.access)) ?? account.email;
  }

  toAuthDetails(account: ManagedAccount): Auth {
    return {
      type: "oauth",
      access: account.access ?? "",
      refresh: account.refreshToken,
      expires: account.expires ?? 0,
    };
  }

  getMinWaitTime(): number {
    return this.getMinWaitTimeForFamily("codex");
  }

  getMinWaitTimeForFamily(family: ModelFamily, model?: string | null): number {
    const now = nowMs();
    const available = this.accounts.filter((account) => {
      clearExpiredRateLimits(account);
      return !isRateLimitedForFamily(account, family, model) && !this.isAccountCoolingDown(account);
    });
    if (available.length > 0) return 0;

    const waitTimes: number[] = [];
    const baseKey = getQuotaKey(family);
    const modelKey = model ? getQuotaKey(family, model) : null;

    for (const account of this.accounts) {
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

  removeAccount(account: ManagedAccount): boolean {
    const idx = this.accounts.indexOf(account);
    if (idx < 0) {
      return false;
    }

    this.accounts.splice(idx, 1);
    this.accounts.forEach((acc, index) => {
      acc.index = index;
    });

    if (this.accounts.length === 0) {
      for (const family of MODEL_FAMILIES) {
        this.cursorByFamily[family] = 0;
        this.currentAccountIndexByFamily[family] = -1;
      }
      return true;
    }

    const cursor = this.cursorByFamily["codex"];
    if (cursor > idx) {
      for (const family of MODEL_FAMILIES) {
        this.cursorByFamily[family] = Math.max(0, this.cursorByFamily[family] - 1);
      }
    }
    for (const family of MODEL_FAMILIES) {
      this.cursorByFamily[family] = this.cursorByFamily[family] % this.accounts.length;
    }

    for (const family of MODEL_FAMILIES) {
      if (this.currentAccountIndexByFamily[family] > idx) {
        this.currentAccountIndexByFamily[family] -= 1;
      }
      if (this.currentAccountIndexByFamily[family] >= this.accounts.length) {
        this.currentAccountIndexByFamily[family] = -1;
      }
    }

    return true;
  }

  async saveToDisk(): Promise<void> {
    const activeIndexByFamily: Partial<Record<ModelFamily, number>> = {};
    for (const family of MODEL_FAMILIES) {
      const raw = this.currentAccountIndexByFamily[family];
      activeIndexByFamily[family] = clampNonNegativeInt(raw, 0);
    }

    const activeIndex = clampNonNegativeInt(activeIndexByFamily.codex, 0);

    const storage: AccountStorageV3 = {
      version: 3,
      accounts: this.accounts.map((account) => ({
        accountId: account.accountId,
        email: account.email,
        refreshToken: account.refreshToken,
        addedAt: account.addedAt,
        lastUsed: account.lastUsed,
        lastSwitchReason: account.lastSwitchReason,
        rateLimitResetTimes:
          Object.keys(account.rateLimitResetTimes).length > 0 ? account.rateLimitResetTimes : undefined,
        coolingDownUntil: account.coolingDownUntil,
        cooldownReason: account.cooldownReason,
      })),
      activeIndex,
      activeIndexByFamily,
    };

    await saveAccounts(storage);
  }

  saveToDiskDebounced(delayMs = 500): void {
    if (this.saveDebounceTimer) {
      clearTimeout(this.saveDebounceTimer);
    }
    this.saveDebounceTimer = setTimeout(() => {
      this.saveDebounceTimer = null;
      this.pendingSave = this.saveToDisk().finally(() => {
        this.pendingSave = null;
      });
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
}

/**
 * Formats a human-readable label for an account (e.g., "Account 1 (user@email.com)").
 * @param account - Account with optional email and accountId
 * @param index - Zero-based account index
 * @returns Formatted label string
 */
export function formatAccountLabel(
  account: { email?: string; accountId?: string } | undefined,
  index: number,
): string {
  const email = account?.email?.trim();
  const accountId = account?.accountId?.trim();
  const idSuffix = accountId ? (accountId.length > 6 ? accountId.slice(-6) : accountId) : null;

  if (email && idSuffix) return `Account ${index + 1} (${email}, id:${idSuffix})`;
  if (email) return `Account ${index + 1} (${email})`;
  if (idSuffix) return `Account ${index + 1} (${idSuffix})`;
  return `Account ${index + 1}`;
}

/**
 * Formats milliseconds as a human-readable wait time (e.g., "2m 30s").
 * @param ms - Duration in milliseconds
 * @returns Formatted string like "2m 30s" or "45s"
 */
export function formatWaitTime(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

/**
 * Formats cooldown status for an account if currently cooling down.
 * @param account - Account with optional cooldown state
 * @param now - Current timestamp (defaults to Date.now())
 * @returns Formatted cooldown string or null if not cooling down
 */
export function formatCooldown(
  account: { coolingDownUntil?: number; cooldownReason?: string },
  now = nowMs(),
): string | null {
  if (typeof account.coolingDownUntil !== "number") return null;
  const remaining = account.coolingDownUntil - now;
  if (remaining <= 0) return null;
  const reason = account.cooldownReason ? ` (${account.cooldownReason})` : "";
  return `${formatWaitTime(remaining)}${reason}`;
}
