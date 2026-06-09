import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { writeAuditEntry, auditToolCall } from "../../src/logger/audit.ts";
import type { AuditEntry } from "../../src/logger/audit.ts";

let testDir: string;
let origLogDir: string | undefined;

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), "mcp2cli-audit-test-"));
  origLogDir = process.env.MCP2CLI_LOG_DIR;
  process.env.MCP2CLI_LOG_DIR = testDir;
});

afterEach(async () => {
  if (origLogDir !== undefined) {
    process.env.MCP2CLI_LOG_DIR = origLogDir;
  } else {
    delete process.env.MCP2CLI_LOG_DIR;
  }
  await rm(testDir, { recursive: true, force: true });
});

async function readAuditFile(): Promise<AuditEntry[]> {
  const filePath = join(testDir, "audit.ndjson");
  const file = Bun.file(filePath);
  if (!(await file.exists())) return [];
  const text = await file.text();
  return text.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as AuditEntry);
}

async function waitForWrite(): Promise<void> {
  await new Promise((r) => setTimeout(r, 50));
}

describe("writeAuditEntry", () => {
  test("writes NDJSON entry to audit file", async () => {
    writeAuditEntry({
      timestamp: "2026-06-08T12:00:00Z",
      path: "cli",
      service: "n8n",
      tool: "list_workflows",
      durationMs: 150,
      success: true,
    });
    await waitForWrite();

    const entries = await readAuditFile();
    expect(entries).toHaveLength(1);
    expect(entries[0]!.service).toBe("n8n");
    expect(entries[0]!.tool).toBe("list_workflows");
    expect(entries[0]!.success).toBe(true);
  });

  test("appends multiple entries", async () => {
    writeAuditEntry({
      timestamp: "2026-06-08T12:00:00Z",
      path: "daemon",
      service: "svc-a",
      tool: "tool1",
      durationMs: 10,
      success: true,
    });
    writeAuditEntry({
      timestamp: "2026-06-08T12:00:01Z",
      path: "cli",
      service: "svc-b",
      tool: "tool2",
      durationMs: 20,
      success: false,
      error: "timeout",
    });
    await waitForWrite();

    const entries = await readAuditFile();
    expect(entries).toHaveLength(2);
    expect(entries[1]!.error).toBe("timeout");
  });

  test("sanitizes sensitive param keys", async () => {
    writeAuditEntry({
      timestamp: "2026-06-08T12:00:00Z",
      path: "cli",
      service: "vw",
      tool: "get_secret",
      params: { name: "test", api_key: "sk-12345", query: "safe" },
      durationMs: 50,
      success: true,
    });
    await waitForWrite();

    const entries = await readAuditFile();
    expect(entries[0]!.params!.api_key).toBe("[REDACTED]");
    expect(entries[0]!.params!.name).toBe("test");
    expect(entries[0]!.params!.query).toBe("safe");
  });

  test("truncates long response summaries", async () => {
    const longResponse = "x".repeat(5000);
    writeAuditEntry({
      timestamp: "2026-06-08T12:00:00Z",
      path: "daemon",
      service: "svc",
      tool: "big_tool",
      responseSummary: longResponse,
      durationMs: 100,
      success: true,
    });
    await waitForWrite();

    const entries = await readAuditFile();
    expect(entries[0]!.responseSummary!.length).toBeLessThanOrEqual(2001);
  });
});

describe("auditToolCall", () => {
  test("creates audit entry with summarized response", async () => {
    auditToolCall({
      path: "daemon",
      service: "open-brain",
      tool: "search_all",
      params: { query: "test" },
      result: { results: [{ id: 1, text: "found" }] },
      durationMs: 234,
      success: true,
    });
    await waitForWrite();

    const entries = await readAuditFile();
    expect(entries).toHaveLength(1);
    expect(entries[0]!.service).toBe("open-brain");
    expect(entries[0]!.responseSummary).toContain("found");
  });

  test("records error details on failure", async () => {
    auditToolCall({
      path: "cli",
      service: "n8n",
      tool: "create_workflow",
      params: { name: "test" },
      durationMs: 5000,
      success: false,
      error: "Connection refused",
    });
    await waitForWrite();

    const entries = await readAuditFile();
    expect(entries[0]!.success).toBe(false);
    expect(entries[0]!.error).toBe("Connection refused");
  });
});
