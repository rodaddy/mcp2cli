import { describe, test, expect } from "bun:test";
import { rejectQueryFragment } from "../../src/validation/validators.ts";

describe("rejectQueryFragment", () => {
  test("rejects question mark in ID (abc123?fields=name)", () => {
    const result = rejectQueryFragment("abc123?fields=name", "field");
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.code).toBe("QUERY_INJECTION");
    }
  });

  test("rejects hash in ID (abc123#section)", () => {
    const result = rejectQueryFragment("abc123#section", "field");
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.code).toBe("FRAGMENT_INJECTION");
    }
  });

  test("rejects multiple query params (id?a=1&b=2)", () => {
    const result = rejectQueryFragment("id?a=1&b=2", "field");
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.code).toBe("QUERY_INJECTION");
    }
  });

  test("rejects question mark at start (?query)", () => {
    const result = rejectQueryFragment("?query", "field");
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.code).toBe("QUERY_INJECTION");
    }
  });

  test("rejects hash at start (#fragment)", () => {
    const result = rejectQueryFragment("#fragment", "field");
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.code).toBe("FRAGMENT_INJECTION");
    }
  });

  test("rejects both ? and # with QUERY_INJECTION first (id?q=1#frag)", () => {
    const result = rejectQueryFragment("id?q=1#frag", "field");
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.code).toBe("QUERY_INJECTION");
    }
  });

  test("accepts clean ID with hyphens (my-workflow-id)", () => {
    const result = rejectQueryFragment("my-workflow-id", "field");
    expect(result.valid).toBe(true);
  });

  test("accepts clean ID with underscores (n8n_list_workflows)", () => {
    const result = rejectQueryFragment("n8n_list_workflows", "field");
    expect(result.valid).toBe(true);
  });
});
