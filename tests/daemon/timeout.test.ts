/**
 * MEM-02: Tool call timeout tests.
 * Tests that tool calls exceeding MCP2CLI_TOOL_TIMEOUT return structured TOOL_TIMEOUT errors.
 *
 * Integration test: exercises the full CLI -> daemon -> slow-mcp-server path.
 */
import { describe, test, expect, afterEach, beforeEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolve } from "path";

const PROJECT_ROOT = resolve(import.meta.dir, "../..");

interface CliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

let tempDir: string;

function runCli(
  args: string[],
  extraEnv?: Record<string, string>,
  timeoutMs = 30_000,
): CliResult {
  const configPath = join(tempDir, "config.json");

  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    MCP2CLI_CONFIG: configPath,
    MCP2CLI_PID_FILE: join(tempDir, "daemon.pid"),
    MCP2CLI_SOCKET_PATH: join(tempDir, "daemon.sock"),
    MCP2CLI_IDLE_TIMEOUT: "10",
    ...extraEnv,
  };

  const proc = Bun.spawnSync(
    ["bun", "run", "src/cli/index.ts", ...args],
    {
      cwd: PROJECT_ROOT,
      env,
      stdout: "pipe",
      stderr: "pipe",
      timeout: timeoutMs,
    },
  );

  return {
    stdout: proc.stdout.toString().trim(),
    stderr: proc.stderr.toString().trim(),
    exitCode: proc.exitCode,
  };
}

function shutdownDaemon() {
  try {
    runCli(["shutdown"], undefined, 5000);
  } catch {
    // May not be running
  }
}

describe("MEM-02: Tool call timeout", () => {
  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "mcp2cli-timeout-"));
    const slowServer = resolve(PROJECT_ROOT, "tests/fixtures/slow-mcp-server.ts");

    const config = {
      services: {
        slow: {
          backend: "stdio",
          command: "bun",
          args: [slowServer],
        },
      },
    };
    await Bun.write(join(tempDir, "config.json"), JSON.stringify(config));
  });

  afterEach(async () => {
    shutdownDaemon();
    await new Promise((r) => setTimeout(r, 500));
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  test("tool call within timeout succeeds normally", async () => {
    // Use --params JSON format (the CLI's supported param syntax)
    const result = runCli(
      ["slow", "slow_tool", "--params", '{"delay_ms":100}'],
      { MCP2CLI_TOOL_TIMEOUT: "30000" },
    );

    const parsed = JSON.parse(result.stdout);
    expect(parsed.success).toBe(true);
    expect(parsed.result.delayed).toBe(100);
  }, 30_000);

  test("tool call exceeding timeout returns TOOL_TIMEOUT error", async () => {
    // Use very short timeout (500ms) with long delay (60s)
    const result = runCli(
      ["slow", "slow_tool", "--params", '{"delay_ms":60000}'],
      { MCP2CLI_TOOL_TIMEOUT: "500" },
    );

    // Should fail with TOOL_TIMEOUT
    expect(result.exitCode).not.toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.error).toBe(true);
    expect(parsed.code).toBe("TOOL_TIMEOUT");
    expect(parsed.message).toContain("timed out");
    expect(parsed.message).toContain("500ms");
  }, 30_000);
});
