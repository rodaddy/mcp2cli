import { describe, expect, test } from "bun:test";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  parseDotNotation,
  listToolsForService,
  getToolSchema,
  generateUsageExample,
} from "../../src/schema/introspect.ts";

// -- Test helpers --

interface MockTool {
  name: string;
  description?: string;
  inputSchema: {
    type: "object";
    properties?: Record<string, object>;
    required?: string[];
  };
  annotations?: Record<string, unknown>;
}

function createMockClient(tools: MockTool[]): Client {
  return {
    listTools: async () => ({ tools }),
  } as unknown as Client;
}

// -- parseDotNotation --

describe("parseDotNotation", () => {
  test("valid input returns service and tool", () => {
    const result = parseDotNotation("n8n.json_tool");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.service).toBe("n8n");
      expect(result.value.tool).toBe("json_tool");
    }
  });

  test("no dot returns error", () => {
    const result = parseDotNotation("n8n");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("dot");
    }
  });

  test("empty service returns error", () => {
    const result = parseDotNotation(".tool");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("service");
    }
  });

  test("empty tool returns error", () => {
    const result = parseDotNotation("svc.");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("tool");
    }
  });

  test("multiple dots splits on first dot only", () => {
    const result = parseDotNotation("svc.tool.extra");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.service).toBe("svc");
      expect(result.value.tool).toBe("tool.extra");
    }
  });
});

// -- listToolsForService --

describe("listToolsForService", () => {
  test("returns sorted tool summaries", async () => {
    const client = createMockClient([
      {
        name: "z_tool",
        description: "Zeta tool",
        inputSchema: { type: "object" },
      },
      {
        name: "a_tool",
        description: "Alpha tool",
        inputSchema: { type: "object" },
      },
      {
        name: "m_tool",
        description: "Mid tool",
        inputSchema: { type: "object" },
      },
    ]);
    const result = await listToolsForService(client);
    expect(result).toHaveLength(3);
    expect(result[0]!.name).toBe("a_tool");
    expect(result[1]!.name).toBe("m_tool");
    expect(result[2]!.name).toBe("z_tool");
  });

  test("handles empty tool list", async () => {
    const client = createMockClient([]);
    const result = await listToolsForService(client);
    expect(result).toHaveLength(0);
  });

  test("truncates long descriptions", async () => {
    const longDesc =
      "This is a very long description that exceeds eighty characters and should be truncated by the function to keep listings readable";
    const client = createMockClient([
      {
        name: "tool",
        description: longDesc,
        inputSchema: { type: "object" },
      },
    ]);
    const result = await listToolsForService(client);
    expect(result[0]!.description.length).toBeLessThanOrEqual(83); // 80 + "..."
  });

  test("extracts first sentence for description", async () => {
    const desc = "First sentence. Second sentence with more details.";
    const client = createMockClient([
      {
        name: "tool",
        description: desc,
        inputSchema: { type: "object" },
      },
    ]);
    const result = await listToolsForService(client);
    expect(result[0]!.description).toBe("First sentence.");
  });
});

// -- getToolSchema --

describe("getToolSchema", () => {
  const tools: MockTool[] = [
    {
      name: "json_tool",
      description: "Returns JSON data",
      inputSchema: {
        type: "object",
        properties: {
          filter: { type: "string", description: "Filter expression" },
          limit: { type: "number", description: "Max results" },
        },
        required: [],
      },
      annotations: { readOnlyHint: true },
    },
    {
      name: "create_item",
      description: "Create a new item",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Item name" },
        },
        required: ["name"],
      },
    },
  ];

  test("returns SchemaOutput for existing tool", async () => {
    const client = createMockClient(tools);
    const result = await getToolSchema(client, "json_tool", "n8n");
    expect(result).not.toBeNull();
    expect(result!.tool).toBe("json_tool");
    expect(result!.description).toBe("Returns JSON data");
    expect(result!.inputSchema).toBeDefined();
    expect(result!.usage).toBeDefined();
  });

  test("returns null for nonexistent tool", async () => {
    const client = createMockClient(tools);
    const result = await getToolSchema(client, "nonexistent", "n8n");
    expect(result).toBeNull();
  });

  test("includes annotations when present", async () => {
    const client = createMockClient(tools);
    const result = await getToolSchema(client, "json_tool", "n8n");
    expect(result!.annotations).toEqual({ readOnlyHint: true });
  });

  test("usage includes required params", async () => {
    const client = createMockClient(tools);
    const result = await getToolSchema(client, "create_item", "n8n");
    expect(result!.usage).toContain("name");
  });
});

// -- generateUsageExample --

describe("generateUsageExample", () => {
  test("generates example with required string param", () => {
    const schema = {
      type: "object",
      properties: {
        name: { type: "string" },
      },
      required: ["name"],
    };
    const usage = generateUsageExample("n8n", "create_item", schema);
    expect(usage).toContain("mcp2cli");
    expect(usage).toContain("n8n");
    expect(usage).toContain("create_item");
    expect(usage).toContain("name");
  });

  test("generates placeholder values by type", () => {
    const schema = {
      type: "object",
      properties: {
        count: { type: "number" },
        active: { type: "boolean" },
        items: { type: "array" },
        meta: { type: "object" },
      },
      required: ["count", "active", "items", "meta"],
    };
    const usage = generateUsageExample("svc", "tool", schema);
    // Should contain type-appropriate placeholders
    expect(usage).toContain("--params");
  });
});
