import { describe, expect, test } from "bun:test";
import type { SchemaOutput } from "../../src/schema/types.ts";
import type { SkillTemplateInput, ToolGroup } from "../../src/generation/types.ts";
import {
  estimateTokens,
  generateReferenceMd,
  generateSkillMd,
} from "../../src/generation/templates.ts";

// -- Test data --

const mockTools = [
  { name: "json_tool", description: "Returns JSON data" },
  { name: "error_tool", description: "Always returns an error" },
  { name: "create_item", description: "Create a new item" },
];

const mockInput: SkillTemplateInput = {
  serviceName: "mock-server",
  description: "A mock MCP server for testing",
  tools: mockTools,
  triggerKeywords: ["mock", "test", "json"],
};

function makeSchemaOutput(
  name: string,
  desc: string,
  properties: Record<string, { type: string; description: string }> = {},
  required: string[] = [],
): SchemaOutput {
  return {
    tool: name,
    description: desc,
    inputSchema: {
      type: "object",
      properties,
      required,
    },
    usage: `mcp2cli mock ${name}${required.length ? ` --params '${JSON.stringify(Object.fromEntries(required.map((r) => [r, "value"])))}'` : ""}`,
  };
}

const mockGroup: ToolGroup = {
  prefix: "data",
  label: "Data Operations",
  tools: [
    makeSchemaOutput("json_tool", "Returns a JSON object with status and data fields", {
      filter: { type: "string", description: "Optional filter expression" },
      limit: { type: "number", description: "Maximum results to return" },
    }),
    makeSchemaOutput(
      "create_item",
      "Create a new item with the given name and type",
      {
        name: { type: "string", description: "Item name (required)" },
        type: { type: "string", description: "Item type" },
        tags: { type: "array", description: "Optional tags" },
      },
      ["name"],
    ),
  ],
  filename: "data-ops.md",
};

// -- estimateTokens --

describe("estimateTokens", () => {
  test("estimates tokens as ceil(length / 4)", () => {
    expect(estimateTokens("hello world")).toBe(3); // 11 chars / 4 = 2.75 -> 3
  });

  test("empty string returns 0", () => {
    expect(estimateTokens("")).toBe(0);
  });

  test("single char returns 1", () => {
    expect(estimateTokens("a")).toBe(1);
  });

  test("exactly 4 chars returns 1", () => {
    expect(estimateTokens("abcd")).toBe(1);
  });
});

// -- generateSkillMd --

describe("generateSkillMd", () => {
  test("produces YAML frontmatter with name and description", () => {
    const md = generateSkillMd(mockInput);
    expect(md).toContain("---");
    expect(md).toContain("name:");
    expect(md).toContain("description:");
    expect(md).toContain("mock-server");
  });

  test("includes triggers array in frontmatter", () => {
    const md = generateSkillMd(mockInput);
    expect(md).toContain("triggers:");
    expect(md).toContain("mock");
    expect(md).toContain("test");
  });

  test("includes quick reference tool table", () => {
    const md = generateSkillMd(mockInput);
    expect(md).toContain("json_tool");
    expect(md).toContain("error_tool");
    expect(md).toContain("create_item");
    // Table headers
    expect(md).toContain("Tool");
    expect(md).toContain("Description");
  });

  test("includes generic invoke pattern", () => {
    const md = generateSkillMd(mockInput);
    expect(md).toContain("mcp2cli");
    expect(md).toContain("mock-server");
  });

  test("wraps auto-generated content in markers", () => {
    const md = generateSkillMd(mockInput);
    expect(md).toContain("<!-- AUTO-GENERATED:START -->");
    expect(md).toContain("<!-- AUTO-GENERATED:END -->");
  });

  test("output stays under 300 tokens for 3-tool mock", () => {
    const md = generateSkillMd(mockInput);
    const tokens = estimateTokens(md);
    expect(tokens).toBeLessThan(300);
  });
});

// -- generateReferenceMd --

describe("generateReferenceMd", () => {
  test("produces per-tool sections with descriptions", () => {
    const md = generateReferenceMd(mockGroup, "mock");
    expect(md).toContain("json_tool");
    expect(md).toContain("Returns a JSON object");
    expect(md).toContain("create_item");
    expect(md).toContain("Create a new item");
  });

  test("includes parameter tables", () => {
    const md = generateReferenceMd(mockGroup, "mock");
    // Parameter table headers
    expect(md).toContain("Name");
    expect(md).toContain("Type");
    expect(md).toContain("Required");
    // Specific params
    expect(md).toContain("filter");
    expect(md).toContain("string");
    expect(md).toContain("limit");
    expect(md).toContain("number");
  });

  test("includes example invocations", () => {
    const md = generateReferenceMd(mockGroup, "mock");
    expect(md).toContain("mcp2cli");
  });

  test("wraps content in AUTO-GENERATED markers", () => {
    const md = generateReferenceMd(mockGroup, "mock");
    expect(md).toContain("<!-- AUTO-GENERATED:START -->");
    expect(md).toContain("<!-- AUTO-GENERATED:END -->");
  });

  test("header includes service name and group label", () => {
    const md = generateReferenceMd(mockGroup, "mock");
    expect(md).toContain("Data Operations");
  });
});
