/**
 * Refresh Queue Module
 *
 * Prevents race conditions when multiple concurrent requests try to refresh
 * the same account's token simultaneously. Instead of firing parallel refresh
 * requests, subsequent callers await the existing in-flight refresh.
 *
 * Ported from antigravity-auth refresh-queue.ts pattern.
 */

import { refreshAccessToken } from "./auth/auth.js";
import type { TokenResult } from "./types.js";
import { createLogger } from "./logger.js";

const log = createLogger("refresh-queue");

/**
 * Entry representing an in-flight token refresh operation.
 */
interface RefreshEntry {
  promise: Promise<TokenResult>;
  startedAt: number;
}

/**
 * Manages queued token refresh operations to prevent race conditions.
 *
 * When multiple concurrent requests need to refresh the same account's token,
 * only the first request triggers the actual refresh. Subsequent requests
 * await the same promise, ensuring:
 * - No duplicate refresh API calls for the same refresh token
 * - Consistent token state across all waiting callers
 * - Reduced load on OpenAI's token endpoint
 *
 * @example
 * ```typescript
 * const queue = new RefreshQueue();
 *
 * // These three concurrent calls will only trigger ONE actual refresh
 * const [result1, result2, result3] = await Promise.all([
 *   queue.refresh(refreshToken),
 *   queue.refresh(refreshToken),
 *   queue.refresh(refreshToken),
 * ]);
 *
 * // All three get the same result
 * console.log(result1 === result2); // true (same object reference)
 * ```
 */
export class RefreshQueue {
  private pending: Map<string, RefreshEntry> = new Map();

  /**
   * Maximum time to keep a refresh entry in the queue (prevents memory leaks
   * from stuck requests). After this timeout, the entry is removed and new
   * callers will trigger a fresh refresh.
   */
  private readonly maxEntryAgeMs: number;

  /**
   * Create a new RefreshQueue instance.
   * @param maxEntryAgeMs - Maximum age for pending entries before cleanup (default: 30s)
   */
  constructor(maxEntryAgeMs: number = 30_000) {
    this.maxEntryAgeMs = maxEntryAgeMs;
  }

  /**
   * Refresh a token, deduplicating concurrent requests for the same refresh token.
   *
   * If a refresh is already in-flight for this token, returns the existing promise.
   * Otherwise, initiates a new refresh and caches the promise for other callers.
   *
   * @param refreshToken - The refresh token to use
   * @returns Token result (success with new tokens, or failure)
   */
  async refresh(refreshToken: string): Promise<TokenResult> {
    // Clean up stale entries first
    this.cleanup();

    // Check for existing in-flight refresh
    const existing = this.pending.get(refreshToken);
    if (existing) {
      log.info("Reusing in-flight refresh for token", {
        tokenSuffix: refreshToken.slice(-6),
        waitingMs: Date.now() - existing.startedAt,
      });
      return existing.promise;
    }

    // Start a new refresh
    const startedAt = Date.now();
    const promise = this.executeRefresh(refreshToken);

    this.pending.set(refreshToken, { promise, startedAt });

    try {
      return await promise;
    } finally {
      // Clean up after completion
      this.pending.delete(refreshToken);
    }
  }

  /**
   * Execute the actual refresh and log results.
   */
  private async executeRefresh(refreshToken: string): Promise<TokenResult> {
    const startTime = Date.now();
    log.info("Starting token refresh", { tokenSuffix: refreshToken.slice(-6) });

    try {
      const result = await refreshAccessToken(refreshToken);
      const duration = Date.now() - startTime;

      if (result.type === "success") {
        log.info("Token refresh succeeded", {
          tokenSuffix: refreshToken.slice(-6),
          durationMs: duration,
        });
      } else {
        log.warn("Token refresh failed", {
          tokenSuffix: refreshToken.slice(-6),
          reason: result.reason,
          durationMs: duration,
        });
      }

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      log.error("Token refresh threw exception", {
        tokenSuffix: refreshToken.slice(-6),
        error: (error as Error)?.message ?? String(error),
        durationMs: duration,
      });

      return {
        type: "failed",
        reason: "network_error",
        message: (error as Error)?.message ?? "Unknown error during refresh",
      };
    }
  }

  /**
   * Remove stale entries that have been pending too long.
   * This prevents memory leaks from stuck or abandoned refresh operations.
   */
  private cleanup(): void {
    const now = Date.now();
    const staleTokens: string[] = [];

    for (const [token, entry] of this.pending.entries()) {
      if (now - entry.startedAt > this.maxEntryAgeMs) {
        staleTokens.push(token);
      }
    }

    for (const token of staleTokens) {
      log.warn("Removing stale refresh entry", {
        tokenSuffix: token.slice(-6),
        ageMs: now - (this.pending.get(token)?.startedAt ?? now),
      });
      this.pending.delete(token);
    }
  }

  /**
   * Check if there's an in-flight refresh for a given token.
   * @param refreshToken - The refresh token to check
   * @returns True if refresh is in progress
   */
  isRefreshing(refreshToken: string): boolean {
    return this.pending.has(refreshToken);
  }

  /**
   * Get the number of pending refresh operations.
   * Useful for debugging and monitoring.
   */
  get pendingCount(): number {
    return this.pending.size;
  }

  /**
   * Clear all pending entries (primarily for testing).
   */
  clear(): void {
    this.pending.clear();
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let refreshQueueInstance: RefreshQueue | null = null;

/**
 * Get the singleton RefreshQueue instance.
 * @param maxEntryAgeMs - Maximum age for pending entries (only used on first call)
 * @returns The global RefreshQueue instance
 */
export function getRefreshQueue(maxEntryAgeMs?: number): RefreshQueue {
  if (!refreshQueueInstance) {
    refreshQueueInstance = new RefreshQueue(maxEntryAgeMs);
  }
  return refreshQueueInstance;
}

/**
 * Reset the singleton instance (primarily for testing).
 */
export function resetRefreshQueue(): void {
  refreshQueueInstance?.clear();
  refreshQueueInstance = null;
}

/**
 * Convenience function to refresh a token using the singleton queue.
 * @param refreshToken - The refresh token to use
 * @returns Token result
 */
export async function queuedRefresh(refreshToken: string): Promise<TokenResult> {
  return getRefreshQueue().refresh(refreshToken);
}
