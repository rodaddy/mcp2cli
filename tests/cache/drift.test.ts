import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { detectDrift } from "../../src/cache/drift.ts";
import { setLogLevel, resetLogLevel } from "../../src/logger/index.ts";
import type { CachedToolSchema } from "../../src/cache/types.ts";

// Suppress log output during tests
beforeEach(() => setLogLevel("silent"));
afterEach(() => resetLogLevel());

function makeTool(
  name: string,
  hash: string,
  overrides?: Partial<CachedToolSchema>,
): CachedToolSchema {
  return {
    name,
    description: `Description for ${name}`,
    inputSchema: {
      type: "object",
      properties: {},
    },
    hash,
    ...overrides,
  };
}

const EARLIER = "2026-03-09T06:00:00.000Z";

// -- detectDrift --

describe("detectDrift", () => {
  test("no drift when cached and live are identical", () => {
    const tools = [makeTool("tool_a", "hash1"), makeTool("tool_b", "hash2")];
    const result = detectDrift("svc", tools, tools, EARLIER);
    expect(result.hasDrift).toBe(false);
    expect(result.changes).toHaveLength(0);
    expect(result.service).toBe("svc");
  });

  test("detects added tools", () => {
    const cached = [makeTool("tool_a", "hash1")];
    const live = [makeTool("tool_a", "hash1"), makeTool("tool_b", "hash2")];
    const result = detectDrift("svc", cached, live, EARLIER);

    expect(result.hasDrift).toBe(true);
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0]!.tool).toBe("tool_b");
    expect(result.changes[0]!.type).toBe("added");
  });

  test("detects removed tools", () => {
    const cached = [makeTool("tool_a", "hash1"), makeTool("tool_b", "hash2")];
    const live = [makeTool("tool_a", "hash1")];
    const result = detectDrift("svc", cached, live, EARLIER);

    expect(result.hasDrift).toBe(true);
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0]!.tool).toBe("tool_b");
    expect(result.changes[0]!.type).toBe("removed");
  });

  test("detects changed tools via hash mismatch", () => {
    const cached = [makeTool("tool_a", "hash_v1")];
    const live = [makeTool("tool_a", "hash_v2")];
    const result = detectDrift("svc", cached, live, EARLIER);

    expect(result.hasDrift).toBe(true);
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0]!.tool).toBe("tool_a");
    expect(result.changes[0]!.type).toBe("changed");
  });

  test("detects multiple changes simultaneously", () => {
    const cached = [
      makeTool("kept", "hash1"),
      makeTool("removed", "hash2"),
      makeTool("changed", "old_hash"),
    ];
    const live = [
      makeTool("kept", "hash1"),
      makeTool("added", "hash_new"),
      makeTool("changed", "new_hash"),
    ];
    const result = detectDrift("svc", cached, live, EARLIER);

    expect(result.hasDrift).toBe(true);
    expect(result.changes).toHaveLength(3);

    // Sorted by tool name
    const types = result.changes.map((c) => `${c.type}:${c.tool}`);
    expect(types).toContain("added:added");
    expect(types).toContain("removed:removed");
    expect(types).toContain("changed:changed");
  });

  test("includes details for changed tools -- params added", () => {
    const cached = [
      makeTool("tool", "hash1", {
        inputSchema: {
          type: "object",
          properties: { name: { type: "string" } },
        },
      }),
    ];
    const live = [
      makeTool("tool", "hash2", {
        inputSchema: {
          type: "object",
          properties: {
            name: { type: "string" },
            email: { type: "string" },
          },
        },
      }),
    ];
    const result = detectDrift("svc", cached, live, EARLIER);

    expect(result.hasDrift).toBe(true);
    expect(result.changes[0]!.details).toContain("params added: email");
  });

  test("includes details for changed tools -- params removed", () => {
    const cached = [
      makeTool("tool", "hash1", {
        inputSchema: {
          type: "object",
          properties: {
            name: { type: "string" },
            legacy: { type: "string" },
          },
        },
      }),
    ];
    const live = [
      makeTool("tool", "hash2", {
        inputSchema: {
          type: "object",
          properties: { name: { type: "string" } },
        },
      }),
    ];
    const result = detectDrift("svc", cached, live, EARLIER);

    expect(result.hasDrift).toBe(true);
    expect(result.changes[0]!.details).toContain("params removed: legacy");
  });

  test("includes details for changed tools -- required changed", () => {
    const cached = [
      makeTool("tool", "hash1", {
        inputSchema: {
          type: "object",
          properties: { name: { type: "string" } },
          required: [],
        },
      }),
    ];
    const live = [
      makeTool("tool", "hash2", {
        inputSchema: {
          type: "object",
          properties: { name: { type: "string" } },
          required: ["name"],
        },
      }),
    ];
    const result = detectDrift("svc", cached, live, EARLIER);

    expect(result.hasDrift).toBe(true);
    expect(result.changes[0]!.details).toContain("newly required: name");
  });

  test("includes details for changed tools -- description changed", () => {
    const cached = [makeTool("tool", "hash1", { description: "Old desc" })];
    const live = [makeTool("tool", "hash2", { description: "New desc" })];
    const result = detectDrift("svc", cached, live, EARLIER);

    expect(result.hasDrift).toBe(true);
    expect(result.changes[0]!.details).toContain("description changed");
  });

  test("changes are sorted by tool name", () => {
    const cached = [makeTool("z_tool", "h1"), makeTool("a_tool", "h2")];
    const live = [makeTool("z_tool", "h1_new"), makeTool("a_tool", "h2_new")];
    const result = detectDrift("svc", cached, live, EARLIER);

    expect(result.changes[0]!.tool).toBe("a_tool");
    expect(result.changes[1]!.tool).toBe("z_tool");
  });

  test("result includes timestamps", () => {
    const cached = [makeTool("tool", "hash1")];
    const live = [makeTool("tool", "hash2")];
    const result = detectDrift("svc", cached, live, EARLIER);

    expect(result.cachedAt).toBe(EARLIER);
    expect(result.detectedAt).toBeTruthy();
    // detectedAt should be a valid ISO string
    expect(new Date(result.detectedAt).toISOString()).toBe(result.detectedAt);
  });

  test("empty cached and empty live -- no drift", () => {
    const result = detectDrift("svc", [], [], EARLIER);
    expect(result.hasDrift).toBe(false);
    expect(result.changes).toHaveLength(0);
  });

  test("empty cached with new live tools -- all added", () => {
    const live = [makeTool("tool_a", "h1"), makeTool("tool_b", "h2")];
    const result = detectDrift("svc", [], live, EARLIER);
    expect(result.hasDrift).toBe(true);
    expect(result.changes).toHaveLength(2);
    expect(result.changes.every((c) => c.type === "added")).toBe(true);
  });
});
