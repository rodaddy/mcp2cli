import { describe, test, expect } from "bun:test";
import { formatCsv } from "../../src/format/csv.ts";

describe("formatCsv", () => {
  test("null -> empty string", () => {
    expect(formatCsv(null)).toBe("");
  });

  test("undefined -> empty string", () => {
    expect(formatCsv(undefined)).toBe("");
  });

  // --- Single object ---

  test("single object -> header + one data row", () => {
    const result = formatCsv({ id: 1, name: "Alice" });
    const lines = result.split("\n");
    expect(lines[0]).toBe("id,name");
    expect(lines[1]).toBe("1,Alice");
  });

  test("empty object -> empty string", () => {
    expect(formatCsv({})).toBe("");
  });

  // --- Array of objects ---

  test("array of objects -> header + data rows", () => {
    const data = [
      { id: 1, name: "Alice" },
      { id: 2, name: "Bob" },
    ];
    const result = formatCsv(data);
    const lines = result.split("\n");
    expect(lines[0]).toBe("id,name");
    expect(lines[1]).toBe("1,Alice");
    expect(lines[2]).toBe("2,Bob");
  });

  test("empty array -> empty string", () => {
    expect(formatCsv([])).toBe("");
  });

  // --- RFC 4180 quoting ---

  test("values with commas are quoted", () => {
    const result = formatCsv({ name: "Smith, John" });
    expect(result).toContain('"Smith, John"');
  });

  test("values with double quotes are double-escaped", () => {
    const result = formatCsv({ name: 'say "hello"' });
    expect(result).toContain('"say ""hello"""');
  });

  test("values with newlines are quoted", () => {
    const result = formatCsv({ note: "line1\nline2" });
    expect(result).toContain('"line1\nline2"');
  });

  test("null values in objects render as empty", () => {
    const result = formatCsv({ id: 1, name: null });
    const lines = result.split("\n");
    expect(lines[1]).toBe("1,");
  });

  // --- Nested objects ---

  test("nested objects are JSON-stringified", () => {
    const result = formatCsv({ id: 1, settings: { timeout: 30 } });
    const lines = result.split("\n");
    // JSON contains commas and quotes, so it gets CSV-quoted
    expect(lines[1]).toContain('"{""timeout"":30}"');
  });

  // --- Array of primitives ---

  test("array of primitives -> VALUE column", () => {
    const result = formatCsv(["a", "b", "c"]);
    const lines = result.split("\n");
    expect(lines[0]).toBe("VALUE");
    expect(lines[1]).toBe("a");
    expect(lines[2]).toBe("b");
    expect(lines[3]).toBe("c");
  });

  // --- Heterogeneous rows ---

  test("heterogeneous rows fill missing columns with empty", () => {
    const data = [
      { id: 1, name: "Alice" },
      { id: 2, email: "bob@test.com" },
    ];
    const result = formatCsv(data);
    const lines = result.split("\n");
    expect(lines[0]).toBe("id,name,email");
    expect(lines[1]).toBe("1,Alice,");
    expect(lines[2]).toBe("2,,bob@test.com");
  });

  // --- Primitive value ---

  test("primitive string -> single value", () => {
    expect(formatCsv("hello")).toBe("hello");
  });

  test("primitive with comma -> quoted", () => {
    expect(formatCsv("a,b")).toBe('"a,b"');
  });
});
