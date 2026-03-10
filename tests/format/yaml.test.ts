import { describe, test, expect } from "bun:test";
import { formatYaml } from "../../src/format/yaml.ts";

describe("formatYaml", () => {
  test("null -> null", () => {
    expect(formatYaml(null)).toBe("null");
  });

  test("undefined -> null", () => {
    expect(formatYaml(undefined)).toBe("null");
  });

  test("boolean true", () => {
    expect(formatYaml(true)).toBe("true");
  });

  test("number", () => {
    expect(formatYaml(42)).toBe("42");
  });

  test("simple string without special chars", () => {
    expect(formatYaml("hello")).toBe("hello");
  });

  test("string with colon is quoted", () => {
    expect(formatYaml("key: value")).toBe('"key: value"');
  });

  test("string with newline is quoted with escape", () => {
    expect(formatYaml("line1\nline2")).toBe('"line1\\nline2"');
  });

  test("string 'true' is quoted (YAML bool ambiguity)", () => {
    expect(formatYaml("true")).toBe('"true"');
  });

  test("string '123' is quoted (YAML number ambiguity)", () => {
    expect(formatYaml("123")).toBe('"123"');
  });

  test("empty string is quoted", () => {
    expect(formatYaml("")).toBe('""');
  });

  // --- Objects ---

  test("flat object", () => {
    const result = formatYaml({ id: 1, name: "test" });
    expect(result).toContain("id: 1");
    expect(result).toContain("name: test");
  });

  test("nested object", () => {
    const result = formatYaml({ settings: { timeout: 30 } });
    expect(result).toContain("settings:");
    expect(result).toContain("  timeout: 30");
  });

  test("empty object -> {}", () => {
    expect(formatYaml({})).toBe("{}");
  });

  // --- Arrays ---

  test("array of primitives", () => {
    const result = formatYaml([1, 2, 3]);
    expect(result).toContain("- 1");
    expect(result).toContain("- 2");
    expect(result).toContain("- 3");
  });

  test("empty array -> []", () => {
    expect(formatYaml([])).toBe("[]");
  });

  test("array of objects", () => {
    const result = formatYaml([
      { id: 1, name: "Alice" },
      { id: 2, name: "Bob" },
    ]);
    expect(result).toContain("- id: 1");
    expect(result).toContain("  name: Alice");
    expect(result).toContain("- id: 2");
    expect(result).toContain("  name: Bob");
  });

  test("object with array value", () => {
    const result = formatYaml({ tags: ["a", "b"] });
    expect(result).toContain("tags:");
    expect(result).toContain("  - a");
    expect(result).toContain("  - b");
  });

  test("string with double quotes is escaped", () => {
    const result = formatYaml('say "hello"');
    expect(result).toBe('"say \\"hello\\""');
  });

  test("null values in objects", () => {
    const result = formatYaml({ id: 1, name: null });
    expect(result).toContain("id: 1");
    expect(result).toContain("name: null");
  });
});
