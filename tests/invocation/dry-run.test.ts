import { describe, test, expect } from "bun:test";
import { formatDryRunPreview } from "../../src/invocation/dry-run.ts";

describe("formatDryRunPreview", () => {
  test("returns preview object with dryRun: true", () => {
    const preview = formatDryRunPreview({
      service: "n8n",
      tool: "create_item",
      params: { name: "test" },
      toolDescription: "Create a new item",
      inputSchema: { type: "object", properties: { name: { type: "string" } } },
      fields: [],
    });

    expect(preview.dryRun).toBe(true);
    expect(preview.service).toBe("n8n");
    expect(preview.tool).toBe("create_item");
    expect(preview.params).toEqual({ name: "test" });
    expect(preview.toolDescription).toBe("Create a new item");
    expect(preview.inputSchema).toEqual({
      type: "object",
      properties: { name: { type: "string" } },
    });
  });

  test("excludes fields property when fields array is empty", () => {
    const preview = formatDryRunPreview({
      service: "n8n",
      tool: "list",
      params: {},
      toolDescription: "List items",
      inputSchema: { type: "object" },
      fields: [],
    });

    expect(preview.fields).toBeUndefined();
  });

  test("includes fields property when fields array has items", () => {
    const preview = formatDryRunPreview({
      service: "n8n",
      tool: "list",
      params: {},
      toolDescription: "List items",
      inputSchema: { type: "object" },
      fields: ["id", "name", "settings.timezone"],
    });

    expect(preview.fields).toEqual(["id", "name", "settings.timezone"]);
  });
});
