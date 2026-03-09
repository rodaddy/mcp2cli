import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { autoRegenerateSkills } from "../../src/generation/auto-regen.ts";
import type { AccessPolicy } from "../../src/access/types.ts";

describe("autoRegenerateSkills", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "mcp2cli-regen-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  test("regenerates skill files with tool list", async () => {
    const tools = [
      { name: "list_items", description: "List all items" },
      { name: "create_item", description: "Create an item" },
      { name: "delete_item", description: "Delete an item" },
    ];

    const result = await autoRegenerateSkills("test-service", tools, {}, tmpDir);

    expect(result.regenerated).toBe(true);
    expect(result.toolCount).toBe(3);
    expect(result.filesWritten.length).toBeGreaterThan(0);
    expect(result.error).toBeUndefined();

    // Verify SKILL.md was written
    const skillFile = Bun.file(join(tmpDir, "SKILL.md"));
    expect(await skillFile.exists()).toBe(true);
    const content = await skillFile.text();
    expect(content).toContain("list_items");
    expect(content).toContain("create_item");
    expect(content).toContain("delete_item");
  });

  test("filters tools by access policy (blockTools)", async () => {
    const tools = [
      { name: "list_items", description: "List items" },
      { name: "admin_reset", description: "Reset admin" },
      { name: "admin_delete", description: "Delete admin" },
    ];

    const policy: AccessPolicy = {
      blockTools: ["admin_*"],
    };

    const result = await autoRegenerateSkills("test-service", tools, policy, tmpDir);

    expect(result.regenerated).toBe(true);
    expect(result.toolCount).toBe(1);

    const content = await Bun.file(join(tmpDir, "SKILL.md")).text();
    expect(content).toContain("list_items");
    expect(content).not.toContain("admin_reset");
    expect(content).not.toContain("admin_delete");
  });

  test("filters tools by access policy (allowTools)", async () => {
    const tools = [
      { name: "list_items", description: "List items" },
      { name: "get_item", description: "Get item" },
      { name: "delete_item", description: "Delete item" },
    ];

    const policy: AccessPolicy = {
      allowTools: ["list_*", "get_*"],
    };

    const result = await autoRegenerateSkills("test-service", tools, policy, tmpDir);

    expect(result.regenerated).toBe(true);
    expect(result.toolCount).toBe(2);

    const content = await Bun.file(join(tmpDir, "SKILL.md")).text();
    expect(content).toContain("list_items");
    expect(content).toContain("get_item");
    expect(content).not.toContain("delete_item");
  });

  test("skips regeneration when all tools are blocked", async () => {
    const tools = [
      { name: "admin_reset", description: "Reset admin" },
    ];

    const policy: AccessPolicy = {
      blockTools: ["admin_*"],
    };

    const result = await autoRegenerateSkills("test-service", tools, policy, tmpDir);

    expect(result.regenerated).toBe(false);
    expect(result.toolCount).toBe(0);
    expect(result.filesWritten).toHaveLength(0);
  });

  test("preserves manual sections from existing skill file", async () => {
    // Create an existing SKILL.md with manual content
    const existingContent = [
      "---",
      "name: test-service",
      "description: MCP tools for test-service",
      "triggers:",
      "  - test-service",
      "---",
      "",
      "# test-service",
      "",
      "<!-- AUTO-GENERATED:START -->",
      "",
      "## Quick Reference",
      "",
      "| Tool | Description |",
      "|------|-------------|",
      "| old_tool | Old tool desc |",
      "",
      "<!-- AUTO-GENERATED:END -->",
      "",
      "## Notes",
      "",
      "<!-- MANUAL:START -->",
      "IMPORTANT: Always use list_items before create_item.",
      "This is critical user documentation.",
      "<!-- MANUAL:END -->",
      "",
    ].join("\n");

    await Bun.write(join(tmpDir, "SKILL.md"), existingContent);

    const tools = [
      { name: "list_items", description: "List items" },
      { name: "create_item", description: "Create item" },
    ];

    const result = await autoRegenerateSkills("test-service", tools, {}, tmpDir);

    expect(result.regenerated).toBe(true);
    expect(result.manualSectionsPreserved).toBe(1);

    const content = await Bun.file(join(tmpDir, "SKILL.md")).text();
    // New tools present
    expect(content).toContain("list_items");
    expect(content).toContain("create_item");
    // Old tool removed
    expect(content).not.toContain("old_tool");
    // Manual content preserved
    expect(content).toContain("IMPORTANT: Always use list_items before create_item.");
    expect(content).toContain("This is critical user documentation.");
  });

  test("handles empty tool list", async () => {
    const result = await autoRegenerateSkills("test-service", [], {}, tmpDir);

    expect(result.regenerated).toBe(false);
    expect(result.toolCount).toBe(0);
    expect(result.filesWritten).toHaveLength(0);
  });
});
