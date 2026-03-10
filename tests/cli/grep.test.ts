import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { writeCache } from "../../src/cache/index.ts";
import type { CachedToolSchema } from "../../src/cache/index.ts";

// -- Test setup --

let testDir: string;
let origCacheDir: string | undefined;

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), "mcp2cli-grep-test-"));
  origCacheDir = process.env.MCP2CLI_CACHE_DIR;
  process.env.MCP2CLI_CACHE_DIR = testDir;
});

afterEach(async () => {
  if (origCacheDir !== undefined) {
    process.env.MCP2CLI_CACHE_DIR = origCacheDir;
  } else {
    delete process.env.MCP2CLI_CACHE_DIR;
  }
  await rm(testDir, { recursive: true, force: true });
});

function makeTool(name: string, description: string): CachedToolSchema {
  return {
    name,
    description,
    inputSchema: { type: "object", properties: {} },
    hash: "test-hash",
  };
}

/**
 * Helper to capture stdout from handleGrep.
 * Replaces console.log temporarily.
 */
async function captureGrep(args: string[]): Promise<string> {
  const { handleGrep } = await import("../../src/cli/commands/grep.ts");
  const lines: string[] = [];
  const origLog = console.log;
  console.log = (...logArgs: unknown[]) => {
    lines.push(logArgs.map(String).join(" "));
  };
  try {
    await handleGrep(args);
  } finally {
    console.log = origLog;
  }
  return lines.join("\n");
}

// -- Tests --

describe("grep command", () => {
  test("finds tools by name substring", async () => {
    await writeCache("n8n", [
      makeTool("list_workflows", "List all workflows"),
      makeTool("get_workflow", "Get a single workflow"),
      makeTool("delete_node", "Delete a node"),
    ]);

    const output = await captureGrep(["workflow"]);
    expect(output).toContain("n8n.list_workflows");
    expect(output).toContain("n8n.get_workflow");
    expect(output).not.toContain("delete_node");
  });

  test("finds tools by description substring", async () => {
    await writeCache("svc", [
      makeTool("tool_a", "Manages database connections"),
      makeTool("tool_b", "Sends email notifications"),
    ]);

    const output = await captureGrep(["database"]);
    expect(output).toContain("svc.tool_a");
    expect(output).not.toContain("svc.tool_b");
  });

  test("search is case-insensitive", async () => {
    await writeCache("svc", [
      makeTool("CreateWorkflow", "Creates a new WORKFLOW"),
    ]);

    const output = await captureGrep(["workflow"]);
    expect(output).toContain("svc.CreateWorkflow");

    const output2 = await captureGrep(["WORKFLOW"]);
    expect(output2).toContain("svc.CreateWorkflow");
  });

  test("returns service-qualified names in output", async () => {
    await writeCache("alpha", [makeTool("my_tool", "Does things")]);

    const output = await captureGrep(["my_tool"]);
    expect(output).toContain("alpha.my_tool");
    expect(output).toContain("--");
    expect(output).toContain("Does things");
  });

  test("works across multiple services", async () => {
    await writeCache("svc-a", [
      makeTool("list_items", "List items from A"),
    ]);
    await writeCache("svc-b", [
      makeTool("list_records", "List records from B"),
    ]);

    const output = await captureGrep(["list"]);
    expect(output).toContain("svc-a.list_items");
    expect(output).toContain("svc-b.list_records");
  });

  test("returns empty message with no match", async () => {
    await writeCache("svc", [
      makeTool("tool_a", "Does A things"),
    ]);

    const output = await captureGrep(["nonexistent_xyz"]);
    expect(output).toContain("No tools matching");
  });

  test("handles no cached schemas gracefully", async () => {
    // Empty cache dir -- no schemas
    const output = await captureGrep(["anything"]);
    expect(output).toContain("No cached schemas found");
  });

  test("shows usage when no pattern provided", async () => {
    const output = await captureGrep([]);
    expect(output).toContain("Usage:");
    expect(output).toContain("grep");
  });

  test("matches in both name and description return only one line", async () => {
    await writeCache("svc", [
      makeTool("list_workflows", "List all workflows in the system"),
    ]);

    const output = await captureGrep(["workflow"]);
    const lines = output.split("\n").filter((l) => l.includes("svc.list_workflows"));
    expect(lines).toHaveLength(1);
  });
});
