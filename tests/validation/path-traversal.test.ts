import { describe, test, expect } from "bun:test";
import { rejectPathTraversal } from "../../src/validation/validators.ts";

describe("rejectPathTraversal", () => {
  test("rejects simple parent traversal (../../etc/passwd)", () => {
    const result = rejectPathTraversal("../../etc/passwd", "field");
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.code).toBe("PATH_TRAVERSAL");
    }
  });

  test("rejects mid-path traversal (foo/../../../etc/shadow)", () => {
    const result = rejectPathTraversal("foo/../../../etc/shadow", "field");
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.code).toBe("PATH_TRAVERSAL");
    }
  });

  test("rejects trailing dot-dot (foo/..)", () => {
    const result = rejectPathTraversal("foo/..", "field");
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.code).toBe("PATH_TRAVERSAL");
    }
  });

  test("rejects bare dot-dot (..)", () => {
    const result = rejectPathTraversal("..", "field");
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.code).toBe("PATH_TRAVERSAL");
    }
  });

  test("rejects URL-encoded slash (..%2f..%2fetc)", () => {
    const result = rejectPathTraversal("..%2f..%2fetc", "field");
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.code).toBe("PATH_TRAVERSAL");
    }
  });

  test("rejects URL-encoded backslash (..%5c..%5cetc)", () => {
    const result = rejectPathTraversal("..%5c..%5cetc", "field");
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.code).toBe("PATH_TRAVERSAL");
    }
  });

  test("rejects double-encoded slash (..%252f..%252fetc)", () => {
    const result = rejectPathTraversal("..%252f..%252fetc", "field");
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.code).toBe("PATH_TRAVERSAL");
    }
  });

  test("rejects URL-encoded dots (%2e%2e/etc)", () => {
    const result = rejectPathTraversal("%2e%2e/etc", "field");
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.code).toBe("PATH_TRAVERSAL");
    }
  });

  test("rejects mixed case encoding (..%2F..%2Fetc)", () => {
    const result = rejectPathTraversal("..%2F..%2Fetc", "field");
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.code).toBe("PATH_TRAVERSAL");
    }
  });

  test("rejects Windows backslash traversal (..\\..\\windows\\system32)", () => {
    const result = rejectPathTraversal("..\\..\\windows\\system32", "field");
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.code).toBe("PATH_TRAVERSAL");
    }
  });

  test("accepts dot-dot with no separator (..secret)", () => {
    const result = rejectPathTraversal("..secret", "field");
    expect(result.valid).toBe(true);
  });

  test("accepts single dot current dir (./file)", () => {
    const result = rejectPathTraversal("./file", "field");
    expect(result.valid).toBe(true);
  });

  test("accepts normal path with slashes (projects/p1/topics/t1)", () => {
    const result = rejectPathTraversal("projects/p1/topics/t1", "field");
    expect(result.valid).toBe(true);
  });

  test("rejects percent in normal context (100%done)", () => {
    const result = rejectPathTraversal("100%done", "field");
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.code).toBe("PATH_TRAVERSAL");
    }
  });
});
