import { describe, test, expect } from "bun:test";
import { formatTable } from "../../src/format/table.ts";

describe("formatTable", () => {
  test("null -> (empty)", () => {
    expect(formatTable(null)).toBe("(empty)");
  });

  test("undefined -> (empty)", () => {
    expect(formatTable(undefined)).toBe("(empty)");
  });

  test("primitive string -> string value", () => {
    expect(formatTable("hello")).toBe("hello");
  });

  test("primitive number -> stringified", () => {
    expect(formatTable(42)).toBe("42");
  });

  // --- Single object (key/value table) ---

  test("single object -> key/value table with headers", () => {
    const result = formatTable({ id: 1, name: "test" });
    const lines = result.split("\n");
    // Header row
    expect(lines[0]).toMatch(/KEY\s+VALUE/);
    // Separator
    expect(lines[1]).toMatch(/^-+\s+-+$/);
    // Data rows
    expect(lines[2]).toMatch(/id\s+1/);
    expect(lines[3]).toMatch(/name\s+test/);
  });

  test("empty object -> (empty)", () => {
    expect(formatTable({})).toBe("(empty)");
  });

  // --- Array of objects (columnar table) ---

  test("array of objects -> columnar table with aligned headers", () => {
    const data = [
      { id: 1, name: "Alice", active: true },
      { id: 2, name: "Bob", active: false },
    ];
    const result = formatTable(data);
    const lines = result.split("\n");

    // Header row (uppercase)
    expect(lines[0]).toMatch(/ID\s+NAME\s+ACTIVE/);
    // Separator
    expect(lines[1]).toMatch(/^-+\s+-+\s+-+$/);
    // Data rows exist
    expect(lines.length).toBe(4); // header + sep + 2 data rows
  });

  test("numeric columns are right-aligned", () => {
    const data = [
      { name: "short", count: 5 },
      { name: "longer name", count: 100 },
    ];
    const result = formatTable(data);
    const lines = result.split("\n");

    // The count column values should be right-aligned
    // "5" should have more leading spaces than "100"
    const dataLine1 = lines[2] as string;
    const dataLine2 = lines[3] as string;
    // Count column: "  5" vs "100" -- the 5 should be padded
    expect(dataLine1).toContain("  5");
    expect(dataLine2).toContain("100");
  });

  test("empty array -> (empty)", () => {
    expect(formatTable([])).toBe("(empty)");
  });

  test("array of primitives -> single VALUE column", () => {
    const result = formatTable(["a", "b", "c"]);
    const lines = result.split("\n");
    expect(lines[0]).toBe("VALUE");
    expect(lines[1]).toMatch(/^-+$/);
    expect(lines[2]).toBe("a");
    expect(lines[3]).toBe("b");
    expect(lines[4]).toBe("c");
  });

  test("nested objects in rows are JSON-stringified", () => {
    const data = [{ id: 1, settings: { timeout: 30 } }];
    const result = formatTable(data);
    expect(result).toContain('{"timeout":30}');
  });

  test("null values in rows render as empty string", () => {
    const data = [{ id: 1, name: null }];
    const result = formatTable(data);
    const lines = result.split("\n");
    // The name column should be empty for the null value
    expect(lines[2]).toMatch(/1\s+$/);
  });

  test("long values are truncated", () => {
    const longValue = "a".repeat(100);
    const data = [{ description: longValue }];
    const result = formatTable(data);
    expect(result).toContain("...");
    // Should not contain the full 100-char string
    expect(result).not.toContain(longValue);
  });

  test("columns from heterogeneous rows are merged", () => {
    const data = [
      { id: 1, name: "Alice" },
      { id: 2, email: "bob@test.com" },
    ];
    const result = formatTable(data);
    const lines = result.split("\n");
    // Should have all three columns
    expect(lines[0]).toMatch(/ID\s+NAME\s+EMAIL/);
  });
});
