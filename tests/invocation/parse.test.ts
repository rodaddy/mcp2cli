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
});
