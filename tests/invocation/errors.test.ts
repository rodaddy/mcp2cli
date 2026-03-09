import { describe, test, expect } from "bun:test";
import { ToolError } from "../../src/invocation/errors.ts";
import type { ErrorCode } from "../../src/types/index.ts";

describe("ToolError", () => {
  test('has code "TOOL_ERROR"', () => {
    const err = new ToolError("tool failed");
    expect(err.code).toBe("TOOL_ERROR");
  });

  test('has name "ToolError"', () => {
    const err = new ToolError("tool failed");
    expect(err.name).toBe("ToolError");
  });

  test("is instanceof Error", () => {
    const err = new ToolError("tool failed");
    expect(err).toBeInstanceOf(Error);
  });

  test("carries reason field", () => {
    const err = new ToolError("tool failed", "upstream_timeout");
    expect(err.reason).toBe("upstream_timeout");
    // Verify TOOL_ERROR is a valid ErrorCode at type level
    const code: ErrorCode = "TOOL_ERROR";
    expect(code).toBe("TOOL_ERROR");
  });
});
