import { describe, test, expect } from "bun:test";
import { formatOutput, isValidFormat } from "../../src/format/index.ts";

describe("formatOutput dispatcher", () => {
  const sampleData = [
    { id: 1, name: "Alice" },
    { id: 2, name: "Bob" },
  ];

  test("json format -> JSON envelope with success wrapper", () => {
    const result = formatOutput(sampleData, "json");
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.result).toEqual(sampleData);
  });

  test("table format -> aligned columns", () => {
    const result = formatOutput(sampleData, "table");
    expect(result).toContain("ID");
    expect(result).toContain("NAME");
    expect(result).toContain("Alice");
    expect(result).toContain("Bob");
  });

  test("yaml format -> YAML key-value output", () => {
    const result = formatOutput({ id: 1, name: "test" }, "yaml");
    expect(result).toContain("id: 1");
    expect(result).toContain("name: test");
  });

  test("csv format -> comma-separated with header", () => {
    const result = formatOutput(sampleData, "csv");
    const lines = result.split("\n");
    expect(lines[0]).toBe("id,name");
    expect(lines[1]).toBe("1,Alice");
  });

  test("ndjson format -> one JSON line per array element", () => {
    const result = formatOutput(sampleData, "ndjson");
    const lines = result.split("\n");
    expect(lines.length).toBe(2);
    expect(JSON.parse(lines[0] as string)).toEqual({ id: 1, name: "Alice" });
  });

  test("json format with null data", () => {
    const result = formatOutput(null, "json");
    expect(JSON.parse(result)).toEqual({ success: true, result: null });
  });
});

describe("isValidFormat", () => {
  test("valid formats return true", () => {
    expect(isValidFormat("json")).toBe(true);
    expect(isValidFormat("table")).toBe(true);
    expect(isValidFormat("yaml")).toBe(true);
    expect(isValidFormat("csv")).toBe(true);
    expect(isValidFormat("ndjson")).toBe(true);
  });

  test("invalid formats return false", () => {
    expect(isValidFormat("xml")).toBe(false);
    expect(isValidFormat("")).toBe(false);
    expect(isValidFormat("JSON")).toBe(false);
    expect(isValidFormat("tsv")).toBe(false);
  });
});
