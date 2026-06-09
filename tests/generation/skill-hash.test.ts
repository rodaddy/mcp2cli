import { describe, expect, test } from "bun:test";
import { computeSchemaHash } from "../../src/generation/skill-hash.ts";

describe("computeSchemaHash", () => {
  test("empty array produces consistent hash", async () => {
    const hash1 = await computeSchemaHash([]);
    const hash2 = await computeSchemaHash([]);
    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(16);
  });

  test("same tools in different order produce same hash (sort independence)", async () => {
    const toolsA = [
      { name: "alpha", description: "First tool" },
      { name: "beta", description: "Second tool" },
    ];
    const toolsB = [
      { name: "beta", description: "Second tool" },
      { name: "alpha", description: "First tool" },
    ];
    const hashA = await computeSchemaHash(toolsA);
    const hashB = await computeSchemaHash(toolsB);
    expect(hashA).toBe(hashB);
  });

  test("tools with undefined description handled correctly", async () => {
    const tools = [
      { name: "no-desc" },
      { name: "with-desc", description: "Has a description" },
    ];
    const hash = await computeSchemaHash(tools);
    expect(hash).toHaveLength(16);
    expect(/^[0-9a-f]{16}$/.test(hash)).toBe(true);
  });

  test("different tool sets produce different hashes", async () => {
    const toolsA = [{ name: "foo", description: "Does foo" }];
    const toolsB = [{ name: "bar", description: "Does bar" }];
    const hashA = await computeSchemaHash(toolsA);
    const hashB = await computeSchemaHash(toolsB);
    expect(hashA).not.toBe(hashB);
  });

  test("description change produces different hash", async () => {
    const toolsA = [{ name: "tool", description: "Version 1" }];
    const toolsB = [{ name: "tool", description: "Version 2" }];
    const hashA = await computeSchemaHash(toolsA);
    const hashB = await computeSchemaHash(toolsB);
    expect(hashA).not.toBe(hashB);
  });

  test("returns 16-char hex string", async () => {
    const hash = await computeSchemaHash([
      { name: "test", description: "A test tool" },
    ]);
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
  });
});
