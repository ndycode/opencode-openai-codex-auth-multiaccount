import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RefreshQueue, getRefreshQueue, resetRefreshQueue, queuedRefresh } from "../lib/refresh-queue.js";
import * as authModule from "../lib/auth/auth.js";

vi.mock("../lib/auth/auth.js", () => ({
  refreshAccessToken: vi.fn(),
}));

vi.mock("../lib/logger.js", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe("RefreshQueue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRefreshQueue();
  });

  afterEach(() => {
    resetRefreshQueue();
  });

  describe("basic refresh functionality", () => {
    it("should call refreshAccessToken for a single refresh request", async () => {
      const mockResult = {
        type: "success" as const,
        access: "new-access-token",
        refresh: "new-refresh-token",
        expires: Date.now() + 3600000,
      };
      vi.mocked(authModule.refreshAccessToken).mockResolvedValue(mockResult);

      const queue = new RefreshQueue();
      const result = await queue.refresh("test-refresh-token");

      expect(result).toEqual(mockResult);
      expect(authModule.refreshAccessToken).toHaveBeenCalledTimes(1);
      expect(authModule.refreshAccessToken).toHaveBeenCalledWith("test-refresh-token");
    });

    it("should return failed result when refresh fails", async () => {
      const mockResult = {
        type: "failed" as const,
        reason: "http_error" as const,
        statusCode: 401,
      };
      vi.mocked(authModule.refreshAccessToken).mockResolvedValue(mockResult);

      const queue = new RefreshQueue();
      const result = await queue.refresh("bad-token");

      expect(result.type).toBe("failed");
      if (result.type === "failed") {
        expect(result.reason).toBe("http_error");
      }
    });

    it("should catch exceptions and return network_error failure", async () => {
      vi.mocked(authModule.refreshAccessToken).mockRejectedValue(new Error("Network timeout"));

      const queue = new RefreshQueue();
      const result = await queue.refresh("test-token");

      expect(result.type).toBe("failed");
      if (result.type === "failed") {
        expect(result.reason).toBe("network_error");
        expect(result.message).toBe("Network timeout");
      }
    });
  });

  describe("deduplication of concurrent requests", () => {
    it("should deduplicate concurrent refresh requests for the same token", async () => {
      const mockResult = {
        type: "success" as const,
        access: "deduped-access",
        refresh: "deduped-refresh",
        expires: Date.now() + 3600000,
      };
      
      let resolveRefresh: (value: typeof mockResult) => void;
      const refreshPromise = new Promise<typeof mockResult>((resolve) => {
        resolveRefresh = resolve;
      });
      vi.mocked(authModule.refreshAccessToken).mockReturnValue(refreshPromise);

      const queue = new RefreshQueue();
      
      const promise1 = queue.refresh("same-token");
      const promise2 = queue.refresh("same-token");
      const promise3 = queue.refresh("same-token");

      expect(authModule.refreshAccessToken).toHaveBeenCalledTimes(1);

      resolveRefresh!(mockResult);
      
      const [result1, result2, result3] = await Promise.all([promise1, promise2, promise3]);

      expect(result1).toBe(result2);
      expect(result2).toBe(result3);
      expect(result1).toEqual(mockResult);
      expect(authModule.refreshAccessToken).toHaveBeenCalledTimes(1);
    });

    it("should make separate calls for different tokens", async () => {
      const mockResult = {
        type: "success" as const,
        access: "access",
        refresh: "refresh",
        expires: Date.now() + 3600000,
      };
      vi.mocked(authModule.refreshAccessToken).mockResolvedValue(mockResult);

      const queue = new RefreshQueue();
      
      await Promise.all([
        queue.refresh("token-1"),
        queue.refresh("token-2"),
        queue.refresh("token-3"),
      ]);

      expect(authModule.refreshAccessToken).toHaveBeenCalledTimes(3);
      expect(authModule.refreshAccessToken).toHaveBeenCalledWith("token-1");
      expect(authModule.refreshAccessToken).toHaveBeenCalledWith("token-2");
      expect(authModule.refreshAccessToken).toHaveBeenCalledWith("token-3");
    });

    it("should allow new refresh after previous completes", async () => {
      const mockResult = {
        type: "success" as const,
        access: "access",
        refresh: "refresh",
        expires: Date.now() + 3600000,
      };
      vi.mocked(authModule.refreshAccessToken).mockResolvedValue(mockResult);

      const queue = new RefreshQueue();
      
      await queue.refresh("token");
      expect(authModule.refreshAccessToken).toHaveBeenCalledTimes(1);
      
      await queue.refresh("token");
      expect(authModule.refreshAccessToken).toHaveBeenCalledTimes(2);
    });
  });

  describe("isRefreshing", () => {
    it("should return true while refresh is in progress", async () => {
      let resolveRefresh: () => void;
      const refreshPromise = new Promise<void>((resolve) => {
        resolveRefresh = resolve;
      }).then(() => ({
        type: "success" as const,
        access: "access",
        refresh: "refresh",
        expires: Date.now() + 3600000,
      }));
      vi.mocked(authModule.refreshAccessToken).mockReturnValue(refreshPromise);

      const queue = new RefreshQueue();
      
      expect(queue.isRefreshing("token")).toBe(false);
      
      const refreshing = queue.refresh("token");
      expect(queue.isRefreshing("token")).toBe(true);
      
      resolveRefresh!();
      await refreshing;
      
      expect(queue.isRefreshing("token")).toBe(false);
    });
  });

  describe("pendingCount", () => {
    it("should track the number of pending refreshes", async () => {
      let resolvers: Array<() => void> = [];
      vi.mocked(authModule.refreshAccessToken).mockImplementation(() => {
        return new Promise((resolve) => {
          resolvers.push(() => resolve({
            type: "success",
            access: "access",
            refresh: "refresh",
            expires: Date.now() + 3600000,
          }));
        });
      });

      const queue = new RefreshQueue();
      
      expect(queue.pendingCount).toBe(0);
      
      const p1 = queue.refresh("token-1");
      expect(queue.pendingCount).toBe(1);
      
      const p2 = queue.refresh("token-2");
      expect(queue.pendingCount).toBe(2);
      
      resolvers[0]!();
      await p1;
      expect(queue.pendingCount).toBe(1);
      
      resolvers[1]!();
      await p2;
      expect(queue.pendingCount).toBe(0);
    });
  });

  describe("stale entry cleanup", () => {
    it("should clean up stale entries after maxEntryAge", async () => {
      vi.useFakeTimers();
      
      let resolveRefresh: () => void;
      const stuckPromise = new Promise<never>(() => {});
      vi.mocked(authModule.refreshAccessToken)
        .mockReturnValueOnce(stuckPromise)
        .mockResolvedValue({
          type: "success",
          access: "access",
          refresh: "refresh", 
          expires: Date.now() + 3600000,
        });

      const queue = new RefreshQueue(1000);
      
      queue.refresh("stuck-token");
      expect(queue.pendingCount).toBe(1);
      
      vi.advanceTimersByTime(1500);
      
      await queue.refresh("other-token");
      
      expect(queue.pendingCount).toBe(0);
      
      vi.useRealTimers();
    });
  });

  describe("singleton functions", () => {
    it("getRefreshQueue should return singleton instance", () => {
      const queue1 = getRefreshQueue();
      const queue2 = getRefreshQueue();
      expect(queue1).toBe(queue2);
    });

    it("resetRefreshQueue should clear the singleton", () => {
      const queue1 = getRefreshQueue();
      resetRefreshQueue();
      const queue2 = getRefreshQueue();
      expect(queue1).not.toBe(queue2);
    });

    it("queuedRefresh should use singleton queue", async () => {
      const mockResult = {
        type: "success" as const,
        access: "access",
        refresh: "refresh",
        expires: Date.now() + 3600000,
      };
      vi.mocked(authModule.refreshAccessToken).mockResolvedValue(mockResult);

      const result = await queuedRefresh("test-token");
      
      expect(result).toEqual(mockResult);
      expect(authModule.refreshAccessToken).toHaveBeenCalledWith("test-token");
    });
  });

  describe("clear", () => {
    it("should clear all pending entries", async () => {
      vi.mocked(authModule.refreshAccessToken).mockImplementation(() => 
        new Promise(() => {})
      );

      const queue = new RefreshQueue();
      queue.refresh("token-1");
      queue.refresh("token-2");
      
      expect(queue.pendingCount).toBe(2);
      
      queue.clear();
      
      expect(queue.pendingCount).toBe(0);
    });
  });
});
