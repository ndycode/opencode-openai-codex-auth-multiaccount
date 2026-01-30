import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createInterface } from "node:readline/promises";

vi.mock("node:readline/promises", () => ({
  createInterface: vi.fn(),
}));

const mockRl = {
  question: vi.fn(),
  close: vi.fn(),
};

describe("CLI Module", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.FORCE_INTERACTIVE_MODE = "1";
    mockRl.question.mockReset();
    mockRl.close.mockReset();
    vi.mocked(createInterface).mockReturnValue(mockRl as any);
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    delete process.env.FORCE_INTERACTIVE_MODE;
    vi.restoreAllMocks();
  });

  describe("promptAddAnotherAccount", () => {
    it("returns true for 'y' input", async () => {
      mockRl.question.mockResolvedValueOnce("y");
      
      const { promptAddAnotherAccount } = await import("../lib/cli.js");
      const result = await promptAddAnotherAccount(1);
      
      expect(result).toBe(true);
      expect(mockRl.close).toHaveBeenCalled();
    });

    it("returns true for 'yes' input", async () => {
      mockRl.question.mockResolvedValueOnce("yes");
      
      const { promptAddAnotherAccount } = await import("../lib/cli.js");
      const result = await promptAddAnotherAccount(2);
      
      expect(result).toBe(true);
    });

    it("returns true for 'Y' input (case insensitive)", async () => {
      mockRl.question.mockResolvedValueOnce("Y");
      
      const { promptAddAnotherAccount } = await import("../lib/cli.js");
      const result = await promptAddAnotherAccount(1);
      
      expect(result).toBe(true);
    });

    it("returns false for 'n' input", async () => {
      mockRl.question.mockResolvedValueOnce("n");
      
      const { promptAddAnotherAccount } = await import("../lib/cli.js");
      const result = await promptAddAnotherAccount(1);
      
      expect(result).toBe(false);
    });

    it("returns false for empty input", async () => {
      mockRl.question.mockResolvedValueOnce("");
      
      const { promptAddAnotherAccount } = await import("../lib/cli.js");
      const result = await promptAddAnotherAccount(1);
      
      expect(result).toBe(false);
    });

    it("returns false for random input", async () => {
      mockRl.question.mockResolvedValueOnce("maybe");
      
      const { promptAddAnotherAccount } = await import("../lib/cli.js");
      const result = await promptAddAnotherAccount(1);
      
      expect(result).toBe(false);
    });

    it("includes current count in prompt", async () => {
      mockRl.question.mockResolvedValueOnce("n");
      
      const { promptAddAnotherAccount } = await import("../lib/cli.js");
      await promptAddAnotherAccount(5);
      
      expect(mockRl.question).toHaveBeenCalledWith(
        expect.stringContaining("5 added")
      );
    });

    it("always closes readline interface", async () => {
      mockRl.question.mockRejectedValueOnce(new Error("test error"));
      
      const { promptAddAnotherAccount } = await import("../lib/cli.js");
      
      await expect(promptAddAnotherAccount(1)).rejects.toThrow("test error");
      expect(mockRl.close).toHaveBeenCalled();
    });
  });

  describe("promptLoginMode", () => {
    it("returns 'add' for 'a' input", async () => {
      mockRl.question.mockResolvedValueOnce("a");
      
      const { promptLoginMode } = await import("../lib/cli.js");
      const result = await promptLoginMode([
        { index: 0, email: "test@example.com" },
      ]);
      
      expect(result).toBe("add");
      expect(mockRl.close).toHaveBeenCalled();
    });

    it("returns 'add' for 'add' input", async () => {
      mockRl.question.mockResolvedValueOnce("add");
      
      const { promptLoginMode } = await import("../lib/cli.js");
      const result = await promptLoginMode([{ index: 0 }]);
      
      expect(result).toBe("add");
    });

    it("returns 'fresh' for 'f' input", async () => {
      mockRl.question.mockResolvedValueOnce("f");
      
      const { promptLoginMode } = await import("../lib/cli.js");
      const result = await promptLoginMode([{ index: 0 }]);
      
      expect(result).toBe("fresh");
    });

    it("returns 'fresh' for 'fresh' input", async () => {
      mockRl.question.mockResolvedValueOnce("fresh");
      
      const { promptLoginMode } = await import("../lib/cli.js");
      const result = await promptLoginMode([{ index: 0 }]);
      
      expect(result).toBe("fresh");
    });

    it("is case insensitive", async () => {
      mockRl.question.mockResolvedValueOnce("A");
      
      const { promptLoginMode } = await import("../lib/cli.js");
      const result = await promptLoginMode([{ index: 0 }]);
      
      expect(result).toBe("add");
    });

    it("re-prompts on invalid input then accepts valid", async () => {
      mockRl.question
        .mockResolvedValueOnce("invalid")
        .mockResolvedValueOnce("x")
        .mockResolvedValueOnce("a");
      
      const { promptLoginMode } = await import("../lib/cli.js");
      const result = await promptLoginMode([{ index: 0 }]);
      
      expect(result).toBe("add");
      expect(mockRl.question).toHaveBeenCalledTimes(3);
    });

    it("displays account list with email", async () => {
      mockRl.question.mockResolvedValueOnce("a");
      const consoleSpy = vi.spyOn(console, "log");
      
      const { promptLoginMode } = await import("../lib/cli.js");
      await promptLoginMode([
        { index: 0, email: "user1@example.com" },
        { index: 1, email: "user2@example.com" },
      ]);
      
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("2 account(s)"));
    });

    it("displays account with accountId suffix when no email", async () => {
      mockRl.question.mockResolvedValueOnce("f");
      const consoleSpy = vi.spyOn(console, "log");
      
      const { promptLoginMode } = await import("../lib/cli.js");
      await promptLoginMode([
        { index: 0, accountId: "acc_1234567890" },
      ]);
      
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringMatching(/1\.\s*567890/));
    });

    it("displays plain Account N when no email or accountId", async () => {
      mockRl.question.mockResolvedValueOnce("f");
      const consoleSpy = vi.spyOn(console, "log");
      
      const { promptLoginMode } = await import("../lib/cli.js");
      await promptLoginMode([{ index: 0 }]);
      
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("1. Account"));
    });
  });
});
