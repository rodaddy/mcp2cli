import { describe, test, expect } from "bun:test";
import { parseToolCallArgs } from "../../src/invocation/parse.ts";

describe("parseToolCallArgs", () => {
  test('["n8n", "list"] -> ok with serviceName="n8n", toolName="list", params={}', () => {
    const result = parseToolCallArgs(["n8n", "list"]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.serviceName).toBe("n8n");
      expect(result.value.toolName).toBe("list");
      expect(result.value.params).toEqual({});
    }
  });

  test('["n8n", "get", "--params", \'{"id":"1"}\'] -> ok with parsed params', () => {
    const result = parseToolCallArgs(["n8n", "get", "--params", '{"id":"1"}']);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.serviceName).toBe("n8n");
      expect(result.value.toolName).toBe("get");
      expect(result.value.params).toEqual({ id: "1" });
    }
  });

  test('["n8n", "get", "--params={}"] -> ok with equals syntax', () => {
    const result = parseToolCallArgs(["n8n", "get", "--params={}"]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.params).toEqual({});
    }
  });

  test('["n8n"] -> error, missing tool name', () => {
    const result = parseToolCallArgs(["n8n"]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("UNKNOWN_COMMAND");
    }
  });

  test('["n8n", "get", "--params", "not-json"] -> error, bad JSON', () => {
    const result = parseToolCallArgs(["n8n", "get", "--params", "not-json"]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("INPUT_VALIDATION_ERROR");
    }
  });

  test("nested params are parsed correctly", () => {
    const result = parseToolCallArgs([
      "n8n",
      "create",
      "--params",
      '{"name":"test","settings":{"timeout":30}}',
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.params).toEqual({
        name: "test",
        settings: { timeout: 30 },
      });
    }
  });

  test("no --params flag defaults to empty object", () => {
    const result = parseToolCallArgs(["n8n", "list"]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.params).toEqual({});
    }
  });

  test("extra args after --params are ignored", () => {
    const result = parseToolCallArgs([
      "n8n",
      "list",
      "--params",
      "{}",
      "--extra",
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.params).toEqual({});
    }
  });

  // --- Phase 8 Plan 01: --dry-run flag ---

  test("--dry-run flag sets dryRun: true", () => {
    const result = parseToolCallArgs(["n8n", "list", "--dry-run"]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.dryRun).toBe(true);
      expect(result.value.params).toEqual({});
    }
  });

  test("no --dry-run flag defaults dryRun: false", () => {
    const result = parseToolCallArgs(["n8n", "list"]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.dryRun).toBe(false);
    }
  });

  test("--dry-run without --params works (no early return)", () => {
    const result = parseToolCallArgs(["n8n", "create_item", "--dry-run"]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.dryRun).toBe(true);
      expect(result.value.params).toEqual({});
    }
  });

  // --- Phase 8 Plan 01: --fields flag ---

  test('--fields "id,name" extracts comma-separated list (space syntax)', () => {
    const result = parseToolCallArgs(["n8n", "list", "--fields", "id,name"]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.fields).toEqual(["id", "name"]);
    }
  });

  test('--fields="id,name" extracts comma-separated list (equals syntax)', () => {
    const result = parseToolCallArgs(["n8n", "list", "--fields=id,name"]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.fields).toEqual(["id", "name"]);
    }
  });

  test("--fields with dot-notation paths", () => {
    const result = parseToolCallArgs(["n8n", "list", "--fields", "id,settings.timezone"]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.fields).toEqual(["id", "settings.timezone"]);
    }
  });

  test("no --fields flag defaults to empty array", () => {
    const result = parseToolCallArgs(["n8n", "list"]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.fields).toEqual([]);
    }
  });

  test("--fields without --params works", () => {
    const result = parseToolCallArgs(["n8n", "list", "--fields", "id"]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.fields).toEqual(["id"]);
      expect(result.value.params).toEqual({});
    }
  });

  // --- Phase 8 Plan 01: all three flags combined ---

  test("all three flags in mixed order: --fields, --dry-run, --params", () => {
    const result = parseToolCallArgs([
      "n8n",
      "create_item",
      "--fields",
      "id,name",
      "--dry-run",
      "--params",
      '{"name":"test"}',
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.dryRun).toBe(true);
      expect(result.value.fields).toEqual(["id", "name"]);
      expect(result.value.params).toEqual({ name: "test" });
    }
  });

  test("all three flags in another order: --params, --fields, --dry-run", () => {
    const result = parseToolCallArgs([
      "n8n",
      "list",
      "--params",
      "{}",
      "--fields=status",
      "--dry-run",
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.dryRun).toBe(true);
      expect(result.value.fields).toEqual(["status"]);
      expect(result.value.params).toEqual({});
    }
  });

  // --- Phase 18: --format flag ---

  test("no --format flag defaults to json", () => {
    const result = parseToolCallArgs(["n8n", "list"]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.format).toBe("json");
    }
  });

  test("--format table sets format (space syntax)", () => {
    const result = parseToolCallArgs(["n8n", "list", "--format", "table"]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.format).toBe("table");
    }
  });

  test("--format=yaml sets format (equals syntax)", () => {
    const result = parseToolCallArgs(["n8n", "list", "--format=yaml"]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.format).toBe("yaml");
    }
  });

  test("--format csv works", () => {
    const result = parseToolCallArgs(["n8n", "list", "--format", "csv"]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.format).toBe("csv");
    }
  });

  test("--format ndjson works", () => {
    const result = parseToolCallArgs(["n8n", "list", "--format=ndjson"]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.format).toBe("ndjson");
    }
  });

  test("--format with invalid value returns error", () => {
    const result = parseToolCallArgs(["n8n", "list", "--format", "xml"]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("INPUT_VALIDATION_ERROR");
      expect(result.error.message).toContain("xml");
      expect(result.error.message).toContain("Valid formats");
    }
  });

  test("--format= with invalid value returns error (equals syntax)", () => {
    const result = parseToolCallArgs(["n8n", "list", "--format=tsv"]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("INPUT_VALIDATION_ERROR");
      expect(result.error.message).toContain("tsv");
    }
  });

  test("--format combined with other flags", () => {
    const result = parseToolCallArgs([
      "n8n",
      "list",
      "--format",
      "table",
      "--params",
      "{}",
      "--fields=id,name",
      "--dry-run",
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.format).toBe("table");
      expect(result.value.dryRun).toBe(true);
      expect(result.value.fields).toEqual(["id", "name"]);
      expect(result.value.params).toEqual({});
    }
  });
});

describe("parseToolCallArgs --params - (stdin)", () => {
  const stdin = (s: string) => ({ readStdin: () => s });
  const SECRET = "s3cr3t-value-that-must-not-leak";

  test("reads the JSON object from stdin with --params -", () => {
    const result = parseToolCallArgs(
      ["vw", "create_secret", "--params", "-"],
      stdin(`{"name":"x","password":"${SECRET}"}\n`),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.params).toEqual({ name: "x", password: SECRET });
  });

  test("reads from stdin with --params=- and keeps other flags", () => {
    const result = parseToolCallArgs(
      ["vw", "create_secret", "--params=-", "--fields", "id"],
      stdin('{"a":1}'),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.params).toEqual({ a: 1 });
      expect(result.value.fields).toEqual(["id"]);
    }
  });

  test("does not touch stdin unless asked", () => {
    let read = false;
    const result = parseToolCallArgs(["vw", "list", "--params", "{}"], {
      readStdin: () => { read = true; return "{}"; },
    });
    expect(result.ok).toBe(true);
    expect(read).toBe(false);
  });

  test("empty stdin is a validation error", () => {
    const result = parseToolCallArgs(["vw", "t", "--params", "-"], stdin("  \n"));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INPUT_VALIDATION_ERROR");
  });

  test("invalid JSON on stdin never echoes the input", () => {
    const result = parseToolCallArgs(["vw", "t", "--params", "-"], stdin(`{"password":${SECRET}`));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("INPUT_VALIDATION_ERROR");
      expect(JSON.stringify(result.error)).not.toContain(SECRET);
    }
  });

  test("a non-object on stdin is rejected", () => {
    const result = parseToolCallArgs(["vw", "t", "--params", "-"], stdin("[1,2]"));
    expect(result.ok).toBe(false);
  });

  test("a stdin read failure is a validation error", () => {
    const result = parseToolCallArgs(["vw", "t", "--params", "-"], {
      readStdin: () => { throw new Error("EAGAIN"); },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain("could not read stdin");
  });
});
