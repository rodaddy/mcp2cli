/**
 * L11: Tests for `mcp2cli audit` CLI subcommands.
 * Uses the same console.log capture pattern as grep.test.ts.
 */
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { _resetAuditState } from "../../src/logger/audit.ts";

let testDir: string;
let origLogDir: string | undefined;

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), "mcp2cli-audit-cli-test-"));
  origLogDir = process.env.MCP2CLI_LOG_DIR;
  process.env.MCP2CLI_LOG_DIR = testDir;
  _resetAuditState();
});

afterEach(async () => {
  if (origLogDir !== undefined) {
    process.env.MCP2CLI_LOG_DIR = origLogDir;
  } else {
    delete process.env.MCP2CLI_LOG_DIR;
  }
  await rm(testDir, { recursive: true, force: true });
});

/** Helper: capture console.log output from handleAudit */
async function captureAudit(args: string[]): Promise<{ stdout: string; stderr: string }> {
  const { handleAudit } = await import("../../src/cli/commands/audit.ts");
  const stdoutLines: string[] = [];
  const stderrLines: string[] = [];
  const origLog = console.log;
  const origError = console.error;
  const origStderrWrite = process.stderr.write;

  console.log = (...logArgs: unknown[]) => {
    stdoutLines.push(logArgs.map(String).join(" "));
  };
  console.error = (...logArgs: unknown[]) => {
    stderrLines.push(logArgs.map(String).join(" "));
  };
  process.stderr.write = ((msg: string) => {
    stderrLines.push(msg);
    return true;
  }) as typeof process.stderr.write;

  try {
    await handleAudit(args);
  } finally {
    console.log = origLog;
    console.error = origError;
    process.stderr.write = origStderrWrite;
  }
  return { stdout: stdoutLines.join("\n"), stderr: stderrLines.join("\n") };
}

function makeEntry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    timestamp: "2026-06-08T12:00:00Z",
    path: "cli",
    service: "test-svc",
    tool: "test_tool",
    durationMs: 42,
    success: true,
    ...overrides,
  };
}

async function writeFixtureEntries(entries: Record<string, unknown>[]): Promise<void> {
  const filePath = join(testDir, "audit.ndjson");
  const ndjson = entries.map((e) => JSON.stringify(e)).join("\n") + "\n";
  await writeFile(filePath, ndjson);
}

describe("audit CLI", () => {
  test("no subcommand shows usage", async () => {
    const { stdout } = await captureAudit([]);
    expect(stdout).toContain("Usage: mcp2cli audit");
    expect(stdout).toContain("tail");
    expect(stdout).toContain("search");
    expect(stdout).toContain("stats");
    expect(stdout).toContain("clear");
  });

  test("unknown subcommand shows usage with validation exit", async () => {
    const origExitCode = process.exitCode;
    const { stdout } = await captureAudit(["bogus"]);
    expect(stdout).toContain("Usage:");
    // Restore in case test runner cares
    process.exitCode = origExitCode;
  });

  describe("tail", () => {
    test("shows entries in human-readable format", async () => {
      await writeFixtureEntries([
        makeEntry({ service: "n8n", tool: "list_workflows", durationMs: 150 }),
        makeEntry({ service: "ob", tool: "search_all", durationMs: 30, success: false, error: "timeout" }),
      ]);

      const { stdout } = await captureAudit(["tail"]);
      expect(stdout).toContain("n8n.list_workflows");
      expect(stdout).toContain("150ms");
      expect(stdout).toContain("ob.search_all");
      expect(stdout).toContain("ERR: timeout");
    });

    test("limits to last N entries", async () => {
      const entries = Array.from({ length: 10 }, (_, i) =>
        makeEntry({ tool: `tool_${i}` }),
      );
      await writeFixtureEntries(entries);

      const { stdout } = await captureAudit(["tail", "3"]);
      // Should show at most 3 entries
      const lines = stdout.split("\n").filter((l) => l.includes("test-svc.tool_"));
      expect(lines.length).toBeLessThanOrEqual(3);
    });

    test("--json returns JSON array", async () => {
      await writeFixtureEntries([makeEntry()]);

      const { stdout } = await captureAudit(["tail", "--json"]);
      const parsed = JSON.parse(stdout);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].service).toBe("test-svc");
    });

    test("empty log says no entries found", async () => {
      const { stdout } = await captureAudit(["tail"]);
      expect(stdout).toContain("No audit entries found");
    });
  });

  describe("search", () => {
    test("finds entries matching service name", async () => {
      await writeFixtureEntries([
        makeEntry({ service: "n8n", tool: "list_workflows" }),
        makeEntry({ service: "vw", tool: "get_secret" }),
      ]);

      const { stdout } = await captureAudit(["search", "n8n"]);
      expect(stdout).toContain("n8n.list_workflows");
      expect(stdout).not.toContain("vw.get_secret");
    });

    test("finds entries matching tool name", async () => {
      await writeFixtureEntries([
        makeEntry({ tool: "list_workflows" }),
        makeEntry({ tool: "delete_node" }),
      ]);

      const { stdout } = await captureAudit(["search", "workflow"]);
      expect(stdout).toContain("list_workflows");
      expect(stdout).not.toContain("delete_node");
    });

    test("--json returns structured result", async () => {
      await writeFixtureEntries([makeEntry({ service: "alpha" })]);

      const { stdout } = await captureAudit(["search", "alpha", "--json"]);
      const result = JSON.parse(stdout);
      expect(result.query).toBe("alpha");
      expect(result.total).toBe(1);
      expect(result.matches).toHaveLength(1);
    });

    test("no pattern shows usage error", async () => {
      const { stderr } = await captureAudit(["search"]);
      expect(stderr).toContain("Usage:");
    });

    test("no matches says so", async () => {
      await writeFixtureEntries([makeEntry()]);

      const { stdout } = await captureAudit(["search", "nonexistent_xyz"]);
      expect(stdout).toContain("No audit entries matching");
    });
  });

  describe("stats", () => {
    test("shows per-service statistics", async () => {
      await writeFixtureEntries([
        makeEntry({ service: "n8n", durationMs: 100 }),
        makeEntry({ service: "n8n", durationMs: 200 }),
        makeEntry({ service: "ob", durationMs: 50, success: false, error: "fail" }),
      ]);

      const { stdout } = await captureAudit(["stats"]);
      expect(stdout).toContain("3 entries");
      expect(stdout).toContain("1 errors");
      expect(stdout).toContain("n8n: 2 calls");
      expect(stdout).toContain("ob: 1 calls");
      expect(stdout).toContain("1 errors)");
    });

    test("empty log says no entries", async () => {
      const { stdout } = await captureAudit(["stats"]);
      expect(stdout).toContain("No audit entries found");
    });
  });

  describe("clear", () => {
    test("deletes the audit log", async () => {
      await writeFixtureEntries([makeEntry()]);
      const filePath = join(testDir, "audit.ndjson");
      expect(await Bun.file(filePath).exists()).toBe(true);

      const { stdout } = await captureAudit(["clear"]);
      expect(stdout).toContain("Audit log cleared");
      expect(await Bun.file(filePath).exists()).toBe(false);
    });

    test("handles missing log gracefully", async () => {
      const { stdout } = await captureAudit(["clear"]);
      expect(stdout).toContain("No audit log found");
    });
  });

  describe("path", () => {
    test("prints the audit log path", async () => {
      const { stdout } = await captureAudit(["path"]);
      expect(stdout).toContain("audit.ndjson");
    });
  });
});
