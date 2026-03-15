import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  AccountManager,
  extractAccountEmail,
  formatAccountLabel,
  parseRateLimitReason,
  sanitizeEmail,
  formatWaitTime,
  formatCooldown,
  shouldUpdateAccountIdFromToken,
  getAccountIdCandidates,
} from "../lib/accounts.js";
import { getHealthTracker, getTokenTracker, resetTrackers } from "../lib/rotation.js";
import type { OAuthAuthDetails } from "../lib/types.js";

const { accountLoggerWarn } = vi.hoisted(() => ({
  accountLoggerWarn: vi.fn(),
}));

vi.mock("../lib/storage.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/storage.js")>();
  return {
    ...actual,
    saveAccounts: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock("../lib/logger.js", () => ({
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: accountLoggerWarn,
    error: vi.fn(),
    time: vi.fn(() => vi.fn(() => 0)),
    timeEnd: vi.fn(),
  })),
}));

beforeEach(() => {
  accountLoggerWarn.mockClear();
});

describe("parseRateLimitReason", () => {
  it("returns quota for quota-related codes", () => {
    expect(parseRateLimitReason("usage_limit_reached")).toBe("quota");
    expect(parseRateLimitReason("QUOTA_EXCEEDED")).toBe("quota");
    expect(parseRateLimitReason("monthly_quota_limit")).toBe("quota");
  });

  it("returns tokens for token-related codes", () => {
    expect(parseRateLimitReason("tpm_limit")).toBe("tokens");
    expect(parseRateLimitReason("rpm_exceeded")).toBe("tokens");
    expect(parseRateLimitReason("token_limit_reached")).toBe("tokens");
    expect(parseRateLimitReason("TPM_RATE_LIMIT")).toBe("tokens");
  });

  it("returns concurrent for concurrency codes", () => {
    expect(parseRateLimitReason("concurrent_limit")).toBe("concurrent");
    expect(parseRateLimitReason("parallel_requests_exceeded")).toBe("concurrent");
  });

  it("returns unknown for undefined", () => {
    expect(parseRateLimitReason(undefined)).toBe("unknown");
  });

  it("returns unknown for unrecognized codes", () => {
    expect(parseRateLimitReason("some_other_error")).toBe("unknown");
    expect(parseRateLimitReason("random_code")).toBe("unknown");
  });
});

describe("sanitizeEmail", () => {
  it("returns undefined for undefined/null", () => {
    expect(sanitizeEmail(undefined)).toBeUndefined();
  });

  it("returns undefined for empty string", () => {
    expect(sanitizeEmail("")).toBeUndefined();
    expect(sanitizeEmail("   ")).toBeUndefined();
  });

  it("returns undefined for string without @", () => {
    expect(sanitizeEmail("notanemail")).toBeUndefined();
  });

  it("trims and lowercases valid email", () => {
    expect(sanitizeEmail("  User@Example.COM  ")).toBe("user@example.com");
  });

  it("preserves valid email structure", () => {
    expect(sanitizeEmail("test@domain.org")).toBe("test@domain.org");
  });
});

describe("formatWaitTime", () => {
  it("formats zero as 0s", () => {
    expect(formatWaitTime(0)).toBe("0s");
  });

  it("formats negative as 0s", () => {
    expect(formatWaitTime(-1000)).toBe("0s");
  });

  it("formats seconds only when less than 60s", () => {
    expect(formatWaitTime(45000)).toBe("45s");
    expect(formatWaitTime(1000)).toBe("1s");
  });

  it("formats minutes and seconds when 60s or more", () => {
    expect(formatWaitTime(60000)).toBe("1m 0s");
    expect(formatWaitTime(150000)).toBe("2m 30s");
    expect(formatWaitTime(3600000)).toBe("60m 0s");
  });

  it("rounds down partial seconds", () => {
    expect(formatWaitTime(45500)).toBe("45s");
    expect(formatWaitTime(150999)).toBe("2m 30s");
  });
});

describe("formatCooldown", () => {
  it("returns null when coolingDownUntil is undefined", () => {
    expect(formatCooldown({})).toBeNull();
  });

  it("returns null when cooldown has expired", () => {
    const now = Date.now();
    expect(formatCooldown({ coolingDownUntil: now - 1000 }, now)).toBeNull();
    expect(formatCooldown({ coolingDownUntil: now }, now)).toBeNull();
  });

  it("returns formatted time when cooling down", () => {
    const now = Date.now();
    const result = formatCooldown({ coolingDownUntil: now + 30000 }, now);
    expect(result).toBe("30s");
  });

  it("includes reason when present", () => {
    const now = Date.now();
    const result = formatCooldown(
      { coolingDownUntil: now + 60000, cooldownReason: "auth-failure" },
      now,
    );
    expect(result).toBe("1m 0s (auth-failure)");
  });

  it("formats minutes and seconds with reason", () => {
    const now = Date.now();
    const result = formatCooldown(
      { coolingDownUntil: now + 150000, cooldownReason: "network-error" },
      now,
    );
    expect(result).toBe("2m 30s (network-error)");
  });
});

describe("shouldUpdateAccountIdFromToken", () => {
  it("returns true when currentAccountId is undefined", () => {
    expect(shouldUpdateAccountIdFromToken("token", undefined)).toBe(true);
  });

  it("returns true when source is undefined", () => {
    expect(shouldUpdateAccountIdFromToken(undefined, "account-123")).toBe(true);
  });

  it("returns true when source is token", () => {
    expect(shouldUpdateAccountIdFromToken("token", "account-123")).toBe(true);
  });

  it("returns true when source is id_token", () => {
    expect(shouldUpdateAccountIdFromToken("id_token", "account-123")).toBe(true);
  });

  it("returns false when source is org (manual selection)", () => {
    expect(shouldUpdateAccountIdFromToken("org", "account-123")).toBe(false);
  });

  it("returns false when source is manual", () => {
    expect(shouldUpdateAccountIdFromToken("manual", "account-123")).toBe(false);
  });
});

describe("getAccountIdCandidates", () => {
  it("returns empty array when no tokens provided", () => {
    expect(getAccountIdCandidates()).toEqual([]);
  });

  it("extracts account from access token", () => {
    // Create a JWT with account_id in the claim path
    const payload = {
      "https://api.openai.com/auth": {
        chatgpt_account_id: "test-account-123",
      },
    };
    const token = `header.${Buffer.from(JSON.stringify(payload)).toString("base64")}.signature`;
    const candidates = getAccountIdCandidates(token);
    expect(candidates.length).toBeGreaterThanOrEqual(1);
    expect(candidates[0]?.accountId).toBe("test-account-123");
    expect(candidates[0]?.source).toBe("token");
    expect(candidates[0]?.isDefault).toBe(true);
  });

  it("extracts email from id_token when present", () => {
    const idPayload = { email: "user@example.com" };
    const idToken = `header.${Buffer.from(JSON.stringify(idPayload)).toString("base64")}.signature`;
    const email = extractAccountEmail(undefined, idToken);
    expect(email).toBe("user@example.com");
  });
});

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

  it("formats account label with accountLabel variations", () => {
    expect(formatAccountLabel({ accountLabel: "Work" }, 0)).toBe("Account 1 (Work)");
    expect(formatAccountLabel({ accountLabel: "Work", email: "work@co.com" }, 0)).toBe("Account 1 (Work, work@co.com)");
    expect(formatAccountLabel({ accountLabel: "Work", accountId: "abcdef123456" }, 0)).toBe("Account 1 (Work, id:123456)");
    expect(formatAccountLabel({ accountLabel: "Work", email: "work@co.com", accountId: "abcdef123456" }, 0)).toBe("Account 1 (Work, work@co.com, id:123456)");
  });

  it("formats account label with short accountId", () => {
    expect(formatAccountLabel({ accountId: "abc" }, 0)).toBe("Account 1 (abc)");
    expect(formatAccountLabel({ accountId: "123456" }, 0)).toBe("Account 1 (123456)");
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

  it("selects usable variant when refresh-token siblings are blocked", () => {
    const now = Date.now();
    const stored = {
      version: 3 as const,
      activeIndex: 0,
      accounts: [
        {
          refreshToken: "shared-refresh",
          accountId: "workspace-disabled",
          addedAt: now,
          lastUsed: now,
          enabled: false,
        },
        {
          refreshToken: "shared-refresh",
          accountId: "workspace-rate-limited",
          addedAt: now,
          lastUsed: now,
          rateLimitResetTimes: { codex: now + 60_000 },
        },
        {
          refreshToken: "shared-refresh",
          accountId: "workspace-cooling-down",
          addedAt: now,
          lastUsed: now,
          coolingDownUntil: now + 60_000,
          cooldownReason: "network-error" as const,
        },
        {
          refreshToken: "shared-refresh",
          accountId: "workspace-usable",
          addedAt: now,
          lastUsed: now,
        },
      ],
    };

    const manager = new AccountManager(undefined, stored);
    const selected = manager.getCurrentOrNextForFamily("codex");

    expect(selected?.accountId).toBe("workspace-usable");
    expect(selected?.refreshToken).toBe("shared-refresh");
  });

  it("returns null and preserves min-wait behavior when all shared-token variants are blocked", () => {
    const now = Date.now();
    const stored = {
      version: 3 as const,
      activeIndex: 0,
      accounts: [
        {
          refreshToken: "shared-refresh",
          accountId: "workspace-disabled",
          addedAt: now,
          lastUsed: now,
          enabled: false,
        },
        {
          refreshToken: "shared-refresh",
          accountId: "workspace-rate-limited",
          addedAt: now,
          lastUsed: now,
          rateLimitResetTimes: { codex: now + 120_000 },
        },
        {
          refreshToken: "shared-refresh",
          accountId: "workspace-cooling-down",
          addedAt: now,
          lastUsed: now,
          coolingDownUntil: now + 30_000,
          cooldownReason: "auth-failure" as const,
        },
      ],
    };

    const manager = new AccountManager(undefined, stored);

    expect(manager.getCurrentOrNextForFamily("codex")).toBeNull();

    const minWait = manager.getMinWaitTimeForFamily("codex");
    expect(minWait).toBeGreaterThan(0);
    expect(minWait).toBeLessThanOrEqual(30_000);
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
    // Note: Tests in this block cover in-memory manager behavior.
    // No-org duplicates collapse only when accountId is same/missing; distinct accountId entries are preserved.
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

    it("removes only targeted workspace when email/token are shared (manager-level, no orgId)", () => {
      // Note: In-memory manager can hold multiple entries; canonical dedupe would collapse no-org duplicates only when accountId is same/missing
      const now = Date.now();
      const stored = {
        version: 3 as const,
        activeIndex: 0,
        accounts: [
          {
            refreshToken: "shared-refresh",
            email: "user@example.com",
            accountId: "workspace-a",
            addedAt: now,
            lastUsed: now,
          },
          {
            refreshToken: "shared-refresh",
            email: "user@example.com",
            accountId: "workspace-b",
            addedAt: now,
            lastUsed: now,
          },
        ],
      };

      const manager = new AccountManager(undefined, stored);
      expect(manager.getAccountCount()).toBe(2);

      const second = manager.setActiveIndex(1);
      expect(second?.accountId).toBe("workspace-b");

      const removed = manager.removeAccount(second!);
      expect(removed).toBe(true);
      expect(manager.getAccountCount()).toBe(1);
      expect(manager.getAccountsSnapshot()[0]?.accountId).toBe("workspace-a");
      expect(manager.getActiveIndex()).toBe(0);
    });
  });

  describe("hasRefreshToken", () => {
    it("returns true when token exists", () => {
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
      expect(manager.hasRefreshToken("token-1")).toBe(true);
      expect(manager.hasRefreshToken("token-2")).toBe(true);
    });

    it("returns false when token does not exist", () => {
      const now = Date.now();
      const stored = {
        version: 3 as const,
        activeIndex: 0,
        accounts: [
          { refreshToken: "token-1", addedAt: now, lastUsed: now },
        ],
      };

      const manager = new AccountManager(undefined, stored);
      expect(manager.hasRefreshToken("non-existent")).toBe(false);
      expect(manager.hasRefreshToken("")).toBe(false);
    });
  });

  describe("markRateLimitedWithReason", () => {
    it("marks account as rate limited with reason", () => {
      const now = Date.now();
      const stored = {
        version: 3 as const,
        activeIndex: 0,
        accounts: [
          { refreshToken: "token-1", addedAt: now, lastUsed: now },
        ],
      };

      const manager = new AccountManager(undefined, stored);
      const account = manager.getCurrentAccount()!;
      manager.markRateLimitedWithReason(account, 60000, "codex", "quota");
      
      expect(account.lastRateLimitReason).toBe("quota");
      expect(account.rateLimitResetTimes["codex"]).toBeDefined();
    });

    it("marks both base and model-specific keys", () => {
      const now = Date.now();
      const stored = {
        version: 3 as const,
        activeIndex: 0,
        accounts: [
          { refreshToken: "token-1", addedAt: now, lastUsed: now },
        ],
      };

      const manager = new AccountManager(undefined, stored);
      const account = manager.getCurrentAccount()!;
      manager.markRateLimitedWithReason(account, 60000, "codex", "tokens", "gpt-5.2");
      
      expect(account.rateLimitResetTimes["codex"]).toBeDefined();
      expect(account.rateLimitResetTimes["codex:gpt-5.2"]).toBeDefined();
    });
  });

  describe("cooldown management", () => {
    it("marks account as cooling down", () => {
      const now = Date.now();
      const stored = {
        version: 3 as const,
        activeIndex: 0,
        accounts: [
          { refreshToken: "token-1", addedAt: now, lastUsed: now },
        ],
      };

      const manager = new AccountManager(undefined, stored);
      const account = manager.getCurrentAccount()!;
      manager.markAccountCoolingDown(account, 30000, "auth-failure");
      
      expect(manager.isAccountCoolingDown(account)).toBe(true);
      expect(account.cooldownReason).toBe("auth-failure");
    });

    it("clears cooldown when time expires", () => {
      const now = Date.now();
      const stored = {
        version: 3 as const,
        activeIndex: 0,
        accounts: [
          { refreshToken: "token-1", addedAt: now, lastUsed: now, coolingDownUntil: now - 1000 },
        ],
      };

      const manager = new AccountManager(undefined, stored);
      const account = manager.getCurrentAccount()!;
      expect(manager.isAccountCoolingDown(account)).toBe(false);
    });

    it("clears cooldown manually", () => {
      const now = Date.now();
      const stored = {
        version: 3 as const,
        activeIndex: 0,
        accounts: [
          { refreshToken: "token-1", addedAt: now, lastUsed: now },
        ],
      };

      const manager = new AccountManager(undefined, stored);
      const account = manager.getCurrentAccount()!;
      manager.markAccountCoolingDown(account, 30000, "network-error");
      expect(manager.isAccountCoolingDown(account)).toBe(true);
      
      manager.clearAccountCooldown(account);
      expect(manager.isAccountCoolingDown(account)).toBe(false);
      expect(account.cooldownReason).toBeUndefined();
    });
  });

  describe("auth failure tracking", () => {
    it("increments consecutive auth failures", () => {
      const now = Date.now();
      const stored = {
        version: 3 as const,
        activeIndex: 0,
        accounts: [
          { refreshToken: "token-1", addedAt: now, lastUsed: now },
        ],
      };

      const manager = new AccountManager(undefined, stored);
      const account = manager.getCurrentAccount()!;
      
      expect(manager.incrementAuthFailures(account)).toBe(1);
      expect(manager.incrementAuthFailures(account)).toBe(2);
      expect(manager.incrementAuthFailures(account)).toBe(3);
    });

    it("clears auth failures", () => {
      const now = Date.now();
      const stored = {
        version: 3 as const,
        activeIndex: 0,
        accounts: [
          { refreshToken: "token-1", addedAt: now, lastUsed: now },
        ],
      };

      const manager = new AccountManager(undefined, stored);
      const account = manager.getCurrentAccount()!;

      // Increment failures twice
      expect(manager.incrementAuthFailures(account)).toBe(1);
      expect(manager.incrementAuthFailures(account)).toBe(2);

      // Clear failures
      manager.clearAuthFailures(account);

      // After clearing, increment should start from 0 (returning 1)
      expect(manager.incrementAuthFailures(account)).toBe(1);
    });

    it("tracks failures per refreshToken across multiple accounts", () => {
      const now = Date.now();
      const stored = {
        version: 3 as const,
        activeIndex: 0,
        accounts: [
          { refreshToken: "token-1", addedAt: now, lastUsed: now }, // base account
          { refreshToken: "token-1", organizationId: "org-1", addedAt: now, lastUsed: now }, // org variant 1
          { refreshToken: "token-1", organizationId: "org-2", addedAt: now, lastUsed: now }, // org variant 2
          { refreshToken: "token-2", addedAt: now, lastUsed: now }, // different token
        ],
      };

      const manager = new AccountManager(undefined, stored);
      const accounts = manager.getAccountsSnapshot();
      expect(accounts).toHaveLength(4);
      const account1 = accounts[0];
      const account2 = accounts[1];
      const account3 = accounts[2];
      const account4 = accounts[3];

      // Increment failures on first account (token-1)
      expect(manager.incrementAuthFailures(account1)).toBe(1);
      expect(manager.incrementAuthFailures(account2)).toBe(2);
      expect(manager.incrementAuthFailures(account3)).toBe(3);

      // Different token should start from 0
      expect(manager.incrementAuthFailures(account4)).toBe(1);
    });

    it("removes all accounts with the same refreshToken", () => {
      const now = Date.now();
      const stored = {
        version: 3 as const,
        activeIndex: 0,
        accounts: [
          { refreshToken: "token-1", addedAt: now, lastUsed: now }, // base account
          { refreshToken: "token-1", organizationId: "org-1", addedAt: now, lastUsed: now }, // org variant 1
          { refreshToken: "token-1", organizationId: "org-2", addedAt: now, lastUsed: now }, // org variant 2
          { refreshToken: "token-2", addedAt: now, lastUsed: now }, // different token
        ],
      };

      const manager = new AccountManager(undefined, stored);
      expect(manager.getAccountCount()).toBe(4);

      const accounts = manager.getAccountsSnapshot();
      expect(accounts).toHaveLength(4);
      const account1 = accounts[0];
      const removedCount = manager.removeAccountsWithSameRefreshToken(account1);

      // Should remove 3 accounts with token-1
      expect(removedCount).toBe(3);
      expect(manager.getAccountCount()).toBe(1);
      expect(manager.getAccountsSnapshot()[0].refreshToken).toBe("token-2");
    });

    it("disables all accounts with the same refreshToken", () => {
      const now = Date.now();
      const stored = {
        version: 3 as const,
        activeIndex: 0,
        accounts: [
          { refreshToken: "token-1", addedAt: now, lastUsed: now },
          { refreshToken: "token-1", organizationId: "org-1", addedAt: now, lastUsed: now },
          { refreshToken: "token-1", organizationId: "org-2", addedAt: now, lastUsed: now },
          { refreshToken: "token-2", addedAt: now, lastUsed: now },
        ],
      };

      const manager = new AccountManager(undefined, stored);
      const accounts = manager.getAccountsSnapshot();
      expect(accounts).toHaveLength(4);

      const disabledCount = manager.disableAccountsWithSameRefreshToken(accounts[0]);
      expect(disabledCount).toBe(3);
      expect(manager.getAccountCount()).toBe(4);

      const updated = manager.getAccountsSnapshot();
      expect(updated.slice(0, 3).every((account) => account.enabled === false)).toBe(true);
      expect(updated.slice(0, 3).every((account) => account.disabledReason === "auth-failure")).toBe(true);
      expect(updated[3]?.enabled).not.toBe(false);
    });

    it("preserves a manual disable reason when auth-failure disabling sibling variants", () => {
      const now = Date.now();
      const stored = {
        version: 3 as const,
        activeIndex: 0,
        accounts: [
          { refreshToken: "token-1", accountId: "workspace-a", addedAt: now, lastUsed: now },
          {
            refreshToken: "token-1",
            accountId: "workspace-user-disabled",
            enabled: false,
            disabledReason: "user" as const,
            coolingDownUntil: now + 60_000,
            cooldownReason: "network-error" as const,
            addedAt: now,
            lastUsed: now,
          },
          { refreshToken: "token-1", accountId: "workspace-b", addedAt: now, lastUsed: now },
        ],
      };

      const manager = new AccountManager(undefined, stored);
      const accounts = manager.getAccountsSnapshot();
      const disabledCount = manager.disableAccountsWithSameRefreshToken(accounts[0]);

      expect(disabledCount).toBe(2);
      const updated = manager.getAccountsSnapshot();
      expect(updated[0]).toMatchObject({
        accountId: "workspace-a",
        enabled: false,
        disabledReason: "auth-failure",
      });
      expect(updated[1]).toMatchObject({
        accountId: "workspace-user-disabled",
        enabled: false,
        disabledReason: "user",
        coolingDownUntil: now + 60_000,
        cooldownReason: "network-error",
      });
      expect(updated[2]).toMatchObject({
        accountId: "workspace-b",
        enabled: false,
        disabledReason: "auth-failure",
      });
    });

    it("defaults legacy disabled accounts to a user disable reason", async () => {
      const { saveAccounts } = await import("../lib/storage.js");
      const mockSaveAccounts = vi.mocked(saveAccounts);
      mockSaveAccounts.mockClear();
      mockSaveAccounts.mockResolvedValueOnce();

      const now = Date.now();
      const stored = {
        version: 3 as const,
        activeIndex: 0,
        accounts: [
          {
            refreshToken: "token-1",
            enabled: false,
            addedAt: now,
            lastUsed: now,
          },
        ],
      };

      const manager = new AccountManager(undefined, stored);

      expect(manager.getAccountsSnapshot()[0]).toMatchObject({
        enabled: false,
        disabledReason: "user",
      });

      await manager.saveToDisk();

      expect(mockSaveAccounts).toHaveBeenCalledWith(
        expect.objectContaining({
          accounts: [
            expect.objectContaining({
              enabled: false,
              disabledReason: "user",
            }),
          ],
        }),
      );
    });

    it("clears auth failure counter when removing accounts with same refreshToken", () => {
      const now = Date.now();
      const stored = {
        version: 3 as const,
        activeIndex: 0,
        accounts: [
          { refreshToken: "token-1", addedAt: now, lastUsed: now }, // base account
          { refreshToken: "token-1", organizationId: "org-1", addedAt: now, lastUsed: now }, // org variant
        ],
      };

      const manager = new AccountManager(undefined, stored);
      const accounts = manager.getAccountsSnapshot();
      expect(accounts).toHaveLength(2);
      const account1 = accounts[0];

      // Increment auth failures for token-1
      expect(manager.incrementAuthFailures(account1)).toBe(1);
      expect(manager.incrementAuthFailures(account1)).toBe(2);
      expect(manager.incrementAuthFailures(accounts[1])).toBe(3);

      // Verify failures are tracked
      expect(manager.incrementAuthFailures(account1)).toBe(4);

      // Remove all accounts with token-1
      const removedCount = manager.removeAccountsWithSameRefreshToken(account1);
      expect(removedCount).toBe(2);
      expect(manager.getAccountCount()).toBe(0);
      expect(manager.incrementAuthFailures(account1)).toBe(1);
    });

    it("clears auth failure counter when disabling accounts with same refreshToken", () => {
      const now = Date.now();
      const stored = {
        version: 3 as const,
        activeIndex: 0,
        accounts: [
          {
            refreshToken: "token-1",
            coolingDownUntil: now + 60_000,
            cooldownReason: "auth-failure" as const,
            addedAt: now,
            lastUsed: now,
          },
          {
            refreshToken: "token-1",
            organizationId: "org-1",
            coolingDownUntil: now + 60_000,
            cooldownReason: "auth-failure" as const,
            addedAt: now,
            lastUsed: now,
          },
        ],
      };

      const manager = new AccountManager(undefined, stored);
      const accounts = manager.getAccountsSnapshot();
      expect(accounts).toHaveLength(2);

      expect(manager.incrementAuthFailures(accounts[0])).toBe(1);
      expect(manager.incrementAuthFailures(accounts[1])).toBe(2);
      expect(manager.incrementAuthFailures(accounts[0])).toBe(3);

      const disabledCount = manager.disableAccountsWithSameRefreshToken(accounts[0]);
      expect(disabledCount).toBe(2);
      expect(manager.getAccountsSnapshot().every((account) => account.enabled === false)).toBe(true);
      expect(
        manager.getAccountsSnapshot().every((account) => account.disabledReason === "auth-failure"),
      ).toBe(true);
      expect(
        manager.getAccountsSnapshot().every((account) => account.coolingDownUntil === undefined),
      ).toBe(true);
      expect(
        manager.getAccountsSnapshot().every((account) => account.cooldownReason === undefined),
      ).toBe(true);
      expect(manager.incrementAuthFailures(accounts[0])).toBe(1);
    });

    it("clears auth failure counter even when matching accounts were already user-disabled", () => {
      const now = Date.now();
      const stored = {
        version: 3 as const,
        activeIndex: 0,
        accounts: [
          {
            refreshToken: "token-1",
            accountId: "workspace-a",
            enabled: false,
            disabledReason: "user" as const,
            coolingDownUntil: now + 60_000,
            cooldownReason: "network-error" as const,
            addedAt: now,
            lastUsed: now,
          },
          {
            refreshToken: "token-1",
            accountId: "workspace-b",
            enabled: false,
            disabledReason: "user" as const,
            addedAt: now,
            lastUsed: now,
          },
        ],
      };

      const manager = new AccountManager(undefined, stored);
      const accounts = manager.getAccountsSnapshot();

      expect(manager.incrementAuthFailures(accounts[0])).toBe(1);
      expect(manager.incrementAuthFailures(accounts[1])).toBe(2);

      const disabledCount = manager.disableAccountsWithSameRefreshToken(accounts[0]);
      expect(disabledCount).toBe(0);
      expect(manager.getAccountsSnapshot()).toMatchObject([
        {
          accountId: "workspace-a",
          enabled: false,
          disabledReason: "user",
          coolingDownUntil: now + 60_000,
          cooldownReason: "network-error",
        },
        {
          accountId: "workspace-b",
          enabled: false,
          disabledReason: "user",
        },
      ]);
      expect(manager.incrementAuthFailures(accounts[0])).toBe(1);
    });

    it("records disable reason when setAccountEnabled disables an account", () => {
      const now = Date.now();
      const stored = {
        version: 3 as const,
        activeIndex: 0,
        accounts: [
          {
            refreshToken: "token-1",
            coolingDownUntil: now + 60_000,
            cooldownReason: "network-error" as const,
            addedAt: now,
            lastUsed: now,
          },
        ],
      };

      const manager = new AccountManager(undefined, stored);

      const disabled = manager.trySetAccountEnabled(0, false, "user");
      expect(disabled).toMatchObject({
        ok: true,
        account: {
          enabled: false,
          disabledReason: "user",
        },
      });

      const reenabled = manager.trySetAccountEnabled(0, true);
      expect(reenabled).toMatchObject({
        ok: true,
        account: {
          enabled: true,
        },
      });
      if (!reenabled.ok) {
        throw new Error("expected setAccountEnabled to re-enable account");
      }
      expect(reenabled.account.disabledReason).toBeUndefined();
      expect(reenabled.account.coolingDownUntil).toBeUndefined();
      expect(reenabled.account.cooldownReason).toBeUndefined();
    });

    it("defaults disable reason to user when disabling without an explicit reason", () => {
      const now = Date.now();
      const stored = {
        version: 3 as const,
        activeIndex: 0,
        accounts: [
          { refreshToken: "token-1", addedAt: now, lastUsed: now },
        ],
      };

      const manager = new AccountManager(undefined, stored);

      const disabled = manager.trySetAccountEnabled(0, false);
      expect(disabled).toMatchObject({
        ok: true,
        account: {
          enabled: false,
          disabledReason: "user",
        },
      });
    });

    it("preserves auth-failure disabledReason when disabling without an explicit reason", () => {
      const now = Date.now();
      const stored = {
        version: 3 as const,
        activeIndex: 0,
        accounts: [
          {
            refreshToken: "token-1",
            enabled: false,
            disabledReason: "auth-failure" as const,
            addedAt: now,
            lastUsed: now,
          },
        ],
      };

      const manager = new AccountManager(undefined, stored);

      const disabled = manager.trySetAccountEnabled(0, false);
      expect(disabled).toMatchObject({
        ok: true,
        account: {
          enabled: false,
          disabledReason: "auth-failure",
        },
      });
    });

    it("blocks re-enabling auth-failure disabled accounts through setAccountEnabled", () => {
      const now = Date.now();
      const stored = {
        version: 3 as const,
        activeIndex: 0,
        accounts: [
          {
            refreshToken: "token-1",
            enabled: false,
            disabledReason: "auth-failure" as const,
            addedAt: now,
            lastUsed: now,
          },
        ],
      };

      const manager = new AccountManager(undefined, stored);

      const reenabled = manager.trySetAccountEnabled(0, true);
      expect(reenabled).toEqual({
        ok: false,
        reason: "auth-failure-blocked",
      });
      expect(manager.getAccountsSnapshot()[0]).toMatchObject({
        enabled: false,
        disabledReason: "auth-failure",
      });
    });

    it("ignores explicit disable-reason overrides for auth-failure disabled accounts", () => {
      const now = Date.now();
      const stored = {
        version: 3 as const,
        activeIndex: 0,
        accounts: [
          {
            refreshToken: "token-1",
            enabled: false,
            disabledReason: "auth-failure" as const,
            addedAt: now,
            lastUsed: now,
          },
        ],
      };

      const manager = new AccountManager(undefined, stored);

      const disabled = manager.trySetAccountEnabled(0, false, "user");
      expect(disabled).toMatchObject({
        ok: true,
        account: {
          enabled: false,
          disabledReason: "auth-failure",
        },
      });

      expect(manager.trySetAccountEnabled(0, true)).toEqual({
        ok: false,
        reason: "auth-failure-blocked",
      });
      expect(manager.setAccountEnabled(0, true)).toBeNull();
    });

    it("preserves the legacy setAccountEnabled account-or-null contract", () => {
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
        ],
      };

      const manager = new AccountManager(undefined, stored);

      expect(manager.setAccountEnabled(99, false)).toBeNull();

      const userDisabled = manager.setAccountEnabled(0, false, "user");
      expect(userDisabled).toMatchObject({
        enabled: false,
        disabledReason: "user",
      });

      const reenabled = manager.setAccountEnabled(0, true);
      expect(reenabled).toMatchObject({
        enabled: true,
      });
    });
  });

  describe("getMinWaitTimeForFamily", () => {
    it("returns 0 when accounts are available", () => {
      const now = Date.now();
      const stored = {
        version: 3 as const,
        activeIndex: 0,
        accounts: [
          { refreshToken: "token-1", addedAt: now, lastUsed: now },
        ],
      };

      const manager = new AccountManager(undefined, stored);
      expect(manager.getMinWaitTimeForFamily("codex")).toBe(0);
    });

    it("returns wait time when all accounts rate limited", () => {
      const now = Date.now();
      const stored = {
        version: 3 as const,
        activeIndex: 0,
        accounts: [
          { 
            refreshToken: "token-1", 
            addedAt: now, 
            lastUsed: now,
            rateLimitResetTimes: { codex: now + 30000 },
          },
          { 
            refreshToken: "token-2", 
            addedAt: now, 
            lastUsed: now,
            rateLimitResetTimes: { codex: now + 60000 },
          },
        ],
      };

      const manager = new AccountManager(undefined, stored);
      const waitTime = manager.getMinWaitTimeForFamily("codex");
      expect(waitTime).toBeGreaterThan(0);
      expect(waitTime).toBeLessThanOrEqual(30000);
    });

    it("considers model-specific rate limits", () => {
      const now = Date.now();
      const stored = {
        version: 3 as const,
        activeIndex: 0,
        accounts: [
          { 
            refreshToken: "token-1", 
            addedAt: now, 
            lastUsed: now,
            rateLimitResetTimes: { "codex:gpt-5.2": now + 45000 },
          },
        ],
      };

      const manager = new AccountManager(undefined, stored);
      const waitTime = manager.getMinWaitTimeForFamily("codex", "gpt-5.2");
      expect(waitTime).toBeGreaterThan(0);
      expect(waitTime).toBeLessThanOrEqual(45000);
    });
  });

  describe("updateFromAuth", () => {
    it("updates account tokens from auth", () => {
      const now = Date.now();
      const stored = {
        version: 3 as const,
        activeIndex: 0,
        accounts: [
          { refreshToken: "old-token", addedAt: now, lastUsed: now },
        ],
      };

      const manager = new AccountManager(undefined, stored);
      const account = manager.getCurrentAccount()!;
      
      const newAuth: OAuthAuthDetails = {
        type: "oauth",
        access: "new-access",
        refresh: "new-refresh",
        expires: now + 3600000,
      };
      
      manager.updateFromAuth(account, newAuth);
      
      expect(account.refreshToken).toBe("new-refresh");
      expect(account.access).toBe("new-access");
      expect(account.expires).toBe(now + 3600000);
    });

    it("updates accountId from token when source is token-derived", () => {
      const now = Date.now();
      const stored = {
        version: 3 as const,
        activeIndex: 0,
        accounts: [
          { 
            refreshToken: "old-token", 
            addedAt: now, 
            lastUsed: now,
            accountId: "old-account-id",
            accountIdSource: "token" as const,
          },
        ],
      };

      const manager = new AccountManager(undefined, stored);
      const account = manager.getCurrentAccount()!;
      
      const payload = Buffer.from(JSON.stringify({ 
        "https://api.openai.com/auth": {
          chatgpt_account_id: "new-account-id-from-token",
        },
        exp: Math.floor((now + 3600000) / 1000),
      })).toString("base64url");
      const accessToken = `header.${payload}.signature`;
      
      const newAuth: OAuthAuthDetails = {
        type: "oauth",
        access: accessToken,
        refresh: "new-refresh",
        expires: now + 3600000,
      };
      
      manager.updateFromAuth(account, newAuth);
      
      expect(account.accountId).toBe("new-account-id-from-token");
      expect(account.accountIdSource).toBe("token");
    });

    it("does not update accountId when source is org-selected", () => {
      const now = Date.now();
      const stored = {
        version: 3 as const,
        activeIndex: 0,
        accounts: [
          { 
            refreshToken: "old-token", 
            addedAt: now, 
            lastUsed: now,
            accountId: "org-selected-id",
            accountIdSource: "org" as const,
          },
        ],
      };

      const manager = new AccountManager(undefined, stored);
      const account = manager.getCurrentAccount()!;
      
      const payload = Buffer.from(JSON.stringify({ 
        "https://api.openai.com/auth": {
          chatgpt_account_id: "new-account-id-from-token",
        },
        exp: Math.floor((now + 3600000) / 1000),
      })).toString("base64url");
      const accessToken = `header.${payload}.signature`;
      
      const newAuth: OAuthAuthDetails = {
        type: "oauth",
        access: accessToken,
        refresh: "new-refresh",
        expires: now + 3600000,
      };
      
      manager.updateFromAuth(account, newAuth);
      
      expect(account.accountId).toBe("org-selected-id");
      expect(account.accountIdSource).toBe("org");
    });

    it("clears stale auth failure state when refresh token rotates", () => {
      const now = Date.now();
      const stored = {
        version: 3 as const,
        activeIndex: 0,
        accounts: [
          { refreshToken: "old-token", addedAt: now, lastUsed: now },
        ],
      };

      const manager = new AccountManager(undefined, stored);
      const account = manager.getCurrentAccount()!;
      expect(manager.incrementAuthFailures(account)).toBe(1);

      const newAuth: OAuthAuthDetails = {
        type: "oauth",
        access: "new-access",
        refresh: "new-refresh",
        expires: now + 3600000,
      };

      manager.updateFromAuth(account, newAuth);

      const failuresByRefreshToken = Reflect.get(
        manager,
        "authFailuresByRefreshToken",
      ) as Map<string, number>;
      expect(failuresByRefreshToken.has("old-token")).toBe(false);
      expect(manager.incrementAuthFailures(account)).toBe(1);
    });
  });

  describe("toAuthDetails", () => {
    it("converts account to Auth object", () => {
      const now = Date.now();
      const stored = {
        version: 3 as const,
        activeIndex: 0,
        accounts: [
          { refreshToken: "token-1", addedAt: now, lastUsed: now },
        ],
      };

      const manager = new AccountManager(undefined, stored);
      const account = manager.getCurrentAccount()!;
      account.access = "access-token";
      account.expires = now + 3600000;
      
      const auth = manager.toAuthDetails(account);
      
      expect(auth.type).toBe("oauth");
      if (auth.type === "oauth") {
        expect(auth.access).toBe("access-token");
        expect(auth.refresh).toBe("token-1");
        expect(auth.expires).toBe(now + 3600000);
      }
    });

    it("handles missing access token", () => {
      const now = Date.now();
      const stored = {
        version: 3 as const,
        activeIndex: 0,
        accounts: [
          { refreshToken: "token-1", addedAt: now, lastUsed: now },
        ],
      };

      const manager = new AccountManager(undefined, stored);
      const account = manager.getCurrentAccount()!;
      
      const auth = manager.toAuthDetails(account);
      
      expect(auth.type).toBe("oauth");
      if (auth.type === "oauth") {
        expect(auth.access).toBe("");
        expect(auth.expires).toBe(0);
      }
    });
  });

  describe("setActiveIndex", () => {
    // Note: Tests in this block cover in-memory manager behavior.
    // No-org duplicates collapse only when accountId is same/missing; distinct accountId entries are preserved.
    it("sets active index and returns account", () => {
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
      const result = manager.setActiveIndex(1);
      
      expect(result?.refreshToken).toBe("token-2");
      expect(manager.getActiveIndex()).toBe(1);
    });

    it("returns null for invalid index", () => {
      const now = Date.now();
      const stored = {
        version: 3 as const,
        activeIndex: 0,
        accounts: [
          { refreshToken: "token-1", addedAt: now, lastUsed: now },
        ],
      };

      const manager = new AccountManager(undefined, stored);
      expect(manager.setActiveIndex(-1)).toBeNull();
      expect(manager.setActiveIndex(999)).toBeNull();
      expect(manager.setActiveIndex(NaN)).toBeNull();
      expect(manager.setActiveIndex(Infinity)).toBeNull();
    });

    it("switches between distinct workspace accounts sharing email and token (manager-level, no orgId)", () => {
      // Note: In-memory manager can hold multiple entries; canonical dedupe would collapse no-org duplicates only when accountId is same/missing
      const now = Date.now();
      const stored = {
        version: 3 as const,
        activeIndex: 0,
        accounts: [
          {
            refreshToken: "shared-refresh",
            email: "user@example.com",
            accountId: "workspace-a",
            addedAt: now,
            lastUsed: now,
          },
          {
            refreshToken: "shared-refresh",
            email: "user@example.com",
            accountId: "workspace-b",
            addedAt: now,
            lastUsed: now,
          },
        ],
      };

      const manager = new AccountManager(undefined, stored);
      expect(manager.getAccountCount()).toBe(2);

      expect(manager.getCurrentAccount()?.accountId).toBe("workspace-a");
      const switched = manager.setActiveIndex(1);
      expect(switched?.accountId).toBe("workspace-b");
      expect(manager.getCurrentAccount()?.accountId).toBe("workspace-b");
      expect(manager.getActiveIndex()).toBe(1);
    });

    it("switches between accounts that share accountId/refreshToken but have different organizationId", () => {
      const now = Date.now();
      const stored = {
        version: 3 as const,
        activeIndex: 0,
        accounts: [
          {
            organizationId: "org-a",
            accountId: "shared-account",
            refreshToken: "shared-refresh",
            email: "user@example.com",
            addedAt: now,
            lastUsed: now,
          },
          {
            organizationId: "org-b",
            accountId: "shared-account",
            refreshToken: "shared-refresh",
            email: "user@example.com",
            addedAt: now,
            lastUsed: now,
          },
        ],
      };

      const manager = new AccountManager(undefined, stored);
      expect(manager.getAccountCount()).toBe(2);
      expect(manager.getCurrentAccount()?.organizationId).toBe("org-a");

      const switched = manager.setActiveIndex(1);
      expect(switched?.organizationId).toBe("org-b");
      expect(manager.getCurrentAccount()?.organizationId).toBe("org-b");
      expect(manager.getActiveIndex()).toBe(1);
    });
  });

  describe("markSwitched", () => {
    it("records switch reason on account", () => {
      const now = Date.now();
      const stored = {
        version: 3 as const,
        activeIndex: 0,
        accounts: [
          { refreshToken: "token-1", addedAt: now, lastUsed: now },
        ],
      };

      const manager = new AccountManager(undefined, stored);
      const account = manager.getCurrentAccount()!;
      
      manager.markSwitched(account, "rate-limit", "codex");
      expect(account.lastSwitchReason).toBe("rate-limit");
    });
  });

  describe("saveToDisk", () => {
    it("saves accounts with all fields", async () => {
      const { saveAccounts } = await import("../lib/storage.js");
      const mockSaveAccounts = vi.mocked(saveAccounts);
      mockSaveAccounts.mockClear();
      mockSaveAccounts.mockResolvedValueOnce();

      const now = Date.now();
      const stored = {
        version: 3 as const,
        activeIndex: 0,
        accounts: [
          { 
            refreshToken: "token-1", 
            addedAt: now, 
            lastUsed: now,
            email: "test@example.com",
            accountId: "acc123",
            accountLabel: "Test",
            rateLimitResetTimes: { quota: now + 60000 },
            coolingDownUntil: now + 30000,
            cooldownReason: "transient",
          },
        ],
      };

      const manager = new AccountManager(undefined, stored as any);
      await manager.saveToDisk();

      expect(mockSaveAccounts).toHaveBeenCalled();
      const savedData = mockSaveAccounts.mock.calls[0]?.[0];
      expect(savedData?.version).toBe(3);
      expect(savedData?.accounts[0]?.email).toBe("test@example.com");
      expect(savedData?.accounts[0]?.rateLimitResetTimes).toBeDefined();
    });
  });

  describe("saveToDiskDebounced", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("debounces multiple calls", async () => {
      const { saveAccounts } = await import("../lib/storage.js");
      const mockSaveAccounts = vi.mocked(saveAccounts);
      mockSaveAccounts.mockClear();
      mockSaveAccounts.mockResolvedValue();

      const now = Date.now();
      const stored = {
        version: 3 as const,
        activeIndex: 0,
        accounts: [
          { refreshToken: "token-1", addedAt: now, lastUsed: now },
        ],
      };

      const manager = new AccountManager(undefined, stored);
      
      manager.saveToDiskDebounced(100);
      manager.saveToDiskDebounced(100);
      manager.saveToDiskDebounced(100);

      await vi.advanceTimersByTimeAsync(150);

      expect(mockSaveAccounts).toHaveBeenCalledTimes(1);
    });

    it("logs warning when debounced save fails", async () => {
      const { saveAccounts } = await import("../lib/storage.js");
      const mockSaveAccounts = vi.mocked(saveAccounts);
      mockSaveAccounts.mockClear();
      mockSaveAccounts.mockRejectedValueOnce(new Error("Save failed"));

      const now = Date.now();
      const stored = {
        version: 3 as const,
        activeIndex: 0,
        accounts: [
          { refreshToken: "token-1", addedAt: now, lastUsed: now },
        ],
      };

      const manager = new AccountManager(undefined, stored);
      
      manager.saveToDiskDebounced(100);
      await vi.advanceTimersByTimeAsync(150);

      expect(mockSaveAccounts).toHaveBeenCalledTimes(1);
    });

    it("awaits existing pendingSave before starting new save", async () => {
      const { saveAccounts } = await import("../lib/storage.js");
      const mockSaveAccounts = vi.mocked(saveAccounts);
      mockSaveAccounts.mockClear();

      let resolveFirst: () => void;
      const firstSave = new Promise<void>((resolve) => { resolveFirst = resolve; });
      mockSaveAccounts.mockImplementationOnce(() => firstSave);
      mockSaveAccounts.mockResolvedValue();

      const now = Date.now();
      const stored = {
        version: 3 as const,
        activeIndex: 0,
        accounts: [
          { refreshToken: "token-1", addedAt: now, lastUsed: now },
        ],
      };

      const manager = new AccountManager(undefined, stored);
      
      manager.saveToDiskDebounced(50);
      await vi.advanceTimersByTimeAsync(60);
      
      manager.saveToDiskDebounced(50);
      resolveFirst!();
      await vi.advanceTimersByTimeAsync(100);

      expect(mockSaveAccounts).toHaveBeenCalledTimes(2);
    });

    it("continues a queued save after the previous save fails", async () => {
      const { saveAccounts } = await import("../lib/storage.js");
      const mockSaveAccounts = vi.mocked(saveAccounts);
      mockSaveAccounts.mockClear();

      const savedSnapshots: Array<
        Array<{
          refreshToken?: string;
          enabled?: false;
          disabledReason?: string;
        }>
      > = [];

      let rejectFirstSave!: (error: Error) => void;
      mockSaveAccounts.mockImplementationOnce(async (storage) => {
        savedSnapshots.push(
          storage.accounts.map((account) => ({
            refreshToken: account.refreshToken,
            enabled: account.enabled,
            disabledReason: account.disabledReason,
          })),
        );
        await new Promise<void>((_, reject) => {
          rejectFirstSave = reject;
        });
      });
      mockSaveAccounts.mockImplementationOnce(async (storage) => {
        savedSnapshots.push(
          storage.accounts.map((account) => ({
            refreshToken: account.refreshToken,
            enabled: account.enabled,
            disabledReason: account.disabledReason,
          })),
        );
      });

      const now = Date.now();
      const stored = {
        version: 3 as const,
        activeIndex: 0,
        accounts: [
          { refreshToken: "token-1", addedAt: now, lastUsed: now },
        ],
      };

      const manager = new AccountManager(undefined, stored);

      manager.saveToDiskDebounced(50);
      await vi.advanceTimersByTimeAsync(60);
      expect(mockSaveAccounts).toHaveBeenCalledTimes(1);

      const account = manager.getAccountsSnapshot()[0]!;
      manager.disableAccountsWithSameRefreshToken(account);
      manager.saveToDiskDebounced(50);
      await vi.advanceTimersByTimeAsync(60);

      expect(mockSaveAccounts).toHaveBeenCalledTimes(1);

      rejectFirstSave(Object.assign(new Error("EBUSY: file in use"), { code: "EBUSY" }));
      await vi.advanceTimersByTimeAsync(0);
      for (let turn = 0; turn < 6; turn += 1) {
        await Promise.resolve();
      }

      expect(mockSaveAccounts).toHaveBeenCalledTimes(2);
      expect(savedSnapshots[1]).toEqual([
        expect.objectContaining({
          refreshToken: "token-1",
          enabled: false,
          disabledReason: "auth-failure",
        }),
      ]);
    });

    it("persists newer disabled state after two queued save failures once a later flush requeues it", async () => {
      const { saveAccounts } = await import("../lib/storage.js");
      const mockSaveAccounts = vi.mocked(saveAccounts);
      mockSaveAccounts.mockClear();

      const savedSnapshots: Array<
        Array<{
          refreshToken?: string;
          enabled?: false;
          disabledReason?: string;
        }>
      > = [];

      let rejectFirstSave!: (error: Error) => void;
      let rejectSecondSave!: (error: Error) => void;
      const firstSave = new Promise<void>((_resolve, reject) => {
        rejectFirstSave = reject;
      });
      const secondSave = new Promise<void>((_resolve, reject) => {
        rejectSecondSave = reject;
      });

      mockSaveAccounts.mockImplementationOnce(async (storage) => {
        savedSnapshots.push(
          storage.accounts.map((account) => ({
            refreshToken: account.refreshToken,
            enabled: account.enabled,
            disabledReason: account.disabledReason,
          })),
        );
        await firstSave;
      });
      mockSaveAccounts.mockImplementationOnce(async (storage) => {
        savedSnapshots.push(
          storage.accounts.map((account) => ({
            refreshToken: account.refreshToken,
            enabled: account.enabled,
            disabledReason: account.disabledReason,
          })),
        );
        await secondSave;
      });
      mockSaveAccounts.mockImplementationOnce(async (storage) => {
        savedSnapshots.push(
          storage.accounts.map((account) => ({
            refreshToken: account.refreshToken,
            enabled: account.enabled,
            disabledReason: account.disabledReason,
          })),
        );
      });

      const now = Date.now();
      const stored = {
        version: 3 as const,
        activeIndex: 0,
        accounts: [
          { refreshToken: "token-1", addedAt: now, lastUsed: now },
        ],
      };

      const manager = new AccountManager(undefined, stored);

      manager.saveToDiskDebounced(0);
      await vi.advanceTimersByTimeAsync(0);
      expect(mockSaveAccounts).toHaveBeenCalledTimes(1);

      const account = manager.getAccountsSnapshot()[0]!;
      manager.disableAccountsWithSameRefreshToken(account);
      manager.saveToDiskDebounced(50);
      await vi.advanceTimersByTimeAsync(60);

      rejectFirstSave(Object.assign(new Error("EBUSY: file in use"), { code: "EBUSY" }));
      await vi.advanceTimersByTimeAsync(0);
      for (let turn = 0; turn < 6; turn += 1) {
        await Promise.resolve();
      }

      expect(mockSaveAccounts).toHaveBeenCalledTimes(2);

      rejectSecondSave(Object.assign(new Error("EBUSY: file in use"), { code: "EBUSY" }));
      await vi.advanceTimersByTimeAsync(0);
      for (let turn = 0; turn < 6; turn += 1) {
        await Promise.resolve();
      }

      expect(mockSaveAccounts).toHaveBeenCalledTimes(2);

      manager.saveToDiskDebounced(0);
      await manager.flushPendingSave();

      expect(mockSaveAccounts).toHaveBeenCalledTimes(3);
      expect(savedSnapshots[2]).toEqual([
        expect.objectContaining({
          refreshToken: "token-1",
          enabled: false,
          disabledReason: "auth-failure",
        }),
      ]);
    });
  });

  describe("constructor edge cases", () => {
    it("filters out accounts with missing refreshToken", () => {
      const now = Date.now();
      const stored = {
        version: 3 as const,
        activeIndex: 0,
        accounts: [
          { refreshToken: "valid-token", addedAt: now, lastUsed: now },
          { refreshToken: "", addedAt: now, lastUsed: now },
          { refreshToken: null as unknown as string, addedAt: now, lastUsed: now },
          { refreshToken: undefined as unknown as string, addedAt: now, lastUsed: now },
          { refreshToken: "another-valid", addedAt: now, lastUsed: now },
        ],
      };

      const manager = new AccountManager(undefined, stored);
      expect(manager.getAccountCount()).toBe(2);
      const accounts = manager.getAccountsSnapshot();
      expect(accounts[0]?.refreshToken).toBe("valid-token");
      expect(accounts[1]?.refreshToken).toBe("another-valid");
    });

    it("merges fallback auth when matching by accountId", () => {
      const now = Date.now();
      const payload = {
        "https://api.openai.com/auth": {
          chatgpt_account_id: "matching-account-id",
        },
        email: "fallback@example.com",
      };
      const accessToken = `header.${Buffer.from(JSON.stringify(payload)).toString("base64")}.signature`;
      
      const stored = {
        version: 3 as const,
        activeIndex: 0,
        accounts: [
          { 
            refreshToken: "stored-token", 
            accountId: "matching-account-id",
            addedAt: now, 
            lastUsed: now,
          },
        ],
      };

      const auth: OAuthAuthDetails = {
        type: "oauth",
        access: accessToken,
        refresh: "new-refresh-token",
        expires: now + 60_000,
      };

      const manager = new AccountManager(auth, stored);
      expect(manager.getAccountCount()).toBe(1);
      const account = manager.getCurrentAccount();
      expect(account?.refreshToken).toBe("new-refresh-token");
      expect(account?.access).toBe(accessToken);
    });

    it("merges fallback auth when matching by email", () => {
      const now = Date.now();
      const payload = {
        email: "fallback@example.com",
      };
      const accessToken = `header.${Buffer.from(JSON.stringify(payload)).toString("base64")}.signature`;

      const stored = {
        version: 3 as const,
        activeIndex: 0,
        accounts: [
          {
            refreshToken: "stored-token",
            email: "fallback@example.com",
            addedAt: now,
            lastUsed: now,
          },
        ],
      };

      const auth: OAuthAuthDetails = {
        type: "oauth",
        access: accessToken,
        refresh: "new-refresh-token",
        expires: now + 60_000,
      };

      const manager = new AccountManager(auth, stored);
      expect(manager.getAccountCount()).toBe(1);
      const account = manager.getCurrentAccount();
      expect(account?.refreshToken).toBe("new-refresh-token");
      expect(account?.access).toBe(accessToken);
      expect(account?.email).toBe("fallback@example.com");
    });

    it("does not add fallback as duplicate when matching stored email", () => {
      const now = Date.now();
      const payload = {
        email: "fallback@example.com",
      };
      const accessToken = `header.${Buffer.from(JSON.stringify(payload)).toString("base64")}.signature`;

      const stored = {
        version: 3 as const,
        activeIndex: 0,
        accounts: [
          {
            refreshToken: "stored-token",
            email: "fallback@example.com",
            addedAt: now,
            lastUsed: now,
          },
        ],
      };

      const auth: OAuthAuthDetails = {
        type: "oauth",
        access: accessToken,
        refresh: "different-refresh-token",
        expires: now + 60_000,
      };

      const manager = new AccountManager(auth, stored);
      expect(manager.getAccountCount()).toBe(1);
      const account = manager.getCurrentAccount();
      expect(account?.refreshToken).toBe("different-refresh-token");
    });

    it("adds fallback as new account when no match found", () => {
      const now = Date.now();
      const stored = {
        version: 3 as const,
        activeIndex: 0,
        accounts: [
          { refreshToken: "existing-token", addedAt: now, lastUsed: now },
        ],
      };

      const auth: OAuthAuthDetails = {
        type: "oauth",
        access: "new-access",
        refresh: "new-refresh",
        expires: now + 60_000,
      };

      const manager = new AccountManager(auth, stored);
      expect(manager.getAccountCount()).toBe(2);
      const accounts = manager.getAccountsSnapshot();
      expect(accounts[0]?.refreshToken).toBe("existing-token");
      expect(accounts[1]?.refreshToken).toBe("new-refresh");
    });

    it("sets accountIdSource to token when fallbackAccountId exists", () => {
      const now = Date.now();
      const payload = {
        "https://api.openai.com/auth": {
          chatgpt_account_id: "fallback-id",
        },
      };
      const accessToken = `header.${Buffer.from(JSON.stringify(payload)).toString("base64")}.signature`;
      
      const auth: OAuthAuthDetails = {
        type: "oauth",
        access: accessToken,
        refresh: "refresh-token",
        expires: now + 60_000,
      };

      const manager = new AccountManager(auth, null);
      expect(manager.getAccountCount()).toBe(1);
      const account = manager.getCurrentAccount();
      expect(account?.accountIdSource).toBe("token");
      expect(account?.accountId).toBe("fallback-id");
    });

    it("sets accountIdSource to undefined when no accountId in token", () => {
      const now = Date.now();
      const auth: OAuthAuthDetails = {
        type: "oauth",
        access: "invalid-jwt",
        refresh: "refresh-token",
        expires: now + 60_000,
      };

      const manager = new AccountManager(auth, null);
      expect(manager.getAccountCount()).toBe(1);
      const account = manager.getCurrentAccount();
      expect(account?.accountIdSource).toBeUndefined();
    });
  });

  describe("removeAccount cursor adjustment", () => {
    it("adjusts cursor when removing account before cursor position", () => {
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
      
      manager.getCurrentOrNextForFamily("codex");
      manager.getCurrentOrNextForFamily("codex");
      manager.getCurrentOrNextForFamily("codex");
      
      const firstAccount = manager.getCurrentAccountForFamily("codex");
      expect(firstAccount).not.toBeNull();
      const removed = manager.removeAccount(firstAccount!);
      
      expect(removed).toBe(true);
      expect(manager.getAccountCount()).toBe(2);
    });

    it("adjusts currentAccountIndexByFamily when removing account before current", () => {
      const now = Date.now();
      const stored = {
        version: 3 as const,
        activeIndex: 2,
        activeIndexByFamily: { codex: 2 },
        accounts: [
          { refreshToken: "token-1", addedAt: now, lastUsed: now },
          { refreshToken: "token-2", addedAt: now, lastUsed: now },
          { refreshToken: "token-3", addedAt: now, lastUsed: now },
        ],
      };

      const manager = new AccountManager(undefined, stored as never);
      
      const initialAccount = manager.getCurrentAccountForFamily("codex");
      expect(initialAccount?.refreshToken).toBe("token-3");
      
      manager.setActiveIndex(0);
      const accountToRemove = manager.getCurrentAccountForFamily("codex");
      expect(accountToRemove?.refreshToken).toBe("token-1");
      
      manager.setActiveIndex(2);
      manager.removeAccount(accountToRemove!);
      
      expect(manager.getAccountCount()).toBe(2);
      expect(manager.getActiveIndexForFamily("codex")).toBe(1);
    });

    it("decrements currentAccountIndex when removing first account", () => {
      const now = Date.now();
      const stored = {
        version: 3 as const,
        activeIndex: 1,
        accounts: [
          { refreshToken: "token-1", addedAt: now, lastUsed: now },
          { refreshToken: "token-2", addedAt: now, lastUsed: now },
        ],
      };

      const manager = new AccountManager(undefined, stored);
      
      manager.setActiveIndex(0);
      const firstAccount = manager.getCurrentAccount();
      expect(firstAccount?.refreshToken).toBe("token-1");
      
      manager.setActiveIndex(1);
      manager.removeAccount(firstAccount!);
      
      expect(manager.getAccountCount()).toBe(1);
      expect(manager.getActiveIndexForFamily("codex")).toBe(0);
    });

    it("resets indices when removing last remaining account", () => {
      const now = Date.now();
      const stored = {
        version: 3 as const,
        activeIndex: 0,
        accounts: [
          { refreshToken: "token-1", addedAt: now, lastUsed: now },
        ],
      };

      const manager = new AccountManager(undefined, stored);
      const account = manager.getCurrentAccount()!;
      manager.removeAccount(account);
      
      expect(manager.getAccountCount()).toBe(0);
      expect(manager.getActiveIndexForFamily("codex")).toBe(-1);
    });
  });

  describe("flushPendingSave", () => {
    const drainMicrotasks = async (turns = 10): Promise<void> => {
      for (let turn = 0; turn < turns; turn++) {
        await Promise.resolve();
      }
    };

    it("flushes pending debounced save", async () => {
      const { saveAccounts } = await import("../lib/storage.js");
      const mockSaveAccounts = vi.mocked(saveAccounts);
      mockSaveAccounts.mockResolvedValue();

      const now = Date.now();
      const stored = {
        version: 3 as const,
        activeIndex: 0,
        accounts: [
          { refreshToken: "token-1", addedAt: now, lastUsed: now },
        ],
      };

      const manager = new AccountManager(undefined, stored);
      
      manager.saveToDiskDebounced(10000);
      await manager.flushPendingSave();

      expect(mockSaveAccounts).toHaveBeenCalled();
    });

    it("does nothing when no pending save", async () => {
      const { saveAccounts } = await import("../lib/storage.js");
      const mockSaveAccounts = vi.mocked(saveAccounts);
      mockSaveAccounts.mockClear();

      const now = Date.now();
      const stored = {
        version: 3 as const,
        activeIndex: 0,
        accounts: [
          { refreshToken: "token-1", addedAt: now, lastUsed: now },
        ],
      };

      const manager = new AccountManager(undefined, stored);
      await manager.flushPendingSave();

      expect(mockSaveAccounts).not.toHaveBeenCalled();
    });

    it("waits for pendingSave if it exists during flush", async () => {
      const { saveAccounts } = await import("../lib/storage.js");
      const mockSaveAccounts = vi.mocked(saveAccounts);
      mockSaveAccounts.mockClear();
      
      let resolveFirst: () => void;
      const firstSave = new Promise<void>((resolve) => { resolveFirst = resolve; });
      mockSaveAccounts.mockImplementationOnce(() => firstSave);
      mockSaveAccounts.mockResolvedValue();

      const now = Date.now();
      const stored = {
        version: 3 as const,
        activeIndex: 0,
        accounts: [
          { refreshToken: "token-1", addedAt: now, lastUsed: now },
        ],
      };

      const manager = new AccountManager(undefined, stored);
      
      const savePromise = manager.saveToDisk();
      const flushPromise = manager.flushPendingSave();
      
      resolveFirst!();
      await savePromise;
      await flushPromise;
      
      expect(mockSaveAccounts).toHaveBeenCalled();
    });

    it("waits for in-flight pendingSave without timer", async () => {
      const { saveAccounts } = await import("../lib/storage.js");
      const mockSaveAccounts = vi.mocked(saveAccounts);
      mockSaveAccounts.mockClear();

      let resolveInFlight: () => void;
      const inFlightSave = new Promise<void>((resolve) => { resolveInFlight = resolve; });
      mockSaveAccounts.mockImplementation(() => inFlightSave);

      const now = Date.now();
      const stored = {
        version: 3 as const,
        activeIndex: 0,
        accounts: [
          { refreshToken: "token-1", addedAt: now, lastUsed: now },
        ],
      };

      const manager = new AccountManager(undefined, stored);
      
      const savePromise = manager.saveToDisk();
      
      queueMicrotask(() => resolveInFlight!());
      
      await manager.flushPendingSave();
      await savePromise;
    });

    it("waits for in-flight save before flushing a pending debounce", async () => {
      vi.useFakeTimers();
      try {
        const { saveAccounts } = await import("../lib/storage.js");
        const mockSaveAccounts = vi.mocked(saveAccounts);
        mockSaveAccounts.mockClear();

        let resolveFirst!: () => void;
        const firstSave = new Promise<void>((resolve) => {
          resolveFirst = resolve;
        });
        mockSaveAccounts.mockImplementationOnce(() => firstSave);
        mockSaveAccounts.mockResolvedValue();

        const now = Date.now();
        const stored = {
          version: 3 as const,
          activeIndex: 0,
          accounts: [
            { refreshToken: "token-1", addedAt: now, lastUsed: now },
          ],
        };

        const manager = new AccountManager(undefined, stored);

        manager.saveToDiskDebounced(50);
        await vi.advanceTimersByTimeAsync(60);
        expect(mockSaveAccounts).toHaveBeenCalledTimes(1);

        manager.saveToDiskDebounced(50);
        const flushPromise = manager.flushPendingSave();
        await Promise.resolve();

        expect(mockSaveAccounts).toHaveBeenCalledTimes(1);

        resolveFirst();
        await flushPromise;

        expect(mockSaveAccounts).toHaveBeenCalledTimes(2);
      } finally {
        vi.useRealTimers();
      }
    });

    it("resolves settle waiters when flushPendingSave cancels a pending debounce", async () => {
      vi.useFakeTimers();
      try {
        const { saveAccounts } = await import("../lib/storage.js");
        const mockSaveAccounts = vi.mocked(saveAccounts);
        mockSaveAccounts.mockClear();
        mockSaveAccounts.mockResolvedValue();

        const now = Date.now();
        const stored = {
          version: 3 as const,
          activeIndex: 0,
          accounts: [
            { refreshToken: "token-1", addedAt: now, lastUsed: now },
          ],
        };

        const manager = new AccountManager(undefined, stored);

        manager.saveToDiskDebounced(50);
        const settlePromise = manager.waitForPendingSaveToSettle();
        const flushPromise = manager.flushPendingSave();

        await flushPromise;
        await expect(settlePromise).resolves.toBeUndefined();
        expect(mockSaveAccounts).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it("drains saves queued during flush without overlapping writes", async () => {
      vi.useFakeTimers();
      try {
        const { saveAccounts } = await import("../lib/storage.js");
        const mockSaveAccounts = vi.mocked(saveAccounts);
        mockSaveAccounts.mockClear();

        let activeWrites = 0;
        let maxConcurrentWrites = 0;
        const settleWrites: Array<() => void> = [];
        const writePromises: Promise<void>[] = [];

        mockSaveAccounts.mockImplementation(() => {
          activeWrites++;
          maxConcurrentWrites = Math.max(maxConcurrentWrites, activeWrites);
          const writePromise = new Promise<void>((resolve) => {
            settleWrites.push(() => {
              activeWrites--;
              resolve();
            });
          });
          writePromises.push(writePromise);
          return writePromise;
        });

        const now = Date.now();
        const stored = {
          version: 3 as const,
          activeIndex: 0,
          accounts: [
            { refreshToken: "token-1", addedAt: now, lastUsed: now },
          ],
        };

        const manager = new AccountManager(undefined, stored);

        manager.saveToDiskDebounced(50);
        await vi.advanceTimersByTimeAsync(60);
        expect(mockSaveAccounts).toHaveBeenCalledTimes(1);

        const armGapSave = writePromises[0]!.then(() => {
          manager.saveToDiskDebounced(0);
        });

        manager.saveToDiskDebounced(50);
        const flushPromise = manager.flushPendingSave();

        settleWrites[0]!();
        await armGapSave;
        await drainMicrotasks();

        expect(mockSaveAccounts).toHaveBeenCalledTimes(2);

        manager.saveToDiskDebounced(0);
        await vi.advanceTimersByTimeAsync(0);
        expect(mockSaveAccounts).toHaveBeenCalledTimes(2);

        settleWrites[1]!();
        await drainMicrotasks();

        expect(mockSaveAccounts).toHaveBeenCalledTimes(3);

        settleWrites[2]!();
        await flushPromise;

        expect(maxConcurrentWrites).toBe(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it("persists disabled auth-failure state after flushing over an in-flight save", async () => {
      vi.useFakeTimers();
      try {
        const { saveAccounts } = await import("../lib/storage.js");
        const mockSaveAccounts = vi.mocked(saveAccounts);
        mockSaveAccounts.mockClear();

        let activeWrites = 0;
        let maxConcurrentWrites = 0;
        const settleWrites: Array<() => void> = [];
        const savedSnapshots: Array<
          Array<{
            refreshToken?: string;
            enabled?: false;
            disabledReason?: string;
            coolingDownUntil?: number;
            cooldownReason?: string;
          }>
        > = [];

        mockSaveAccounts.mockImplementation(async (storage) => {
          activeWrites++;
          maxConcurrentWrites = Math.max(maxConcurrentWrites, activeWrites);
          savedSnapshots.push(
            storage.accounts.map((account) => ({
              refreshToken: account.refreshToken,
              enabled: account.enabled,
              disabledReason: account.disabledReason,
              coolingDownUntil: account.coolingDownUntil,
              cooldownReason: account.cooldownReason,
            })),
          );
          await new Promise<void>((resolve) => {
            settleWrites.push(() => {
              activeWrites--;
              resolve();
            });
          });
        });

        const now = Date.now();
        const stored = {
          version: 3 as const,
          activeIndex: 0,
          accounts: [
            {
              refreshToken: "shared-refresh",
              addedAt: now,
              lastUsed: now,
              coolingDownUntil: now + 10_000,
              cooldownReason: "auth-failure" as const,
            },
            {
              refreshToken: "shared-refresh",
              addedAt: now + 1,
              lastUsed: now + 1,
              coolingDownUntil: now + 20_000,
              cooldownReason: "auth-failure" as const,
            },
          ],
        };

        const manager = new AccountManager(undefined, stored);

        manager.saveToDiskDebounced(50);
        await vi.advanceTimersByTimeAsync(60);
        expect(mockSaveAccounts).toHaveBeenCalledTimes(1);

        const account = manager.getAccountsSnapshot()[0]!;
        manager.disableAccountsWithSameRefreshToken(account);
        manager.saveToDiskDebounced(50);

        const flushPromise = manager.flushPendingSave();

        settleWrites[0]!();
        await drainMicrotasks();

        expect(mockSaveAccounts).toHaveBeenCalledTimes(2);

        const flushedSharedAccounts = savedSnapshots[1]!.filter(
          (savedAccount) => savedAccount.refreshToken === "shared-refresh",
        );
        expect(flushedSharedAccounts).toEqual([
          expect.objectContaining({
            enabled: false,
            disabledReason: "auth-failure",
            coolingDownUntil: undefined,
            cooldownReason: undefined,
          }),
          expect.objectContaining({
            enabled: false,
            disabledReason: "auth-failure",
            coolingDownUntil: undefined,
            cooldownReason: undefined,
          }),
        ]);

        settleWrites[1]!();
        await flushPromise;

        expect(maxConcurrentWrites).toBe(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it("flushes newer debounced state after an older pending save fails", async () => {
      vi.useFakeTimers();
      try {
        const { saveAccounts } = await import("../lib/storage.js");
        const mockSaveAccounts = vi.mocked(saveAccounts);
        mockSaveAccounts.mockClear();

        const savedSnapshots: Array<
          Array<{
            refreshToken?: string;
            enabled?: false;
            disabledReason?: string;
          }>
        > = [];

        let rejectFirstSave: (error: Error) => void;
        const firstSave = new Promise<void>((_resolve, reject) => {
          rejectFirstSave = reject;
        });
        mockSaveAccounts.mockImplementationOnce(async (storage) => {
          savedSnapshots.push(
            storage.accounts.map((account) => ({
              refreshToken: account.refreshToken,
              enabled: account.enabled,
              disabledReason: account.disabledReason,
            })),
          );
          await firstSave;
        });
        mockSaveAccounts.mockImplementationOnce(async (storage) => {
          savedSnapshots.push(
            storage.accounts.map((account) => ({
              refreshToken: account.refreshToken,
              enabled: account.enabled,
              disabledReason: account.disabledReason,
            })),
          );
        });

        const now = Date.now();
        const stored = {
          version: 3 as const,
          activeIndex: 0,
          accounts: [
            { refreshToken: "shared-refresh", addedAt: now, lastUsed: now },
          ],
        };

        const manager = new AccountManager(undefined, stored);

        manager.saveToDiskDebounced(0);
        await vi.advanceTimersByTimeAsync(0);
        expect(mockSaveAccounts).toHaveBeenCalledTimes(1);

        const account = manager.getAccountsSnapshot()[0]!;
        manager.disableAccountsWithSameRefreshToken(account);
        manager.saveToDiskDebounced(50);

        const flushPromise = manager.flushPendingSave();
        await Promise.resolve();

        rejectFirstSave!(Object.assign(new Error("EBUSY: file in use"), { code: "EBUSY" }));
        await flushPromise;

        expect(mockSaveAccounts).toHaveBeenCalledTimes(2);
        expect(savedSnapshots[1]).toEqual([
          expect.objectContaining({
            refreshToken: "shared-refresh",
            enabled: false,
            disabledReason: "auth-failure",
          }),
        ]);
      } finally {
        vi.useRealTimers();
      }
    });

    it("warns and rejects if flushPendingSave keeps discovering new saves", async () => {
      vi.useFakeTimers();
      try {
        const { saveAccounts } = await import("../lib/storage.js");
        const mockSaveAccounts = vi.mocked(saveAccounts);
        mockSaveAccounts.mockClear();
        mockSaveAccounts.mockResolvedValue();

        const now = Date.now();
        const stored = {
          version: 3 as const,
          activeIndex: 0,
          accounts: [
            { refreshToken: "token-1", addedAt: now, lastUsed: now },
          ],
        };

        const manager = new AccountManager(undefined, stored);
        const originalSaveToDisk = manager.saveToDisk.bind(manager);
        let rearmedSaves = 0;

        vi.spyOn(manager, "saveToDisk").mockImplementation(async () => {
          if (rearmedSaves < 25) {
            rearmedSaves++;
            manager.saveToDiskDebounced(0);
          }
          await originalSaveToDisk();
        });

        manager.saveToDiskDebounced(0);
        await expect(manager.flushPendingSave()).rejects.toThrow(
          "flushPendingSave: exceeded max flush iterations; save state may be incomplete",
        );

        expect(accountLoggerWarn).toHaveBeenCalledWith(
          "flushPendingSave exceeded max iterations; possible save loop",
          expect.objectContaining({ iterations: 20 }),
        );
      } finally {
        vi.useRealTimers();
      }
    });

    it("rejects when saveToDisk throws during flush", async () => {
      vi.useFakeTimers();
      try {
        const { saveAccounts } = await import("../lib/storage.js");
        const mockSaveAccounts = vi.mocked(saveAccounts);
        mockSaveAccounts.mockClear();
        mockSaveAccounts.mockRejectedValueOnce(new Error("EBUSY: file in use"));
        mockSaveAccounts.mockResolvedValueOnce();

        const now = Date.now();
        const stored = {
          version: 3 as const,
          activeIndex: 0,
          accounts: [
            { refreshToken: "token-1", addedAt: now, lastUsed: now },
          ],
        };

        const manager = new AccountManager(undefined, stored);
        manager.saveToDiskDebounced(0);

        await expect(manager.flushPendingSave()).rejects.toThrow("EBUSY");

        manager.saveToDiskDebounced(0);
        await vi.advanceTimersByTimeAsync(0);

        expect(mockSaveAccounts).toHaveBeenCalledTimes(2);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("health and token tracking methods", () => {
    beforeEach(() => {
      resetTrackers();
    });

    afterEach(() => {
      resetTrackers();
    });

    it("recordSuccess updates health tracker with model-specific quotaKey", () => {
      const now = Date.now();
      const stored = {
        version: 3 as const,
        activeIndex: 0,
        accounts: [
          { refreshToken: "token-1", addedAt: now, lastUsed: now },
        ],
      };

      const manager = new AccountManager(undefined, stored);
      const account = manager.getCurrentAccount()!;
      const healthTracker = getHealthTracker();

      manager.recordSuccess(account, "codex", "gpt-5.1");
      
      const score = healthTracker.getScore(account.index, "codex:gpt-5.1");
      expect(score).toBe(100);
    });

    it("recordSuccess updates health tracker with family-only quotaKey when model is null", () => {
      const now = Date.now();
      const stored = {
        version: 3 as const,
        activeIndex: 0,
        accounts: [
          { refreshToken: "token-1", addedAt: now, lastUsed: now },
        ],
      };

      const manager = new AccountManager(undefined, stored);
      const account = manager.getCurrentAccount()!;
      const healthTracker = getHealthTracker();

      manager.recordSuccess(account, "codex", null);
      
      const score = healthTracker.getScore(account.index, "codex");
      expect(score).toBe(100);
    });

    it("recordRateLimit updates health and drains token bucket", () => {
      const now = Date.now();
      const stored = {
        version: 3 as const,
        activeIndex: 0,
        accounts: [
          { refreshToken: "token-1", addedAt: now, lastUsed: now },
        ],
      };

      const manager = new AccountManager(undefined, stored);
      const account = manager.getCurrentAccount()!;
      const healthTracker = getHealthTracker();
      const tokenTracker = getTokenTracker();

      manager.recordRateLimit(account, "codex", "gpt-5.1");
      
      const score = healthTracker.getScore(account.index, "codex:gpt-5.1");
      const tokens = tokenTracker.getTokens(account.index, "codex:gpt-5.1");
      expect(score).toBeLessThan(100);
      expect(tokens).toBeLessThan(50);
    });

    it("recordRateLimit uses family-only quotaKey when model is undefined", () => {
      const now = Date.now();
      const stored = {
        version: 3 as const,
        activeIndex: 0,
        accounts: [
          { refreshToken: "token-1", addedAt: now, lastUsed: now },
        ],
      };

      const manager = new AccountManager(undefined, stored);
      const account = manager.getCurrentAccount()!;
      const healthTracker = getHealthTracker();

      manager.recordRateLimit(account, "gpt-5.2");
      
      const score = healthTracker.getScore(account.index, "gpt-5.2");
      expect(score).toBeLessThan(100);
    });

    it("recordFailure updates health tracker", () => {
      const now = Date.now();
      const stored = {
        version: 3 as const,
        activeIndex: 0,
        accounts: [
          { refreshToken: "token-1", addedAt: now, lastUsed: now },
        ],
      };

      const manager = new AccountManager(undefined, stored);
      const account = manager.getCurrentAccount()!;
      const healthTracker = getHealthTracker();

      manager.recordFailure(account, "codex", "gpt-5.2");
      
      const score = healthTracker.getScore(account.index, "codex:gpt-5.2");
      expect(score).toBeLessThan(100);
    });

    it("recordFailure uses family-only quotaKey when model is null", () => {
      const now = Date.now();
      const stored = {
        version: 3 as const,
        activeIndex: 0,
        accounts: [
          { refreshToken: "token-1", addedAt: now, lastUsed: now },
        ],
      };

      const manager = new AccountManager(undefined, stored);
      const account = manager.getCurrentAccount()!;
      const healthTracker = getHealthTracker();

      manager.recordFailure(account, "gpt-5.1", null);
      
      const score = healthTracker.getScore(account.index, "gpt-5.1");
      expect(score).toBeLessThan(100);
    });

    it("consumeToken returns true and consumes from token bucket", () => {
      const now = Date.now();
      const stored = {
        version: 3 as const,
        activeIndex: 0,
        accounts: [
          { refreshToken: "token-1", addedAt: now, lastUsed: now },
        ],
      };

      const manager = new AccountManager(undefined, stored);
      const account = manager.getCurrentAccount()!;
      const tokenTracker = getTokenTracker();

      const initialTokens = tokenTracker.getTokens(account.index, "codex:gpt-5.1");
      const result = manager.consumeToken(account, "codex", "gpt-5.1");
      const afterTokens = tokenTracker.getTokens(account.index, "codex:gpt-5.1");

      expect(result).toBe(true);
      expect(afterTokens).toBeLessThan(initialTokens);
    });

    it("consumeToken uses family-only quotaKey when model is undefined", () => {
      const now = Date.now();
      const stored = {
        version: 3 as const,
        activeIndex: 0,
        accounts: [
          { refreshToken: "token-1", addedAt: now, lastUsed: now },
        ],
      };

      const manager = new AccountManager(undefined, stored);
      const account = manager.getCurrentAccount()!;

      const result = manager.consumeToken(account, "codex");

      expect(result).toBe(true);
    });
  });

  describe("hybrid selection fallback path", () => {
    beforeEach(() => {
      resetTrackers();
    });

    afterEach(() => {
      resetTrackers();
    });

    it("selects alternate account when current is rate-limited via selectHybridAccount", () => {
      const now = Date.now();
      const stored = {
        version: 3 as const,
        activeIndex: 0,
        activeIndexByFamily: { codex: 0 },
        accounts: [
          { refreshToken: "token-1", addedAt: now, lastUsed: now },
          { refreshToken: "token-2", addedAt: now, lastUsed: now - 10000 },
        ],
      };

      const manager = new AccountManager(undefined, stored as never);
      
      const account0 = manager.setActiveIndex(0)!;
      manager.markRateLimited(account0, 60000, "codex");
      
      const selected = manager.getCurrentOrNextForFamilyHybrid("codex");
      
      expect(selected).not.toBeNull();
      expect(selected?.refreshToken).toBe("token-2");
      expect(selected?.index).toBe(1);
    });

    it("updates cursor and family index after hybrid selection", () => {
      const now = Date.now();
      const stored = {
        version: 3 as const,
        activeIndex: 0,
        activeIndexByFamily: { codex: 0 },
        accounts: [
          { refreshToken: "token-1", addedAt: now, lastUsed: now },
          { refreshToken: "token-2", addedAt: now, lastUsed: now - 5000 },
          { refreshToken: "token-3", addedAt: now, lastUsed: now - 10000 },
        ],
      };

      const manager = new AccountManager(undefined, stored as never);
      
      const account0 = manager.getAccountsSnapshot()[0]!;
      manager.markRateLimited(account0, 60000, "codex");
      
      const selected = manager.getCurrentOrNextForFamilyHybrid("codex");
      expect(selected).not.toBeNull();
      
      const secondCall = manager.getCurrentOrNextForFamilyHybrid("codex");
      expect(secondCall?.index).toBe(selected?.index);
    });

    it("falls back to least-recently-used when all accounts are rate-limited", () => {
      const now = Date.now();
      const stored = {
        version: 3 as const,
        activeIndex: 0,
        activeIndexByFamily: { codex: 0 },
        accounts: [
          { refreshToken: "token-1", addedAt: now, lastUsed: now },
        ],
      };

      const manager = new AccountManager(undefined, stored as never);
      
      const account0 = manager.setActiveIndex(0)!;
      manager.markRateLimited(account0, 60000, "codex");
      
      const selected = manager.getCurrentOrNextForFamilyHybrid("codex");
      expect(selected).not.toBeNull();
      expect(selected?.index).toBe(0);
    });

    it("reports selection explainability with eligibility reasons", () => {
      const now = Date.now();
      const stored = {
        version: 3 as const,
        activeIndex: 0,
        activeIndexByFamily: { codex: 0 },
        accounts: [
          { refreshToken: "token-1", addedAt: now, lastUsed: now, enabled: false },
          { refreshToken: "token-2", addedAt: now, lastUsed: now - 1000 },
          { refreshToken: "token-3", addedAt: now, lastUsed: now - 2000 },
          { refreshToken: "token-4", addedAt: now, lastUsed: now - 3000 },
        ],
      };

      const manager = new AccountManager(undefined, stored as never);
      const rateLimited = manager.setActiveIndex(1)!;
      manager.markRateLimited(rateLimited, 60_000, "codex");
      getTokenTracker().drain(2, "codex", 100);

      const explainability = manager.getSelectionExplainability("codex", undefined, now);
      const byIndex = new Map(explainability.map((entry) => [entry.index, entry]));

      expect(byIndex.get(0)?.eligible).toBe(false);
      expect(byIndex.get(0)?.reasons).toContain("disabled");

      expect(byIndex.get(1)?.eligible).toBe(false);
      expect(byIndex.get(1)?.reasons).toContain("rate-limited");

      expect(byIndex.get(2)?.eligible).toBe(false);
      expect(byIndex.get(2)?.reasons).toContain("token-bucket-empty");

      expect(byIndex.get(3)?.eligible).toBe(true);
      expect(byIndex.get(3)?.reasons).toEqual(["eligible"]);
    });
  });
});
