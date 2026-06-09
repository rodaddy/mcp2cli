import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { writeAuditEntry, auditToolCall, flushAuditQueue, _resetAuditState } from "../../src/logger/audit.ts";
import type { AuditEntry } from "../../src/logger/audit.ts";

let testDir: string;
let origLogDir: string | undefined;
let origMaxSize: string | undefined;

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), "mcp2cli-audit-test-"));
  origLogDir = process.env.MCP2CLI_LOG_DIR;
  origMaxSize = process.env.MCP2CLI_AUDIT_MAX_SIZE;
  process.env.MCP2CLI_LOG_DIR = testDir;
  _resetAuditState();
});

afterEach(async () => {
  if (origLogDir !== undefined) {
    process.env.MCP2CLI_LOG_DIR = origLogDir;
  } else {
    delete process.env.MCP2CLI_LOG_DIR;
  }
  if (origMaxSize !== undefined) {
    process.env.MCP2CLI_AUDIT_MAX_SIZE = origMaxSize;
  } else {
    delete process.env.MCP2CLI_AUDIT_MAX_SIZE;
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
    await flushAuditQueue();

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
    await flushAuditQueue();

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
    await flushAuditQueue();

    const entries = await readAuditFile();
    expect(entries[0]!.params!.api_key).toBe("[REDACTED]");
    expect(entries[0]!.params!.name).toBe("test");
    expect(entries[0]!.params!.query).toBe("safe");
  });

  test("truncates long response summaries", async () => {
    // L10: test via auditToolCall which calls summarizeResponse (the actual truncation path)
    const bigResult = { data: "x".repeat(5000) };
    auditToolCall({
      path: "daemon",
      service: "svc",
      tool: "big_tool",
      result: bigResult,
      durationMs: 100,
      success: true,
    });
    await flushAuditQueue();

    const entries = await readAuditFile();
    expect(entries).toHaveLength(1);
    // MAX_FIELD_LENGTH is 2000, so responseSummary must be truncated below the full JSON length
    const fullJson = JSON.stringify(bigResult);
    expect(fullJson.length).toBeGreaterThan(2000);
    expect(entries[0]!.responseSummary!.length).toBeLessThanOrEqual(2100); // 2000 + truncation marker
    expect(entries[0]!.responseSummary).toContain("...(truncated)");
  });

  test("recursively sanitizes nested objects with sensitive keys", async () => {
    writeAuditEntry({
      timestamp: "2026-06-08T12:00:00Z",
      path: "cli",
      service: "test",
      tool: "nested_tool",
      params: {
        config: {
          name: "visible",
          auth_token: "should-be-redacted",
          nested: {
            password: "also-redacted",
            safe: "kept",
          },
        },
        items: ["a", "b"],
      },
      durationMs: 10,
      success: true,
    });
    await flushAuditQueue();

    const entries = await readAuditFile();
    const params = entries[0]!.params!;
    const config = params.config as Record<string, unknown>;
    expect(config.name).toBe("visible");
    expect(config.auth_token).toBe("[REDACTED]");
    const nested = config.nested as Record<string, unknown>;
    expect(nested.password).toBe("[REDACTED]");
    expect(nested.safe).toBe("kept");
    expect(params.items).toEqual(["a", "b"]);
  });

  test("sanitizes response summary containing sensitive keys", async () => {
    const summary = JSON.stringify({ data: "ok", api_key: "sk-secret-123", count: 5 });
    writeAuditEntry({
      timestamp: "2026-06-08T12:00:00Z",
      path: "daemon",
      service: "test",
      tool: "resp_test",
      responseSummary: summary,
      durationMs: 10,
      success: true,
    });
    await flushAuditQueue();

    const entries = await readAuditFile();
    const parsed = JSON.parse(entries[0]!.responseSummary!);
    expect(parsed.api_key).toBe("[REDACTED]");
    expect(parsed.data).toBe("ok");
  });

  test("sanitizes error messages containing sensitive patterns", async () => {
    writeAuditEntry({
      timestamp: "2026-06-08T12:00:00Z",
      path: "cli",
      service: "test",
      tool: "err_test",
      durationMs: 10,
      success: false,
      error: "Failed: token=abc123secret password=hunter2",
    });
    await flushAuditQueue();

    const entries = await readAuditFile();
    expect(entries[0]!.error).not.toContain("abc123secret");
    expect(entries[0]!.error).not.toContain("hunter2");
    expect(entries[0]!.error).toContain("[REDACTED]");
  });

  test("does not false-positive redact values that happen to contain key-like words", async () => {
    writeAuditEntry({
      timestamp: "2026-06-08T12:00:00Z",
      path: "cli",
      service: "test",
      tool: "false_pos_test",
      params: {
        query: "search for authentication tokens in the documentation",
        description: "This is about password management",
      },
      durationMs: 10,
      success: true,
    });
    await flushAuditQueue();

    const entries = await readAuditFile();
    // Values should NOT be redacted -- only keys are checked
    expect(entries[0]!.params!.query).toBe("search for authentication tokens in the documentation");
    expect(entries[0]!.params!.description).toBe("This is about password management");
  });

  test("handles expanded sensitive key patterns", async () => {
    writeAuditEntry({
      timestamp: "2026-06-08T12:00:00Z",
      path: "cli",
      service: "test",
      tool: "expanded_keys",
      params: {
        private_key: "-----BEGIN RSA-----",
        access_key: "AKIA1234567890",
        session_id: "sess_abc123",
        cookie: "session=xyz",
        signing_key: "hmac-sha256",
        passphrase: "my-passphrase",
        normal_field: "visible",
      },
      durationMs: 10,
      success: true,
    });
    await flushAuditQueue();

    const entries = await readAuditFile();
    const p = entries[0]!.params!;
    expect(p.private_key).toBe("[REDACTED]");
    expect(p.access_key).toBe("[REDACTED]");
    expect(p.session_id).toBe("[REDACTED]");
    expect(p.cookie).toBe("[REDACTED]");
    expect(p.signing_key).toBe("[REDACTED]");
    expect(p.passphrase).toBe("[REDACTED]");
    expect(p.normal_field).toBe("visible");
  });

  test("M1: does not false-positive redact 'author' or 'authority' keys", async () => {
    writeAuditEntry({
      timestamp: "2026-06-08T12:00:00Z",
      path: "cli",
      service: "test",
      tool: "auth_test",
      params: {
        author: "Jane Doe",
        authority: "admin-panel",
        auth_token: "should-be-redacted",
        authorization: "Bearer xyz",
        authentication: "basic abc",
      },
      durationMs: 10,
      success: true,
    });
    await flushAuditQueue();

    const entries = await readAuditFile();
    const p = entries[0]!.params!;
    expect(p.author).toBe("Jane Doe");
    expect(p.authority).toBe("admin-panel");
    expect(p.auth_token).toBe("[REDACTED]");
    expect(p.authorization).toBe("[REDACTED]");
    expect(p.authentication).toBe("[REDACTED]");
  });

  test("M3: caps recursion depth to prevent stack overflow", async () => {
    // Build an object nested 15 levels deep (exceeds MAX_SANITIZE_DEPTH of 10)
    let obj: Record<string, unknown> = { leaf: "value" };
    for (let i = 0; i < 15; i++) {
      obj = { nested: obj };
    }

    writeAuditEntry({
      timestamp: "2026-06-08T12:00:00Z",
      path: "cli",
      service: "test",
      tool: "deep_test",
      params: obj,
      durationMs: 10,
      success: true,
    });
    await flushAuditQueue();

    const entries = await readAuditFile();
    expect(entries).toHaveLength(1);
    // Somewhere in the chain, "[nested too deep]" should appear
    const json = JSON.stringify(entries[0]!.params);
    expect(json).toContain("[nested too deep]");
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
    await flushAuditQueue();

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
    await flushAuditQueue();

    const entries = await readAuditFile();
    expect(entries[0]!.success).toBe(false);
    expect(entries[0]!.error).toBe("Connection refused");
  });

  test("includes resolvedTool and transport when provided", async () => {
    auditToolCall({
      path: "daemon",
      service: "test-svc",
      tool: "short_name",
      resolvedTool: "test-svc_short_name",
      transport: "stdio",
      params: {},
      durationMs: 10,
      success: true,
    });
    await flushAuditQueue();

    const entries = await readAuditFile();
    expect(entries[0]!.resolvedTool).toBe("test-svc_short_name");
    expect(entries[0]!.transport).toBe("stdio");
  });

  test("handles circular references in result", async () => {
    const circular: Record<string, unknown> = { a: 1 };
    circular.self = circular;

    auditToolCall({
      path: "cli",
      service: "test",
      tool: "circular_test",
      result: circular,
      durationMs: 10,
      success: true,
    });
    await flushAuditQueue();

    const entries = await readAuditFile();
    expect(entries).toHaveLength(1);
    expect(entries[0]!.responseSummary).toBe("[unserializable]");
  });
});

describe("flushAuditQueue", () => {
  test("resolves after all queued writes complete", async () => {
    for (let i = 0; i < 5; i++) {
      writeAuditEntry({
        timestamp: `2026-06-08T12:00:0${i}Z`,
        path: "cli",
        service: "flush-test",
        tool: `tool_${i}`,
        durationMs: i,
        success: true,
      });
    }
    await flushAuditQueue();

    const entries = await readAuditFile();
    expect(entries).toHaveLength(5);
  });
});

describe("rotation", () => {
  test("rotates when file exceeds max size", async () => {
    // Set a very small max size (1MB is minimum enforced)
    process.env.MCP2CLI_AUDIT_MAX_SIZE = "1048576";
    _resetAuditState();

    // Create a file just over 1MB
    const filePath = join(testDir, "audit.ndjson");
    const bigEntry = JSON.stringify({
      timestamp: "2026-06-08T12:00:00Z",
      path: "cli",
      service: "test",
      tool: "rotation",
      durationMs: 1,
      success: true,
      responseSummary: "x".repeat(1000),
    });
    // Write ~1.1MB of data
    const lines = Array(1100).fill(bigEntry).join("\n") + "\n";
    await writeFile(filePath, lines);

    // Now write one more entry which should trigger rotation
    writeAuditEntry({
      timestamp: "2026-06-08T12:01:00Z",
      path: "cli",
      service: "test",
      tool: "after_rotation",
      durationMs: 1,
      success: true,
    });
    await flushAuditQueue();

    // Backup file should exist
    const backupFile = Bun.file(`${filePath}.1`);
    expect(await backupFile.exists()).toBe(true);

    // New file should have just the one new entry
    const entries = await readAuditFile();
    expect(entries.length).toBeGreaterThanOrEqual(1);
    const lastEntry = entries[entries.length - 1]!;
    expect(lastEntry.tool).toBe("after_rotation");
  });
});
