import { describe, expect, test } from "bun:test";
import {
  parseExistingTools,
  computeSkillDiff,
  formatDiffPreview,
} from "../../src/generation/diff.ts";

// -- parseExistingTools --

describe("parseExistingTools", () => {
  test("extracts tools from a quick reference table", () => {
    const content = [
      "# my-service",
      "",
      "## Quick Reference",
      "",
      "| Tool | Description |",
      "|------|-------------|",
      "| list_items | List all items |",
      "| create_item | Create a new item |",
      "| delete_item | Delete an item |",
      "",
      "## Usage",
    ].join("\n");

    const tools = parseExistingTools(content);
    expect(tools).toHaveLength(3);
    expect(tools[0]!.name).toBe("list_items");
    expect(tools[0]!.description).toBe("List all items");
    expect(tools[1]!.name).toBe("create_item");
    expect(tools[2]!.name).toBe("delete_item");
  });

  test("returns empty array when no table exists", () => {
    const content = "# Just a heading\n\nSome text.";
    const tools = parseExistingTools(content);
    expect(tools).toHaveLength(0);
  });

  test("handles table with extra whitespace in cells", () => {
    const content = [
      "| Tool | Description |",
      "|------|-------------|",
      "|  spaced_tool  |  Has spaces around it  |",
    ].join("\n");

    const tools = parseExistingTools(content);
    expect(tools).toHaveLength(1);
    expect(tools[0]!.name).toBe("spaced_tool");
    expect(tools[0]!.description).toBe("Has spaces around it");
  });

  test("stops parsing when table ends (non-table row breaks it)", () => {
    const content = [
      "## Quick Reference",
      "",
      "| Tool | Description |",
      "|------|-------------|",
      "| tool_a | Description A |",
      "| tool_b | Description B |",
      "",
      "This is not a table row.",
    ].join("\n");

    const tools = parseExistingTools(content);
    expect(tools).toHaveLength(2);
    expect(tools[0]!.name).toBe("tool_a");
    expect(tools[1]!.name).toBe("tool_b");
  });
});

// -- computeSkillDiff --

describe("computeSkillDiff", () => {
  test("detects added tools", () => {
    const existing = [
      { name: "tool_a", description: "Tool A" },
    ];
    const newTools = [
      { name: "tool_a", description: "Tool A" },
      { name: "tool_b", description: "Tool B" },
    ];

    const diff = computeSkillDiff("test", existing, newTools);
    expect(diff.hasChanges).toBe(true);
    expect(diff.added).toHaveLength(1);
    expect(diff.added[0]!.tool).toBe("tool_b");
    expect(diff.removed).toHaveLength(0);
    expect(diff.modified).toHaveLength(0);
  });

  test("detects removed tools", () => {
    const existing = [
      { name: "tool_a", description: "Tool A" },
      { name: "tool_b", description: "Tool B" },
    ];
    const newTools = [
      { name: "tool_a", description: "Tool A" },
    ];

    const diff = computeSkillDiff("test", existing, newTools);
    expect(diff.hasChanges).toBe(true);
    expect(diff.removed).toHaveLength(1);
    expect(diff.removed[0]!.tool).toBe("tool_b");
    expect(diff.added).toHaveLength(0);
  });

  test("detects modified tools (description changed)", () => {
    const existing = [
      { name: "tool_a", description: "Old description" },
    ];
    const newTools = [
      { name: "tool_a", description: "New description" },
    ];

    const diff = computeSkillDiff("test", existing, newTools);
    expect(diff.hasChanges).toBe(true);
    expect(diff.modified).toHaveLength(1);
    expect(diff.modified[0]!.tool).toBe("tool_a");
    expect(diff.modified[0]!.details).toContain("Old description");
    expect(diff.modified[0]!.details).toContain("New description");
  });

  test("reports no changes for identical tool lists", () => {
    const tools = [
      { name: "tool_a", description: "Tool A" },
      { name: "tool_b", description: "Tool B" },
    ];

    const diff = computeSkillDiff("test", tools, tools);
    expect(diff.hasChanges).toBe(false);
    expect(diff.added).toHaveLength(0);
    expect(diff.removed).toHaveLength(0);
    expect(diff.modified).toHaveLength(0);
  });

  test("detects mixed changes (add + remove + modify)", () => {
    const existing = [
      { name: "tool_a", description: "Tool A" },
      { name: "tool_b", description: "Old B" },
      { name: "tool_c", description: "Tool C" },
    ];
    const newTools = [
      { name: "tool_a", description: "Tool A" },
      { name: "tool_b", description: "New B" },
      { name: "tool_d", description: "Tool D" },
    ];

    const diff = computeSkillDiff("test", existing, newTools);
    expect(diff.hasChanges).toBe(true);
    expect(diff.added).toHaveLength(1);
    expect(diff.added[0]!.tool).toBe("tool_d");
    expect(diff.removed).toHaveLength(1);
    expect(diff.removed[0]!.tool).toBe("tool_c");
    expect(diff.modified).toHaveLength(1);
    expect(diff.modified[0]!.tool).toBe("tool_b");
  });

  test("includes correct counts", () => {
    const existing = [
      { name: "tool_a", description: "A" },
      { name: "tool_b", description: "B" },
    ];
    const newTools = [
      { name: "tool_a", description: "A" },
      { name: "tool_c", description: "C" },
      { name: "tool_d", description: "D" },
    ];

    const diff = computeSkillDiff("svc", existing, newTools);
    expect(diff.existingToolCount).toBe(2);
    expect(diff.newToolCount).toBe(3);
    expect(diff.service).toBe("svc");
  });
});

// -- formatDiffPreview --

describe("formatDiffPreview", () => {
  test("formats added tools with + prefix", () => {
    const diff = computeSkillDiff(
      "test",
      [],
      [{ name: "new_tool", description: "New" }],
    );
    const output = formatDiffPreview(diff);
    expect(output).toContain("+ new_tool");
    expect(output).toContain("Added (1)");
  });

  test("formats removed tools with - prefix", () => {
    const diff = computeSkillDiff(
      "test",
      [{ name: "old_tool", description: "Old" }],
      [],
    );
    const output = formatDiffPreview(diff);
    expect(output).toContain("- old_tool");
    expect(output).toContain("Removed (1)");
  });

  test("formats modified tools with ~ prefix", () => {
    const diff = computeSkillDiff(
      "test",
      [{ name: "tool_a", description: "Old desc" }],
      [{ name: "tool_a", description: "New desc" }],
    );
    const output = formatDiffPreview(diff);
    expect(output).toContain("~ tool_a");
    expect(output).toContain("Modified (1)");
  });

  test("reports no changes when identical", () => {
    const tools = [{ name: "tool_a", description: "A" }];
    const diff = computeSkillDiff("test", tools, tools);
    const output = formatDiffPreview(diff);
    expect(output).toContain("No changes detected");
  });

  test("includes tool count summary", () => {
    const diff = computeSkillDiff(
      "my-service",
      [{ name: "a", description: "A" }],
      [{ name: "a", description: "A" }, { name: "b", description: "B" }],
    );
    const output = formatDiffPreview(diff);
    expect(output).toContain("Existing: 1 tools");
    expect(output).toContain("New: 2 tools");
    expect(output).toContain("my-service");
  });
});
