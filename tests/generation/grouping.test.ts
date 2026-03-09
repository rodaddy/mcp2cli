import { describe, expect, test } from "bun:test";
import type { SchemaOutput } from "../../src/schema/types.ts";
import {
  detectPrefixGroups,
  stripServicePrefix,
} from "../../src/generation/grouping.ts";

// -- Test data --

function makeSchema(name: string, desc = ""): SchemaOutput {
  return {
    tool: name,
    description: desc || `${name} description`,
    inputSchema: { type: "object", properties: {}, required: [] },
    usage: `mcp2cli svc ${name}`,
  };
}

// -- stripServicePrefix --

describe("stripServicePrefix", () => {
  test("detects and strips common prefix", () => {
    const result = stripServicePrefix([
      "n8n_list_workflows",
      "n8n_get_workflow",
      "n8n_create_workflow",
    ]);
    expect(result.prefix).toBe("n8n");
    expect(result.stripped).toEqual([
      "list_workflows",
      "get_workflow",
      "create_workflow",
    ]);
  });

  test("returns names unchanged when no common prefix", () => {
    const result = stripServicePrefix([
      "create_item",
      "error_tool",
      "json_tool",
    ]);
    expect(result.prefix).toBe("");
    expect(result.stripped).toEqual([
      "create_item",
      "error_tool",
      "json_tool",
    ]);
  });

  test("handles single tool (no prefix to detect)", () => {
    const result = stripServicePrefix(["n8n_list_workflows"]);
    expect(result.prefix).toBe("");
    expect(result.stripped).toEqual(["n8n_list_workflows"]);
  });

  test("handles empty array", () => {
    const result = stripServicePrefix([]);
    expect(result.prefix).toBe("");
    expect(result.stripped).toEqual([]);
  });

  test("strips multi-segment prefix", () => {
    const result = stripServicePrefix([
      "my_svc_list_items",
      "my_svc_get_item",
      "my_svc_delete_item",
    ]);
    expect(result.prefix).toBe("my_svc");
    expect(result.stripped).toEqual([
      "list_items",
      "get_item",
      "delete_item",
    ]);
  });
});

// -- detectPrefixGroups --

describe("detectPrefixGroups", () => {
  test("groups tools by noun (last segment)", () => {
    const tools = [
      makeSchema("n8n_list_workflows"),
      makeSchema("n8n_get_workflow"),
      makeSchema("n8n_create_workflow"),
      makeSchema("n8n_get_execution"),
      makeSchema("n8n_list_executions"),
    ];
    const groups = detectPrefixGroups(tools, "n8n");

    // Should have 2 groups: workflow and execution
    expect(groups.length).toBe(2);

    const workflowGroup = groups.find(
      (g) => g.prefix === "workflow" || g.prefix === "workflows",
    );
    expect(workflowGroup).toBeDefined();
    expect(workflowGroup!.tools).toHaveLength(3);
    expect(workflowGroup!.filename).toMatch(/\.md$/);

    const executionGroup = groups.find(
      (g) => g.prefix === "execution" || g.prefix === "executions",
    );
    expect(executionGroup).toBeDefined();
    expect(executionGroup!.tools).toHaveLength(2);
  });

  test("single-tool groups merge into general", () => {
    const tools = [
      makeSchema("n8n_list_workflows"),
      makeSchema("n8n_get_workflow"),
      makeSchema("n8n_ping_server"), // singleton
    ];
    const groups = detectPrefixGroups(tools, "n8n");

    const generalGroup = groups.find((g) => g.prefix === "general");
    expect(generalGroup).toBeDefined();
    expect(generalGroup!.tools).toHaveLength(1);
    expect(generalGroup!.tools[0]!.tool).toBe("n8n_ping_server");
  });

  test("falls back to alphabetical chunking when < 2 groups", () => {
    // All tools have same noun -- should fall back
    const tools = [
      makeSchema("create_item"),
      makeSchema("error_tool"),
      makeSchema("json_tool"),
    ];
    const groups = detectPrefixGroups(tools, "mock");

    // Should have at least 1 group with all tools
    expect(groups.length).toBeGreaterThanOrEqual(1);
    const totalTools = groups.reduce((sum, g) => sum + g.tools.length, 0);
    expect(totalTools).toBe(3);
  });

  test("each group has valid filename and label", () => {
    const tools = [
      makeSchema("n8n_list_workflows"),
      makeSchema("n8n_get_workflow"),
      makeSchema("n8n_get_execution"),
      makeSchema("n8n_list_executions"),
    ];
    const groups = detectPrefixGroups(tools, "n8n");

    for (const group of groups) {
      expect(group.filename).toMatch(/^[a-z0-9-]+\.md$/);
      expect(group.label.length).toBeGreaterThan(0);
      expect(group.label[0]).toBe(group.label[0]!.toUpperCase());
    }
  });

  test("handles empty tools array", () => {
    const groups = detectPrefixGroups([], "svc");
    expect(groups).toEqual([]);
  });
});
