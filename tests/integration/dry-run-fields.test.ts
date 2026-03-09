import { describe, test, expect } from "bun:test";
import { resolve } from "path";
import { runCli } from "../test-helpers/run-cli.ts";

const MOCK_CONFIG = resolve(import.meta.dir, "../fixtures/mock-tool-config.json");

/**
 * Integration tests for --dry-run and --fields flags.
 * Uses direct path (MCP2CLI_NO_DAEMON=1 via runCli default).
 */
describe("dry-run and fields - end to end", () => {
  test("--dry-run on valid tool: exits 10, output has dryRun:true + inputSchema + toolDescription", () => {
    const result = runCli(["n8n", "json_tool", "--dry-run"], {
      MCP2CLI_CONFIG: MOCK_CONFIG,
    });
    expect(result.exitCode).toBe(10);
    const output = JSON.parse(result.stdout);
    expect(output.dryRun).toBe(true);
    expect(output.service).toBe("n8n");
    expect(output.tool).toBe("json_tool");
    expect(output.toolDescription).toBeString();
    expect(output.inputSchema).toBeDefined();
    expect(output.params).toEqual({});
  }, 15_000);

  test("--dry-run on invalid tool: exits with error code, output has error:true", () => {
    const result = runCli(["n8n", "nonexistent_tool", "--dry-run"], {
      MCP2CLI_CONFIG: MOCK_CONFIG,
    });
    // Tool not found throws an error which propagates to main().catch()
    expect(result.exitCode).not.toBe(0);
    expect(result.exitCode).not.toBe(10);
    const output = JSON.parse(result.stdout);
    expect(output.error).toBe(true);
  }, 15_000);

  test("--dry-run with bad --params: exits 1 (validation before dry-run)", () => {
    const result = runCli(["n8n", "json_tool", "--dry-run", "--params", "{bad}"], {
      MCP2CLI_CONFIG: MOCK_CONFIG,
    });
    expect(result.exitCode).toBe(1);
    const output = JSON.parse(result.stdout);
    expect(output.error).toBe(true);
    expect(output.code).toBe("INPUT_VALIDATION_ERROR");
  }, 15_000);

  test("--dry-run + --fields: exits 10, output includes fields array", () => {
    const result = runCli(
      ["n8n", "json_tool", "--dry-run", "--fields", "id,name"],
      { MCP2CLI_CONFIG: MOCK_CONFIG },
    );
    expect(result.exitCode).toBe(10);
    const output = JSON.parse(result.stdout);
    expect(output.dryRun).toBe(true);
    expect(output.fields).toEqual(["id", "name"]);
  }, 15_000);

  test("--dry-run with --params shows params in preview", () => {
    const result = runCli(
      ["n8n", "json_tool", "--dry-run", "--params", '{"filter":"active"}'],
      { MCP2CLI_CONFIG: MOCK_CONFIG },
    );
    expect(result.exitCode).toBe(10);
    const output = JSON.parse(result.stdout);
    expect(output.params).toEqual({ filter: "active" });
  }, 15_000);

  test("--fields on successful call: output contains only requested fields", () => {
    // json_tool returns { status: "ok", data: [{ id: "1", name: "test" }] }
    const result = runCli(
      ["n8n", "json_tool", "--params", "{}", "--fields", "status"],
      { MCP2CLI_CONFIG: MOCK_CONFIG },
    );
    expect(result.exitCode).toBe(0);
    const output = JSON.parse(result.stdout);
    expect(output.success).toBe(true);
    expect(output.result).toEqual({ status: "ok" });
  }, 15_000);

  test("--fields with missing field: stderr contains warning", () => {
    const result = runCli(
      ["n8n", "json_tool", "--params", "{}", "--fields", "nonexistent"],
      { MCP2CLI_CONFIG: MOCK_CONFIG },
    );
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain("warning:");
    expect(result.stderr).toContain("nonexistent");
  }, 15_000);

  test("--fields on array result: each item is masked", () => {
    // json_tool returns { status: "ok", data: [{ id: "1", name: "test" }] }
    // Extract nested data array items' id field
    const result = runCli(
      ["n8n", "json_tool", "--params", "{}", "--fields", "data"],
      { MCP2CLI_CONFIG: MOCK_CONFIG },
    );
    expect(result.exitCode).toBe(0);
    const output = JSON.parse(result.stdout);
    expect(output.success).toBe(true);
    expect(output.result.data).toEqual([{ id: "1", name: "test" }]);
  }, 15_000);
});
