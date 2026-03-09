import { describe, test, expect } from "bun:test";
import { rejectControlChars } from "../../src/validation/validators.ts";

describe("rejectControlChars", () => {
  test("rejects null byte (0x00)", () => {
    const result = rejectControlChars("hello\x00world", "field");
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.code).toBe("CONTROL_CHAR");
      expect(result.field).toBe("field");
      expect(result.message).toContain("control characters");
    }
  });

  test("rejects newline (0x0A)", () => {
    const result = rejectControlChars("id\ninjected", "field");
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.code).toBe("CONTROL_CHAR");
    }
  });

  test("rejects carriage return (0x0D)", () => {
    const result = rejectControlChars("id\rinjected", "field");
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.code).toBe("CONTROL_CHAR");
    }
  });

  test("rejects tab (0x09)", () => {
    const result = rejectControlChars("id\tvalue", "field");
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.code).toBe("CONTROL_CHAR");
    }
  });

  test("rejects escape character (0x1B)", () => {
    const result = rejectControlChars("id\x1b[31mred", "field");
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.code).toBe("CONTROL_CHAR");
    }
  });

  test("rejects bell character (0x07)", () => {
    const result = rejectControlChars("id\x07beep", "field");
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.code).toBe("CONTROL_CHAR");
    }
  });

  test("rejects backspace (0x08)", () => {
    const result = rejectControlChars("id\x08back", "field");
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.code).toBe("CONTROL_CHAR");
    }
  });

  test("rejects DEL character (0x7F)", () => {
    const result = rejectControlChars("id\x7Fdel", "field");
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.code).toBe("CONTROL_CHAR");
    }
  });

  test("rejects form feed (0x0C)", () => {
    const result = rejectControlChars("id\x0Cpage", "field");
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.code).toBe("CONTROL_CHAR");
    }
  });

  test("accepts clean string", () => {
    const result = rejectControlChars("valid-identifier_123", "field");
    expect(result.valid).toBe(true);
  });
});
