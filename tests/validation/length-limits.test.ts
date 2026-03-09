import { describe, test, expect } from "bun:test";
import {
  rejectOverlongInput,
  rejectPathTraversal,
} from "../../src/validation/validators.ts";

describe("rejectOverlongInput", () => {
  test("rejects 10001 character string", () => {
    const result = rejectOverlongInput("a".repeat(10001), "field");
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.code).toBe("INPUT_TOO_LONG");
      expect(result.field).toBe("field");
      expect(result.message).toContain("maximum length");
    }
  });

  test("accepts exactly 10000 characters", () => {
    const result = rejectOverlongInput("a".repeat(10000), "field");
    expect(result.valid).toBe(true);
  });

  test("accepts empty string", () => {
    const result = rejectOverlongInput("", "field");
    expect(result.valid).toBe(true);
  });

  test("accepts spaces-only string", () => {
    const result = rejectOverlongInput("   ", "field");
    expect(result.valid).toBe(true);
  });

  test("accepts unicode emoji", () => {
    const result = rejectOverlongInput("workflow-\ud83d\ude00", "field");
    expect(result.valid).toBe(true);
  });

  test("long string with traversal caught by path traversal validator", () => {
    const input = "a".repeat(9990) + "/../x";
    const result = rejectPathTraversal(input, "field");
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.code).toBe("PATH_TRAVERSAL");
    }
  });
});
