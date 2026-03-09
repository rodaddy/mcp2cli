import { describe, test, expect } from "bun:test";
import {
  rejectControlChars,
  rejectPathTraversal,
} from "../../src/validation/validators.ts";

/**
 * SEC-04: Null bytes and double encoding.
 * Null bytes are caught by SEC-01 (control chars).
 * Double encoding is caught by SEC-02 (% rejection).
 * This file proves the combination covers SEC-04.
 */
describe("null bytes and double encoding (SEC-04)", () => {
  test("null byte mid-string caught by control chars", () => {
    const result = rejectControlChars("valid\x00../../etc/passwd", "field");
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.code).toBe("CONTROL_CHAR");
    }
  });

  test("null byte at end caught by control chars", () => {
    const result = rejectControlChars("valid\x00", "field");
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.code).toBe("CONTROL_CHAR");
    }
  });

  test("double-encoded null (%2500) caught by % rejection", () => {
    const result = rejectPathTraversal("%2500", "field");
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.code).toBe("PATH_TRAVERSAL");
    }
  });

  test("triple-encoded traversal caught by % rejection", () => {
    const result = rejectPathTraversal("%25252e%25252e%25252f", "field");
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.code).toBe("PATH_TRAVERSAL");
    }
  });

  test("encoded null + traversal combo caught by % rejection", () => {
    const result = rejectPathTraversal("..%00/etc/passwd", "field");
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.code).toBe("PATH_TRAVERSAL");
    }
  });

  test("pre-encoded legitimate value (user%40gmail.com) caught by % rejection", () => {
    const result = rejectPathTraversal("user%40gmail.com", "field");
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.code).toBe("PATH_TRAVERSAL");
    }
  });
});
