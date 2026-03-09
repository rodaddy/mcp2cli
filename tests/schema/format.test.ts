import { describe, expect, test } from "bun:test";
import {
  truncateDescription,
  formatToolListing,
  formatSchemaOutput,
} from "../../src/schema/format.ts";
import type { SchemaOutput, ToolListing } from "../../src/schema/types.ts";

// -- truncateDescription --

describe("truncateDescription", () => {
  test("short string returned unchanged", () => {
    expect(truncateDescription("Short desc")).toBe("Short desc");
  });

  test("first sentence extracted", () => {
    expect(truncateDescription("First sentence. Second sentence.")).toBe(
      "First sentence.",
    );
  });

  test("long string truncated at 80 chars with ellipsis", () => {
    const longStr =
      "This is a single very long sentence without any period that goes on and on and exceeds eighty characters easily";
    const result = truncateDescription(longStr);
    expect(result.length).toBeLessThanOrEqual(83); // 80 + "..."
    expect(result.endsWith("...")).toBe(true);
  });

  test("empty string returns no description placeholder", () => {
    expect(truncateDescription("")).toBe("(no description)");
  });

  test("undefined returns no description placeholder", () => {
    expect(truncateDescription(undefined as unknown as string)).toBe(
      "(no description)",
    );
  });

  test("first sentence longer than 80 chars truncates at 80", () => {
    const longSentence =
      "This is a really long first sentence that is definitely longer than eighty characters in total length. Short second.";
    const result = truncateDescription(longSentence);
    expect(result.length).toBeLessThanOrEqual(83);
  });
});

// -- formatToolListing --

describe("formatToolListing", () => {
  const listing: ToolListing = {
    service: "n8n",
    description: "Mock n8n MCP server",
    tools: [
      { name: "create_item", description: "Create a new item" },
      { name: "error_tool", description: "Always returns an error" },
      { name: "json_tool", description: "Returns JSON data" },
    ],
    usage: "mcp2cli n8n <tool> [--params '{}']",
  };

  test("human mode contains section headers", () => {
    const output = formatToolListing(listing, false);
    expect(output).toContain("TOOLS:");
    expect(output).toContain("USAGE:");
    expect(output).toContain("EXAMPLES:");
  });

  test("human mode lists tools", () => {
    const output = formatToolListing(listing, false);
    expect(output).toContain("create_item");
    expect(output).toContain("error_tool");
    expect(output).toContain("json_tool");
  });

  test("human mode includes service name and description", () => {
    const output = formatToolListing(listing, false);
    expect(output).toContain("n8n");
    expect(output).toContain("Mock n8n MCP server");
  });

  test("AI mode returns valid JSON", () => {
    const output = formatToolListing(listing, true);
    const parsed = JSON.parse(output);
    expect(parsed.service).toBe("n8n");
    expect(parsed.tools).toHaveLength(3);
  });

  test("AI mode contains tools array", () => {
    const output = formatToolListing(listing, true);
    const parsed = JSON.parse(output);
    expect(Array.isArray(parsed.tools)).toBe(true);
    expect(parsed.tools[0].name).toBeDefined();
  });

  test("AI mode includes usage", () => {
    const output = formatToolListing(listing, true);
    const parsed = JSON.parse(output);
    expect(parsed.usage).toBeDefined();
  });
});

// -- formatSchemaOutput --

describe("formatSchemaOutput", () => {
  const schema: SchemaOutput = {
    tool: "create_item",
    description: "Create a new item with the given name and type",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Item name" },
        type: { type: "string", enum: ["widget", "gadget"] },
      },
      required: ["name"],
    },
    annotations: { destructiveHint: false },
    usage: "mcp2cli n8n create_item --params '{\"name\": \"value\"}'",
  };

  test("returns valid JSON", () => {
    const output = formatSchemaOutput(schema);
    expect(() => JSON.parse(output)).not.toThrow();
  });

  test("contains inputSchema", () => {
    const output = formatSchemaOutput(schema);
    const parsed = JSON.parse(output);
    expect(parsed.inputSchema).toBeDefined();
    expect(parsed.inputSchema.type).toBe("object");
  });

  test("contains usage field", () => {
    const output = formatSchemaOutput(schema);
    const parsed = JSON.parse(output);
    expect(parsed.usage).toContain("mcp2cli");
  });

  test("handles empty properties", () => {
    const emptySchema: SchemaOutput = {
      tool: "error_tool",
      description: "Always errors",
      inputSchema: {
        type: "object",
        properties: {},
        required: [],
      },
      usage: "mcp2cli n8n error_tool",
    };
    const output = formatSchemaOutput(emptySchema);
    const parsed = JSON.parse(output);
    expect(parsed.inputSchema).toBeDefined();
  });

  test("includes annotations when present", () => {
    const output = formatSchemaOutput(schema);
    const parsed = JSON.parse(output);
    expect(parsed.annotations).toEqual({ destructiveHint: false });
  });

  test("omits annotations when undefined", () => {
    const noAnnotations: SchemaOutput = {
      tool: "test",
      description: "Test tool",
      inputSchema: { type: "object" },
      usage: "mcp2cli svc test",
    };
    const output = formatSchemaOutput(noAnnotations);
    const parsed = JSON.parse(output);
    expect(parsed.annotations).toBeUndefined();
  });
});
