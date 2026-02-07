import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdir, readFile, writeFile } from "node:fs/promises";

vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn(),
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

describe("opencode-codex", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("getOpenCodeCodexPrompt", () => {
    it("fetches fresh content when no cache exists", async () => {
      const { getOpenCodeCodexPrompt } = await import("../lib/prompts/opencode-codex.js");
      
      vi.mocked(readFile).mockRejectedValue(new Error("ENOENT"));
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        text: () => Promise.resolve("Fresh prompt content"),
        headers: new Map([["etag", '"abc123"']]),
      });

      const result = await getOpenCodeCodexPrompt();
      
      expect(result).toBe("Fresh prompt content");
      expect(mockFetch).toHaveBeenCalled();
      expect(writeFile).toHaveBeenCalledTimes(2);
    });

    it("uses cache when TTL not expired", async () => {
      const { getOpenCodeCodexPrompt } = await import("../lib/prompts/opencode-codex.js");
      
      vi.mocked(readFile)
        .mockResolvedValueOnce("Cached content")
        .mockResolvedValueOnce(JSON.stringify({
          etag: '"old-etag"',
          lastChecked: Date.now() - 1000,
        }));

      const result = await getOpenCodeCodexPrompt();
      
      expect(result).toBe("Cached content");
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("uses ETag for conditional request when cache expired", async () => {
      const { getOpenCodeCodexPrompt } = await import("../lib/prompts/opencode-codex.js");
      
      vi.mocked(readFile)
        .mockResolvedValueOnce("Cached content")
        .mockResolvedValueOnce(JSON.stringify({
          etag: '"old-etag"',
          lastChecked: Date.now() - 20 * 60 * 1000,
        }));
      
      mockFetch.mockResolvedValue({
        ok: false,
        status: 304,
        headers: new Map(),
      });

      const result = await getOpenCodeCodexPrompt();
      
      expect(result).toBe("Cached content");
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: { "If-None-Match": '"old-etag"' },
        })
      );
    });

    it("serves stale content immediately and refreshes cache in background", async () => {
      const { getOpenCodeCodexPrompt } = await import("../lib/prompts/opencode-codex.js");
      
      vi.mocked(readFile)
        .mockResolvedValueOnce("Old cached content")
        .mockResolvedValueOnce(JSON.stringify({
          etag: '"old-etag"',
          lastChecked: Date.now() - 20 * 60 * 1000,
        }));
      
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        text: () => Promise.resolve("New content"),
        headers: new Map([["etag", '"new-etag"']]),
      });

      const first = await getOpenCodeCodexPrompt();
      
      expect(first).toBe("Old cached content");
      await new Promise((resolve) => setTimeout(resolve, 0));
      const second = await getOpenCodeCodexPrompt();
      expect(second).toBe("New content");
      expect(writeFile).toHaveBeenCalledWith(
        expect.stringContaining("opencode-codex.txt"),
        "New content",
        "utf-8"
      );
    });

    it("falls back to cache on network error", async () => {
      const { getOpenCodeCodexPrompt } = await import("../lib/prompts/opencode-codex.js");
      
      vi.mocked(readFile)
        .mockResolvedValueOnce("Cached fallback content")
        .mockResolvedValueOnce(JSON.stringify({
          etag: '"etag"',
          lastChecked: Date.now() - 20 * 60 * 1000,
        }));
      
      mockFetch.mockRejectedValue(new Error("Network error"));

      const result = await getOpenCodeCodexPrompt();
      
      expect(result).toBe("Cached fallback content");
    });

    it("throws when no cache and fetch fails", async () => {
      const { getOpenCodeCodexPrompt } = await import("../lib/prompts/opencode-codex.js");
      
      vi.mocked(readFile).mockRejectedValue(new Error("ENOENT"));
      mockFetch.mockRejectedValue(new Error("Network error"));

      await expect(getOpenCodeCodexPrompt()).rejects.toThrow(
        "Failed to fetch OpenCode codex.txt and no cache available"
      );
    });

    it("falls back to cache on non-OK response", async () => {
      const { getOpenCodeCodexPrompt } = await import("../lib/prompts/opencode-codex.js");
      
      vi.mocked(readFile)
        .mockResolvedValueOnce("Cached content for 500")
        .mockResolvedValueOnce(JSON.stringify({
          etag: '"etag"',
          lastChecked: Date.now() - 20 * 60 * 1000,
        }));
      
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        headers: new Map(),
      });

      const result = await getOpenCodeCodexPrompt();
      
      expect(result).toBe("Cached content for 500");
    });
  });

  describe("getCachedPromptPrefix", () => {
    it("returns first N characters of cached content", async () => {
      const { getCachedPromptPrefix } = await import("../lib/prompts/opencode-codex.js");
      
      vi.mocked(readFile).mockResolvedValue("This is a long cached prompt content");

      const result = await getCachedPromptPrefix(10);
      
      expect(result).toBe("This is a ");
    });

    it("returns null when cache does not exist", async () => {
      const { getCachedPromptPrefix } = await import("../lib/prompts/opencode-codex.js");
      
      vi.mocked(readFile).mockRejectedValue(new Error("ENOENT"));

      const result = await getCachedPromptPrefix();
      
      expect(result).toBeNull();
    });

    it("uses default of 50 characters", async () => {
      const { getCachedPromptPrefix } = await import("../lib/prompts/opencode-codex.js");
      
      const longContent = "A".repeat(100);
      vi.mocked(readFile).mockResolvedValue(longContent);

      const result = await getCachedPromptPrefix();
      
      expect(result).toBe("A".repeat(50));
    });
  });
});
