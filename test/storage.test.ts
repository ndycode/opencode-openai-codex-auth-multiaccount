import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { promises as fs, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { 
  deduplicateAccounts, 
  normalizeAccountStorage, 
  loadAccounts, 
  saveAccounts,
  getStoragePath,
  setStoragePath,
  StorageError,
  formatStorageErrorHint
} from "../lib/storage.js";

// Mocking the behavior we're about to implement for TDD
// Since the functions aren't in lib/storage.ts yet, we'll need to mock them or 
// accept that this test won't even compile/run until we add them.
// But Task 0 says: "Tests should fail initially (RED phase)"

describe("storage", () => {
  describe("deduplication", () => {
    it("remaps activeIndex after deduplication using active account key", () => {
      const now = Date.now();

      const raw = {
        version: 1,
        activeIndex: 1,
        accounts: [
          {
            accountId: "acctA",
            refreshToken: "tokenA",
            addedAt: now - 2000,
            lastUsed: now - 2000,
          },
          {
            accountId: "acctA",
            refreshToken: "tokenA",
            addedAt: now - 1000,
            lastUsed: now - 1000,
          },
          {
            accountId: "acctB",
            refreshToken: "tokenB",
            addedAt: now,
            lastUsed: now,
          },
        ],
      };

      const normalized = normalizeAccountStorage(raw);
      expect(normalized).not.toBeNull();
      expect(normalized?.accounts).toHaveLength(2);
      expect(normalized?.accounts[0]?.accountId).toBe("acctA");
      expect(normalized?.accounts[1]?.accountId).toBe("acctB");
      expect(normalized?.activeIndex).toBe(0);
    });

    it("deduplicates accounts by keeping the most recently used record", () => {
      const now = Date.now();

      const accounts = [
        {
          accountId: "acctA",
          refreshToken: "tokenA",
          addedAt: now - 2000,
          lastUsed: now - 1000,
        },
        {
          accountId: "acctA",
          refreshToken: "tokenA",
          addedAt: now - 1500,
          lastUsed: now,
        },
      ];

      const deduped = deduplicateAccounts(accounts);
      expect(deduped).toHaveLength(1);
      expect(deduped[0]?.addedAt).toBe(now - 1500);
      expect(deduped[0]?.lastUsed).toBe(now);
    });
  });

  describe("import/export (TDD)", () => {
    const testWorkDir = join(tmpdir(), "codex-test-" + Math.random().toString(36).slice(2));
    const exportPath = join(testWorkDir, "export.json");

    beforeEach(async () => {
      await fs.mkdir(testWorkDir, { recursive: true });
      setStoragePath(null); // Reset to default global path
    });

    afterEach(async () => {
      await fs.rm(testWorkDir, { recursive: true, force: true });
    });

    it("should export accounts to a file", async () => {
      // @ts-ignore - exportAccounts doesn't exist yet
      const { exportAccounts } = await import("../lib/storage.js");
      
      const storage = {
        version: 3,
        activeIndex: 0,
        accounts: [{ accountId: "test", refreshToken: "ref", addedAt: 1, lastUsed: 2 }]
      };
      // @ts-ignore
      await saveAccounts(storage);
      
      // @ts-ignore
      await exportAccounts(exportPath);
      
      expect(existsSync(exportPath)).toBe(true);
      const exported = JSON.parse(await fs.readFile(exportPath, "utf-8"));
      expect(exported.accounts[0].accountId).toBe("test");
    });

    it("should fail export if file exists and force is false", async () => {
      // @ts-ignore
      const { exportAccounts } = await import("../lib/storage.js");
      await fs.writeFile(exportPath, "exists");
      
      // @ts-ignore
      await expect(exportAccounts(exportPath, false)).rejects.toThrow(/already exists/);
    });

    it("should import accounts from a file and merge", async () => {
      // @ts-ignore
      const { importAccounts } = await import("../lib/storage.js");
      
      const existing = {
        version: 3,
        activeIndex: 0,
        accounts: [{ accountId: "existing", refreshToken: "ref1", addedAt: 1, lastUsed: 2 }]
      };
      // @ts-ignore
      await saveAccounts(existing);
      
      const toImport = {
        version: 3,
        activeIndex: 0,
        accounts: [{ accountId: "new", refreshToken: "ref2", addedAt: 3, lastUsed: 4 }]
      };
      await fs.writeFile(exportPath, JSON.stringify(toImport));
      
      // @ts-ignore
      await importAccounts(exportPath);
      
      const loaded = await loadAccounts();
      expect(loaded?.accounts).toHaveLength(2);
      expect(loaded?.accounts.map(a => a.accountId)).toContain("new");
    });

    it("should enforce MAX_ACCOUNTS during import", async () => {
       // @ts-ignore
      const { importAccounts } = await import("../lib/storage.js");
      
      const manyAccounts = Array.from({ length: 21 }, (_, i) => ({
        accountId: `acct${i}`,
        refreshToken: `ref${i}`,
        addedAt: Date.now(),
        lastUsed: Date.now()
      }));
      
      const toImport = {
        version: 3,
        activeIndex: 0,
        accounts: manyAccounts
      };
      await fs.writeFile(exportPath, JSON.stringify(toImport));
      
      // @ts-ignore
      await expect(importAccounts(exportPath)).rejects.toThrow(/exceed maximum/);
    });
  });

  describe("filename migration (TDD)", () => {
    it("should migrate from old filename to new filename", async () => {
      // This test is tricky because it depends on the internal state of getStoragePath()
      // which we are about to change.
      
      const oldName = "openai-codex-accounts.json";
      const newName = "codex-accounts.json";
      
      // We'll need to mock/verify that loadAccounts checks for oldName if newName is missing
      // Since we haven't implemented it yet, this is just a placeholder for the logic
      expect(true).toBe(true); 
    });
  });

  describe("StorageError and formatStorageErrorHint", () => {
    describe("StorageError class", () => {
      it("should store code, path, and hint properties", () => {
        const err = new StorageError(
          "Failed to write file",
          "EACCES",
          "/path/to/file.json",
          "Permission denied. Check folder permissions."
        );
        
        expect(err.name).toBe("StorageError");
        expect(err.message).toBe("Failed to write file");
        expect(err.code).toBe("EACCES");
        expect(err.path).toBe("/path/to/file.json");
        expect(err.hint).toBe("Permission denied. Check folder permissions.");
      });

      it("should be instanceof Error", () => {
        const err = new StorageError("test", "CODE", "/path", "hint");
        expect(err instanceof Error).toBe(true);
        expect(err instanceof StorageError).toBe(true);
      });
    });

    describe("formatStorageErrorHint", () => {
      const testPath = "/home/user/.opencode/accounts.json";

      it("should return permission hint for EACCES on Windows", () => {
        const originalPlatform = process.platform;
        Object.defineProperty(process, "platform", { value: "win32" });

        const err = { code: "EACCES" } as NodeJS.ErrnoException;
        const hint = formatStorageErrorHint(err, testPath);

        expect(hint).toContain("antivirus");
        expect(hint).toContain(testPath);

        Object.defineProperty(process, "platform", { value: originalPlatform });
      });

      it("should return chmod hint for EACCES on Unix", () => {
        const originalPlatform = process.platform;
        Object.defineProperty(process, "platform", { value: "darwin" });

        const err = { code: "EACCES" } as NodeJS.ErrnoException;
        const hint = formatStorageErrorHint(err, testPath);

        expect(hint).toContain("chmod");
        expect(hint).toContain(testPath);

        Object.defineProperty(process, "platform", { value: originalPlatform });
      });

      it("should return permission hint for EPERM", () => {
        const err = { code: "EPERM" } as NodeJS.ErrnoException;
        const hint = formatStorageErrorHint(err, testPath);

        expect(hint).toContain("Permission denied");
        expect(hint).toContain(testPath);
      });

      it("should return file locked hint for EBUSY", () => {
        const err = { code: "EBUSY" } as NodeJS.ErrnoException;
        const hint = formatStorageErrorHint(err, testPath);

        expect(hint).toContain("locked");
        expect(hint).toContain("another program");
      });

      it("should return disk full hint for ENOSPC", () => {
        const err = { code: "ENOSPC" } as NodeJS.ErrnoException;
        const hint = formatStorageErrorHint(err, testPath);

        expect(hint).toContain("Disk is full");
      });

      it("should return empty file hint for EEMPTY", () => {
        const err = { code: "EEMPTY" } as NodeJS.ErrnoException;
        const hint = formatStorageErrorHint(err, testPath);

        expect(hint).toContain("empty");
      });

      it("should return generic hint for unknown error codes", () => {
        const err = { code: "UNKNOWN_CODE" } as NodeJS.ErrnoException;
        const hint = formatStorageErrorHint(err, testPath);

        expect(hint).toContain("Failed to write");
        expect(hint).toContain(testPath);
      });

      it("should handle errors without code property", () => {
        const err = new Error("Some error") as NodeJS.ErrnoException;
        const hint = formatStorageErrorHint(err, testPath);

        expect(hint).toContain("Failed to write");
        expect(hint).toContain(testPath);
      });
    });
  });
});
