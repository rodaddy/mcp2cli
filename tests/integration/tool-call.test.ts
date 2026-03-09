import { describe, test, expect } from "bun:test";
import { resolve } from "path";
import { runCli } from "../test-helpers/run-cli.ts";

const MOCK_CONFIG = resolve(import.meta.dir, "../fixtures/mock-tool-config.json");

/**
 * Integration tests for the full tool call pipeline:
 * CLI dispatch -> parse -> validate -> config -> connect -> call -> format -> output
 */
describe("tool call - end to end", () => {
  test("successful tool call returns structured JSON result", () => {
    const result = runCli(["n8n", "json_tool", "--params", "{}"], {
      MCP2CLI_CONFIG: MOCK_CONFIG,
    });
    expect(result.exitCode).toBe(0);
    const output = JSON.parse(result.stdout);
    expect(output.success).toBe(true);
    expect(output.result).toEqual({ status: "ok", data: [{ id: "1", name: "test" }] });
  }, 15_000);

  test("tool call without --params defaults to empty object", () => {
    const result = runCli(["n8n", "some_tool"], {
      MCP2CLI_CONFIG: MOCK_CONFIG,
    });
    expect(result.exitCode).toBe(0);
    const output = JSON.parse(result.stdout);
    expect(output.success).toBe(true);
  }, 15_000);

  test("unknown service returns UNKNOWN_COMMAND error", () => {
    const result = runCli(["fakesvc", "tool"], {
      MCP2CLI_CONFIG: MOCK_CONFIG,
    });
    expect(result.exitCode).toBe(1);
    const output = JSON.parse(result.stdout);
    expect(output.error).toBe(true);
    expect(output.code).toBe("UNKNOWN_COMMAND");
  }, 15_000);

  test("missing tool name returns UNKNOWN_COMMAND error", () => {
    const result = runCli(["n8n"], {
      MCP2CLI_CONFIG: MOCK_CONFIG,
    });
    expect(result.exitCode).toBe(1);
    const output = JSON.parse(result.stdout);
    expect(output.error).toBe(true);
    expect(output.code).toBe("UNKNOWN_COMMAND");
  }, 15_000);

  test("invalid JSON in --params returns INPUT_VALIDATION_ERROR", () => {
    const result = runCli(["n8n", "tool", "--params", "{bad}"], {
      MCP2CLI_CONFIG: MOCK_CONFIG,
    });
    expect(result.exitCode).toBe(1);
    const output = JSON.parse(result.stdout);
    expect(output.error).toBe(true);
    expect(output.code).toBe("INPUT_VALIDATION_ERROR");
  }, 15_000);

  test("path traversal in service name returns INPUT_VALIDATION_ERROR", () => {
    const result = runCli(["../etc/passwd", "tool"], {
      MCP2CLI_CONFIG: MOCK_CONFIG,
    });
    expect(result.exitCode).toBe(1);
    const output = JSON.parse(result.stdout);
    expect(output.error).toBe(true);
    expect(output.code).toBe("INPUT_VALIDATION_ERROR");
  }, 15_000);

  test("error_tool returns TOOL_ERROR with exit code 4", () => {
    const result = runCli(["n8n", "error_tool", "--params", "{}"], {
      MCP2CLI_CONFIG: MOCK_CONFIG,
    });
    expect(result.exitCode).toBe(4);
    const output = JSON.parse(result.stdout);
    expect(output.error).toBe(true);
    expect(output.code).toBe("TOOL_ERROR");
  }, 15_000);

  test("nonexistent binary returns CONNECTION_ERROR with exit code 5", () => {
    // Create an inline config pointing to a command that doesn't exist
    const tmpConfig = resolve(import.meta.dir, "../fixtures/broken-server-config.json");
    const fs = require("fs");
    fs.writeFileSync(tmpConfig, JSON.stringify({
      services: {
        broken: {
          backend: "stdio",
          command: "/usr/bin/nonexistent-mcp-binary-xyz",
          args: [],
          description: "Broken server for testing",
        },
      },
    }));

    try {
      const result = runCli(["broken", "tool", "--params", "{}"], {
        MCP2CLI_CONFIG: tmpConfig,
      });
      expect(result.exitCode).toBe(5);
      const output = JSON.parse(result.stdout);
      expect(output.error).toBe(true);
      expect(output.code).toBe("CONNECTION_ERROR");
    } finally {
      fs.unlinkSync(tmpConfig);
    }
  }, 15_000);
});
