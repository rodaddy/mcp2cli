import { describe, test, expect } from "bun:test";
import { resolve } from "path";
import { runCli } from "../test-helpers/run-cli.ts";

const MOCK_CONFIG = resolve(import.meta.dir, "../fixtures/mock-tool-config.json");

/**
 * Integration tests for schema introspection CLI commands:
 * - mcp2cli <service> --help (service tool listing)
 * - mcp2cli schema <service>.<tool> (tool schema details)
 */
describe("service help - mcp2cli <service> --help", () => {
  test("lists available tools with names and descriptions", () => {
    const result = runCli(["n8n", "--help"], { MCP2CLI_CONFIG: MOCK_CONFIG });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("json_tool");
    expect(result.stdout).toContain("create_item");
    expect(result.stdout).toContain("error_tool");
  }, 15_000);

  test("human mode output contains TOOLS and USAGE sections", () => {
    const result = runCli(["n8n", "--help"], { MCP2CLI_CONFIG: MOCK_CONFIG });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("TOOLS:");
    expect(result.stdout).toContain("USAGE:");
    expect(result.stdout).toContain("EXAMPLES:");
  }, 15_000);

  test("AI mode returns valid JSON with tools array", () => {
    const result = runCli(["n8n", "--help", "--help-format=ai"], {
      MCP2CLI_CONFIG: MOCK_CONFIG,
    });
    expect(result.exitCode).toBe(0);
    const output = JSON.parse(result.stdout);
    expect(output.service).toBe("n8n");
    expect(Array.isArray(output.tools)).toBe(true);
    expect(output.tools.length).toBe(3);
    expect(output.tools.some((t: { name: string }) => t.name === "json_tool")).toBe(true);
  }, 15_000);
});

describe("schema command - mcp2cli schema <service>.<tool>", () => {
  test("returns full schema JSON for a known tool", () => {
    const result = runCli(["schema", "n8n.json_tool"], {
      MCP2CLI_CONFIG: MOCK_CONFIG,
    });
    expect(result.exitCode).toBe(0);
    const output = JSON.parse(result.stdout);
    expect(output.tool).toBe("json_tool");
    expect(output.inputSchema).toBeDefined();
    expect(output.inputSchema.properties.filter).toBeDefined();
    expect(output.usage).toBeDefined();
  }, 15_000);

  test("create_item schema includes required field", () => {
    const result = runCli(["schema", "n8n.create_item"], {
      MCP2CLI_CONFIG: MOCK_CONFIG,
    });
    expect(result.exitCode).toBe(0);
    const output = JSON.parse(result.stdout);
    expect(output.inputSchema.required).toContain("name");
  }, 15_000);

  test("unknown tool returns UNKNOWN_COMMAND error", () => {
    const result = runCli(["schema", "n8n.nonexistent_tool"], {
      MCP2CLI_CONFIG: MOCK_CONFIG,
    });
    expect(result.exitCode).not.toBe(0);
    const output = JSON.parse(result.stdout);
    expect(output.error).toBe(true);
    expect(output.code).toBe("UNKNOWN_COMMAND");
    expect(output.message).toContain("nonexistent_tool");
  }, 15_000);

  test("missing dot notation returns error with usage hint", () => {
    const result = runCli(["schema", "n8n"], {
      MCP2CLI_CONFIG: MOCK_CONFIG,
    });
    expect(result.exitCode).not.toBe(0);
    const output = JSON.parse(result.stdout);
    expect(output.error).toBe(true);
    expect(output.message).toContain("dot notation");
  }, 15_000);
});

describe("missing tool name suggestion", () => {
  test("mcp2cli <service> with no tool suggests --help", () => {
    const result = runCli(["n8n"], { MCP2CLI_CONFIG: MOCK_CONFIG });
    expect(result.exitCode).not.toBe(0);
    const output = JSON.parse(result.stdout);
    expect(output.error).toBe(true);
    expect(output.message).toContain("--help");
  }, 15_000);
});
