import { describe, test, expect } from "bun:test";
import {
  validateIdentifier,
  validateText,
} from "../../src/validation/pipelines.ts";

describe("validateIdentifier pipeline", () => {
  test("accepts clean identifier (abc-123_def)", () => {
    const result = validateIdentifier("abc-123_def", "field");
    expect(result.valid).toBe(true);
  });

  test("rejects traversal in identifier (../secret)", () => {
    const result = validateIdentifier("../secret", "field");
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.code).toBe("PATH_TRAVERSAL");
    }
  });
});

describe("validateText pipeline", () => {
  test("rejects control char in text (hello + null byte)", () => {
    const result = validateText("hello\x00", "field");
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.code).toBe("CONTROL_CHAR");
    }
  });

  test("accepts question mark in text -- lenient (what is this?)", () => {
    const result = validateText("what is this?", "field");
    expect(result.valid).toBe(true);
  });
});
