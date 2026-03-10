/**
 * Integration tests for the full daemon lifecycle.
 * Exercises real daemon processes with the mock MCP server.
 */
import { describe, test, expect, afterEach } from "bun:test";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolve } from "path";

const PROJECT_ROOT = resolve(import.meta.dir, "../..");
const MOCK_CONFIG = resolve(PROJECT_ROOT, "tests/fixtures/mock-tool-config.json");

interface CliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/** Temp directory for each test's PID/socket files */
let tempDir: string;
/** Track PIDs to kill in afterEach */
let trackedPids: number[] = [];

/**
 * Run the CLI binary with isolated daemon paths and mock config.
 */
function runCli(
  args: string[],
  extraEnv?: Record<string, string>,
): CliResult {
  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    MCP2CLI_CONFIG: MOCK_CONFIG,
    MCP2CLI_PID_FILE: join(tempDir, "daemon.pid"),
    MCP2CLI_SOCKET_PATH: join(tempDir, "daemon.sock"),
    MCP2CLI_IDLE_TIMEOUT: "2",
    MCP2CLI_TOKENS_FILE: join(tempDir, "nonexistent-tokens.json"),
    MCP2CLI_AUTH_TOKEN: "",
    ...extraEnv,
  };

  const proc = Bun.spawnSync(
    ["bun", "run", "src/cli/index.ts", ...args],
    {
      cwd: PROJECT_ROOT,
      env,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 15_000,
    },
  );

  return {
    stdout: proc.stdout.toString().trim(),
    stderr: proc.stderr.toString().trim(),
    exitCode: proc.exitCode,
  };
}

/**
 * Read PID from the temp PID file. Returns null if file doesn't exist.
 */
async function readPid(): Promise<number | null> {
  try {
    const content = await readFile(join(tempDir, "daemon.pid"), "utf-8");
    const pid = parseInt(content.trim(), 10);
    return Number.isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}

/**
 * Check if a process is alive.
 */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// Setup/teardown for each test
async function setupTemp(): Promise<void> {
  tempDir = await mkdtemp(join(tmpdir(), "mcp2cli-test-"));
  trackedPids = [];
}

afterEach(async () => {
  // Kill any daemon processes still running
  for (const pid of trackedPids) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Already dead
    }
  }

  // Also try reading PID file and killing that
  const pid = await readPid();
  if (pid) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Already dead
    }
  }

  // Clean up temp directory
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
  }
});

describe("daemon lifecycle", () => {
  test("daemon auto-starts on first tool call", async () => {
    await setupTemp();

    const result = runCli(["n8n", "json_tool", "--params", "{}"]);
    expect(result.exitCode).toBe(0);

    // Verify success response
    const output = JSON.parse(result.stdout);
    expect(output.success).toBe(true);
    expect(output.result).toBeDefined();

    // PID file should exist after daemon started
    const pid = await readPid();
    expect(pid).not.toBeNull();
    if (pid) trackedPids.push(pid);
  }, 15_000);

  test("second call reuses running daemon", async () => {
    await setupTemp();

    // First call -- starts daemon
    const result1 = runCli(["n8n", "json_tool", "--params", "{}"]);
    expect(result1.exitCode).toBe(0);

    const pid1 = await readPid();
    expect(pid1).not.toBeNull();
    if (pid1) trackedPids.push(pid1);

    // Second call -- reuses daemon
    const result2 = runCli(["n8n", "json_tool", "--params", "{}"]);
    expect(result2.exitCode).toBe(0);

    const pid2 = await readPid();
    expect(pid2).not.toBeNull();

    // Same daemon PID
    expect(pid2).toBe(pid1);
  }, 15_000);

  test("daemon responds to status command", async () => {
    await setupTemp();

    // Start daemon via tool call
    const callResult = runCli(["n8n", "json_tool", "--params", "{}"]);
    expect(callResult.exitCode).toBe(0);

    const pid = await readPid();
    if (pid) trackedPids.push(pid);

    // Check status
    const statusResult = runCli(["daemon", "status"]);
    expect(statusResult.exitCode).toBe(0);

    const status = JSON.parse(statusResult.stdout);
    expect(status.status).toBe("ok");
    expect(status.uptime).toBeDefined();
  }, 15_000);

  test("daemon stops on stop command", async () => {
    await setupTemp();

    // Start daemon via tool call
    const callResult = runCli(["n8n", "json_tool", "--params", "{}"]);
    expect(callResult.exitCode).toBe(0);

    const pid = await readPid();
    expect(pid).not.toBeNull();
    if (pid) trackedPids.push(pid);

    // Stop daemon
    const stopResult = runCli(["daemon", "stop"]);
    expect(stopResult.exitCode).toBe(0);

    // Give it a moment to shut down
    await Bun.sleep(500);

    // Verify process is gone
    if (pid) {
      expect(isProcessAlive(pid)).toBe(false);
    }
  }, 15_000);

  test("daemon auto-exits after idle timeout", async () => {
    await setupTemp();

    // Start daemon with 2s idle timeout
    const result = runCli(["n8n", "json_tool", "--params", "{}"]);
    expect(result.exitCode).toBe(0);

    const pid = await readPid();
    expect(pid).not.toBeNull();
    if (pid) trackedPids.push(pid);

    // Wait for idle timeout (2s) + buffer
    await Bun.sleep(3500);

    // Daemon should have exited
    if (pid) {
      expect(isProcessAlive(pid)).toBe(false);
    }
  }, 15_000);

  test("stale PID file is detected and cleaned", async () => {
    await setupTemp();

    // Write a fake PID (non-existent process)
    await writeFile(join(tempDir, "daemon.pid"), "99999\n");

    // Tool call should clean stale, start fresh, succeed
    const result = runCli(["n8n", "json_tool", "--params", "{}"]);
    expect(result.exitCode).toBe(0);

    const output = JSON.parse(result.stdout);
    expect(output.success).toBe(true);

    // New daemon should be running with a different PID
    const pid = await readPid();
    expect(pid).not.toBeNull();
    expect(pid).not.toBe(99999);
    if (pid) trackedPids.push(pid);
  }, 15_000);

  test("MCP2CLI_NO_DAEMON=1 bypasses daemon", async () => {
    await setupTemp();

    const result = runCli(
      ["n8n", "json_tool", "--params", "{}"],
      { MCP2CLI_NO_DAEMON: "1" },
    );
    expect(result.exitCode).toBe(0);

    const output = JSON.parse(result.stdout);
    expect(output.success).toBe(true);

    // No PID file should be created
    const pid = await readPid();
    expect(pid).toBeNull();
  }, 15_000);

  test("tool call through daemon returns structured JSON", async () => {
    await setupTemp();

    const result = runCli(["n8n", "json_tool", "--params", "{}"]);
    expect(result.exitCode).toBe(0);

    const output = JSON.parse(result.stdout);
    // Must match the { success: true, result: ... } envelope
    expect(output).toHaveProperty("success", true);
    expect(output).toHaveProperty("result");
    // The result should contain the mock tool's data
    expect(output.result).toBeDefined();

    const pid = await readPid();
    if (pid) trackedPids.push(pid);
  }, 15_000);

  test("tool error through daemon returns structured error", async () => {
    await setupTemp();

    const result = runCli(["n8n", "error_tool", "--params", "{}"]);
    // error_tool returns isError=true which becomes TOOL_ERROR
    expect(result.exitCode).toBe(4);

    const output = JSON.parse(result.stdout);
    expect(output.error).toBe(true);
    expect(output.code).toBe("TOOL_ERROR");

    const pid = await readPid();
    if (pid) trackedPids.push(pid);
  }, 15_000);

  test("daemon stop when not running reports not_running", async () => {
    await setupTemp();

    // No daemon started -- just run stop
    const result = runCli(["daemon", "stop"]);
    expect(result.exitCode).toBe(0);

    const output = JSON.parse(result.stdout);
    expect(output.status).toBe("not_running");
  }, 15_000);
});
