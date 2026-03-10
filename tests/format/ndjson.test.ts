import { describe, test, expect } from "bun:test";
import { formatNdjson } from "../../src/format/ndjson.ts";

describe("formatNdjson", () => {
  test("null -> 'null'", () => {
    expect(formatNdjson(null)).toBe("null");
  });

  test("undefined -> 'null'", () => {
    expect(formatNdjson(undefined)).toBe("null");
  });

  test("single object -> one JSON line", () => {
    const result = formatNdjson({ id: 1, name: "test" });
    expect(result).toBe('{"id":1,"name":"test"}');
    // Should be exactly one line
    expect(result.split("\n").length).toBe(1);
  });

  test("array of objects -> one JSON line per element", () => {
    const data = [
      { id: 1, name: "Alice" },
      { id: 2, name: "Bob" },
    ];
    const result = formatNdjson(data);
    const lines = result.split("\n");
    expect(lines.length).toBe(2);
    expect(JSON.parse(lines[0] as string)).toEqual({ id: 1, name: "Alice" });
    expect(JSON.parse(lines[1] as string)).toEqual({ id: 2, name: "Bob" });
  });

  test("empty array -> empty string", () => {
    expect(formatNdjson([])).toBe("");
  });

  test("array of primitives -> one line per element", () => {
    const result = formatNdjson([1, "two", true, null]);
    const lines = result.split("\n");
    expect(lines.length).toBe(4);
    expect(lines[0]).toBe("1");
    expect(lines[1]).toBe('"two"');
    expect(lines[2]).toBe("true");
    expect(lines[3]).toBe("null");
  });

  test("each line is valid JSON", () => {
    const data = [
      { id: 1, nested: { a: [1, 2] } },
      { id: 2, nested: { b: "test" } },
    ];
    const result = formatNdjson(data);
    const lines = result.split("\n");
    for (const line of lines) {
      expect(() => JSON.parse(line as string)).not.toThrow();
    }
  });

  test("primitive number -> stringified", () => {
    expect(formatNdjson(42)).toBe("42");
  });

  test("primitive string -> JSON string", () => {
    expect(formatNdjson("hello")).toBe('"hello"');
  });

  test("boolean -> JSON boolean", () => {
    expect(formatNdjson(true)).toBe("true");
  });
});
