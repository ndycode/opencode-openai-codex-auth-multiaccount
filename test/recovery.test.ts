import { describe, it, expect } from "vitest";
import { detectErrorType, isRecoverableError } from "../lib/recovery";

describe("detectErrorType", () => {
  describe("tool_result_missing detection", () => {
    it("detects tool_use without tool_result error", () => {
      const error = {
        type: "invalid_request_error",
        message: "messages.105: `tool_use` ids were found without `tool_result` blocks immediately after: tool-call-59"
      };
      expect(detectErrorType(error)).toBe("tool_result_missing");
    });

    it("detects tool_use/tool_result mismatch error", () => {
      const error = "Each `tool_use` block must have a corresponding `tool_result` block in the next message.";
      expect(detectErrorType(error)).toBe("tool_result_missing");
    });

    it("detects error from string message", () => {
      const error = "tool_use without matching tool_result";
      expect(detectErrorType(error)).toBe("tool_result_missing");
    });
  });

  describe("thinking_block_order detection", () => {
    it("detects thinking first block error", () => {
      const error = "thinking must be the first block in the message";
      expect(detectErrorType(error)).toBe("thinking_block_order");
    });

    it("detects thinking must start with error", () => {
      const error = "Response must start with thinking block";
      expect(detectErrorType(error)).toBe("thinking_block_order");
    });

    it("detects thinking preceeding error", () => {
      const error = "thinking block preceeding tool use is required";
      expect(detectErrorType(error)).toBe("thinking_block_order");
    });

    it("detects thinking expected/found error", () => {
      const error = "Expected thinking block but found text";
      expect(detectErrorType(error)).toBe("thinking_block_order");
    });
  });

  describe("thinking_disabled_violation detection", () => {
    it("detects thinking disabled error", () => {
      const error = "thinking is disabled for this model and cannot contain thinking blocks";
      expect(detectErrorType(error)).toBe("thinking_disabled_violation");
    });
  });

  describe("non-recoverable errors", () => {
    it("returns null for prompt too long error", () => {
      const error = { message: "Prompt is too long" };
      expect(detectErrorType(error)).toBeNull();
    });

    it("returns null for context length exceeded error", () => {
      const error = "context length exceeded";
      expect(detectErrorType(error)).toBeNull();
    });

    it("returns null for generic errors", () => {
      expect(detectErrorType("Something went wrong")).toBeNull();
      expect(detectErrorType({ message: "Unknown error" })).toBeNull();
      expect(detectErrorType(null)).toBeNull();
      expect(detectErrorType(undefined)).toBeNull();
    });

    it("returns null for rate limit errors", () => {
      const error = { message: "Rate limit exceeded. Retry after 5s" };
      expect(detectErrorType(error)).toBeNull();
    });
  });
});

describe("isRecoverableError", () => {
  it("returns true for tool_result_missing", () => {
    const error = "tool_use without tool_result";
    expect(isRecoverableError(error)).toBe(true);
  });

  it("returns true for thinking_block_order", () => {
    const error = "thinking must be the first block";
    expect(isRecoverableError(error)).toBe(true);
  });

  it("returns true for thinking_disabled_violation", () => {
    const error = "thinking is disabled and cannot contain thinking";
    expect(isRecoverableError(error)).toBe(true);
  });

  it("returns false for non-recoverable errors", () => {
    expect(isRecoverableError("Prompt is too long")).toBe(false);
    expect(isRecoverableError("context length exceeded")).toBe(false);
    expect(isRecoverableError("Generic error")).toBe(false);
    expect(isRecoverableError(null)).toBe(false);
  });
});

describe("context error message patterns", () => {
  describe("prompt too long patterns", () => {
    const promptTooLongPatterns = [
      "Prompt is too long",
      "prompt is too long for this model",
      "The prompt is too long",
    ];

    it.each(promptTooLongPatterns)("'%s' is not a recoverable error", (msg) => {
      expect(isRecoverableError(msg)).toBe(false);
      expect(detectErrorType(msg)).toBeNull();
    });
  });

  describe("context length exceeded patterns", () => {
    const contextLengthPatterns = [
      "context length exceeded",
      "context_length_exceeded",
      "maximum context length",
      "exceeds the maximum context window",
    ];

    it.each(contextLengthPatterns)("'%s' is not a recoverable error", (msg) => {
      expect(isRecoverableError(msg)).toBe(false);
      expect(detectErrorType(msg)).toBeNull();
    });
  });

  describe("tool pairing error patterns", () => {
    const toolPairingPatterns = [
      "tool_use ids were found without tool_result blocks immediately after",
      "Each tool_use block must have a corresponding tool_result",
      "tool_use without matching tool_result",
    ];

    it.each(toolPairingPatterns)("'%s' is detected as tool_result_missing", (msg) => {
      expect(detectErrorType(msg)).toBe("tool_result_missing");
      expect(isRecoverableError(msg)).toBe(true);
    });
  });
});
