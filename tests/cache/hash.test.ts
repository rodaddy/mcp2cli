import { describe, expect, test } from "bun:test";
import { canonicalJson, hashToolSchema } from "../../src/cache/hash.ts";

// -- canonicalJson --

describe("canonicalJson", () => {
  test("sorts object keys alphabetically", () => {
    const result = canonicalJson({ z: 1, a: 2, m: 3 });
    expect(result).toBe('{"a":2,"m":3,"z":1}');
  });

  test("sorts nested object keys recursively", () => {
    const result = canonicalJson({
      outer: { z: 1, a: 2 },
      alpha: true,
    });
    expect(result).toBe('{"alpha":true,"outer":{"a":2,"z":1}}');
  });

  test("preserves array order (arrays are not sorted)", () => {
    const result = canonicalJson({ items: [3, 1, 2] });
    expect(result).toBe('{"items":[3,1,2]}');
  });

  test("handles null values", () => {
    const result = canonicalJson({ a: null, b: 1 });
    expect(result).toBe('{"a":null,"b":1}');
  });

  test("handles empty objects", () => {
    const result = canonicalJson({});
    expect(result).toBe("{}");
  });

  test("handles primitive values", () => {
    expect(canonicalJson("hello")).toBe('"hello"');
    expect(canonicalJson(42)).toBe("42");
    expect(canonicalJson(true)).toBe("true");
    expect(canonicalJson(null)).toBe("null");
  });

  test("produces no whitespace", () => {
    const result = canonicalJson({ key: { nested: "value" } });
    expect(result).not.toContain(" ");
    expect(result).not.toContain("\n");
  });

  test("identical objects produce identical output regardless of insertion order", () => {
    const a = canonicalJson({ x: 1, y: 2, z: 3 });
    const b = canonicalJson({ z: 3, x: 1, y: 2 });
    expect(a).toBe(b);
  });
});

// -- hashToolSchema --

describe("hashToolSchema", () => {
  const baseTool = {
    name: "test_tool",
    description: "A test tool",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
      },
      required: ["name"],
    },
  };

  test("returns a 64-character hex string (SHA-256)", async () => {
    const hash = await hashToolSchema(baseTool);
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  test("identical schemas produce identical hashes", async () => {
    const hash1 = await hashToolSchema(baseTool);
    const hash2 = await hashToolSchema({ ...baseTool });
    expect(hash1).toBe(hash2);
  });

  test("different schemas produce different hashes", async () => {
    const hash1 = await hashToolSchema(baseTool);
    const hash2 = await hashToolSchema({
      ...baseTool,
      name: "other_tool",
    });
    expect(hash1).not.toBe(hash2);
  });

  test("property order does not affect hash", async () => {
    const hash1 = await hashToolSchema({
      name: "tool",
      description: "desc",
      inputSchema: { type: "object", properties: { a: { type: "string" }, b: { type: "number" } } },
    });
    const hash2 = await hashToolSchema({
      name: "tool",
      description: "desc",
      inputSchema: { type: "object", properties: { b: { type: "number" }, a: { type: "string" } } },
    });
    expect(hash1).toBe(hash2);
  });

  test("missing description defaults to empty string", async () => {
    const hash1 = await hashToolSchema({
      name: "tool",
      inputSchema: { type: "object" },
    });
    const hash2 = await hashToolSchema({
      name: "tool",
      description: "",
      inputSchema: { type: "object" },
    });
    expect(hash1).toBe(hash2);
  });

  test("missing annotations defaults to null", async () => {
    const hash1 = await hashToolSchema({
      name: "tool",
      description: "desc",
      inputSchema: { type: "object" },
    });
    const hash2 = await hashToolSchema({
      name: "tool",
      description: "desc",
      inputSchema: { type: "object" },
      annotations: undefined,
    });
    expect(hash1).toBe(hash2);
  });

  test("different annotations produce different hashes", async () => {
    const hash1 = await hashToolSchema({
      ...baseTool,
      annotations: { readOnly: true },
    });
    const hash2 = await hashToolSchema({
      ...baseTool,
      annotations: { readOnly: false },
    });
    expect(hash1).not.toBe(hash2);
  });
});
