import { describe, it, expect } from "vitest";
import {
  AccountManager,
  extractAccountEmail,
  formatAccountLabel,
} from "../lib/accounts.js";
import type { OAuthAuthDetails } from "../lib/types.js";

describe("AccountManager", () => {
  it("seeds from fallback auth when no storage exists", () => {
    const auth: OAuthAuthDetails = {
      type: "oauth",
      access: "access-token",
      refresh: "refresh-token",
      expires: Date.now() + 60_000,
    };

    const manager = new AccountManager(auth, null);
    expect(manager.getAccountCount()).toBe(1);
    expect(manager.getCurrentAccount()?.refreshToken).toBe("refresh-token");
  });

  it("rotates when the active account is rate-limited", () => {
    const now = Date.now();
    const stored = {
      version: 3 as const,
      activeIndex: 0,
      accounts: [
        {
          refreshToken: "token-1",
          addedAt: now,
          lastUsed: now,
          rateLimitResetTimes: { codex: now + 60_000 },
        },
        {
          refreshToken: "token-2",
          addedAt: now,
          lastUsed: now,
        },
      ],
    };

    const manager = new AccountManager(undefined, stored);
    const account = manager.getCurrentOrNext();
    expect(account?.refreshToken).toBe("token-2");
    expect(manager.getMinWaitTime()).toBe(0);
  });

  it("skips accounts that are cooling down", () => {
    const now = Date.now();
    const stored = {
      version: 3 as const,
      activeIndex: 0,
      accounts: [
        {
          refreshToken: "token-1",
          addedAt: now,
          lastUsed: now,
          coolingDownUntil: now + 60_000,
          cooldownReason: "auth-failure" as const,
        },
        {
          refreshToken: "token-2",
          addedAt: now,
          lastUsed: now,
        },
      ],
    };

    const manager = new AccountManager(undefined, stored);
    const account = manager.getCurrentOrNext();
    expect(account?.refreshToken).toBe("token-2");
    expect(manager.getActiveIndex()).toBe(1);
  });

  it("returns min wait time when all accounts are blocked", () => {
    const now = Date.now();
    const stored = {
      version: 3 as const,
      activeIndex: 0,
      accounts: [
        {
          refreshToken: "token-1",
          addedAt: now,
          lastUsed: now,
          coolingDownUntil: now + 60_000,
          cooldownReason: "network-error" as const,
        },
        {
          refreshToken: "token-2",
          addedAt: now,
          lastUsed: now,
          rateLimitResetTimes: { codex: now + 120_000 },
        },
      ],
    };

    const manager = new AccountManager(undefined, stored);
    const waitMs = manager.getMinWaitTime();
    expect(waitMs).toBeGreaterThan(0);
    expect(waitMs).toBeLessThanOrEqual(60_000);
  });

  it("debounces account toasts for the same account index", () => {
    const now = Date.now();
    const stored = {
      version: 3 as const,
      activeIndex: 0,
      accounts: [
        {
          refreshToken: "token-1",
          addedAt: now,
          lastUsed: now,
        },
        {
          refreshToken: "token-2",
          addedAt: now,
          lastUsed: now,
        },
      ],
    };

    const manager = new AccountManager(undefined, stored);
    expect(manager.shouldShowAccountToast(0, 60_000)).toBe(true);
    manager.markToastShown(0);
    expect(manager.shouldShowAccountToast(0, 60_000)).toBe(false);
    expect(manager.shouldShowAccountToast(1, 60_000)).toBe(true);
  });

  it("extracts email from jwt when present", () => {
    const payload = Buffer.from(JSON.stringify({ email: "user@example.com" })).toString(
      "base64",
    );
    const token = `header.${payload}.signature`;
    expect(extractAccountEmail(token)).toBe("user@example.com");
  });

  it("formats account label preferring email and id suffix", () => {
    expect(formatAccountLabel({ email: "user@example.com", accountId: "abcdef123456" }, 0)).toBe(
      "Account 1 (user@example.com, id:123456)",
    );
    expect(formatAccountLabel({ email: "user@example.com" }, 1)).toBe("Account 2 (user@example.com)");
    expect(formatAccountLabel({ accountId: "abcdef123456" }, 2)).toBe("Account 3 (123456)");
    expect(formatAccountLabel(undefined as any, 3)).toBe("Account 4");
  });

  it("performs true round-robin rotation across multiple requests", () => {
    const now = Date.now();
    const stored = {
      version: 3 as const,
      activeIndex: 0,
      accounts: [
        { refreshToken: "token-1", addedAt: now, lastUsed: now },
        { refreshToken: "token-2", addedAt: now, lastUsed: now },
        { refreshToken: "token-3", addedAt: now, lastUsed: now },
      ],
    };

    const manager = new AccountManager(undefined, stored);
    
    const first = manager.getCurrentOrNext();
    const second = manager.getCurrentOrNext();
    const third = manager.getCurrentOrNext();
    const fourth = manager.getCurrentOrNext();

    expect(first?.refreshToken).toBe("token-1");
    expect(second?.refreshToken).toBe("token-2");
    expect(third?.refreshToken).toBe("token-3");
    expect(fourth?.refreshToken).toBe("token-1");
  });

  it("skips rate-limited accounts during rotation", () => {
    const now = Date.now();
    const stored = {
      version: 3 as const,
      activeIndex: 0,
      accounts: [
        { refreshToken: "token-1", addedAt: now, lastUsed: now },
        { refreshToken: "token-2", addedAt: now, lastUsed: now, rateLimitResetTimes: { codex: now + 60_000 } },
        { refreshToken: "token-3", addedAt: now, lastUsed: now },
      ],
    };

    const manager = new AccountManager(undefined, stored);
    
    const first = manager.getCurrentOrNext();
    const second = manager.getCurrentOrNext();
    const third = manager.getCurrentOrNext();

    expect(first?.refreshToken).toBe("token-1");
    expect(second?.refreshToken).toBe("token-3");
    expect(third?.refreshToken).toBe("token-1");
  });

  it("uses independent cursors per model family", () => {
    const now = Date.now();
    const stored = {
      version: 3 as const,
      activeIndex: 0,
      accounts: [
        { refreshToken: "token-1", addedAt: now, lastUsed: now },
        { refreshToken: "token-2", addedAt: now, lastUsed: now },
      ],
    };

    const manager = new AccountManager(undefined, stored);
    
    const codexFirst = manager.getCurrentOrNextForFamily("codex");
    const gpt51First = manager.getCurrentOrNextForFamily("gpt-5.1");
    const codexSecond = manager.getCurrentOrNextForFamily("codex");
    const gpt51Second = manager.getCurrentOrNextForFamily("gpt-5.1");

    expect(codexFirst?.refreshToken).toBe("token-1");
    expect(gpt51First?.refreshToken).toBe("token-1");
    expect(codexSecond?.refreshToken).toBe("token-2");
    expect(gpt51Second?.refreshToken).toBe("token-2");
  });

  it("hybrid selection prefers active index when available", () => {
    const now = Date.now();
    const stored = {
      version: 3 as const,
      activeIndex: 1, // Set active index to second account
      activeIndexByFamily: { codex: 1 },
      accounts: [
        { refreshToken: "token-1", addedAt: now, lastUsed: 0 }, // Very stale (high freshness score)
        { refreshToken: "token-2", addedAt: now, lastUsed: now }, // Just used (low freshness score)
      ],
    };

    const manager = new AccountManager(undefined, stored as any);
    
    // Even though token-1 has better freshness score, token-2 is active and available
    const selected = manager.getCurrentOrNextForFamilyHybrid("codex");
    expect(selected?.refreshToken).toBe("token-2");
    expect(selected?.index).toBe(1);
  });

  describe("removeAccount", () => {
    it("removes an account and updates indices", () => {
      const now = Date.now();
      const stored = {
        version: 3 as const,
        activeIndex: 1,
        accounts: [
          { refreshToken: "token-1", addedAt: now, lastUsed: now },
          { refreshToken: "token-2", addedAt: now, lastUsed: now },
          { refreshToken: "token-3", addedAt: now, lastUsed: now },
        ],
      };

      const manager = new AccountManager(undefined, stored);
      expect(manager.getAccountCount()).toBe(3);
      
      const accountToRemove = manager.getCurrentAccount();
      expect(accountToRemove).toBeDefined();
      expect(accountToRemove?.refreshToken).toBe("token-2");
      
      const removed = manager.removeAccount(accountToRemove!);
      expect(removed).toBe(true);
      expect(manager.getAccountCount()).toBe(2);
      
      const remaining = manager.getAccountsSnapshot();
      expect(remaining[0]?.refreshToken).toBe("token-1");
      expect(remaining[1]?.refreshToken).toBe("token-3");
      expect(remaining[0]?.index).toBe(0);
      expect(remaining[1]?.index).toBe(1);
    });

    it("returns false when removing non-existent account", () => {
      const now = Date.now();
      const stored = {
        version: 3 as const,
        activeIndex: 0,
        accounts: [
          { refreshToken: "token-1", addedAt: now, lastUsed: now },
        ],
      };

      const manager = new AccountManager(undefined, stored);
      const fakeAccount = {
        index: 999,
        refreshToken: "non-existent",
        addedAt: now,
        lastUsed: now,
        rateLimitResetTimes: {},
      };
      
      const removed = manager.removeAccount(fakeAccount as any);
      expect(removed).toBe(false);
      expect(manager.getAccountCount()).toBe(1);
    });

    it("handles removing the last account", () => {
      const now = Date.now();
      const stored = {
        version: 3 as const,
        activeIndex: 0,
        accounts: [
          { refreshToken: "token-1", addedAt: now, lastUsed: now },
        ],
      };

      const manager = new AccountManager(undefined, stored);
      const account = manager.getCurrentAccount();
      expect(account).not.toBe(null);
      
      const removed = manager.removeAccount(account!);
      expect(removed).toBe(true);
      expect(manager.getAccountCount()).toBe(0);
      expect(manager.getCurrentAccount()).toBe(null);
    });
  });
});
