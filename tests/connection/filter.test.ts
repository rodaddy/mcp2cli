import { describe, test, expect } from "bun:test";
import { isJsonRpcLine, parseJsonRpcLine } from "../../src/connection/filter.ts";

describe("isJsonRpcLine", () => {
  test("valid JSON-RPC request returns true", () => {
    expect(isJsonRpcLine('{"jsonrpc":"2.0","id":1,"method":"test"}')).toBe(
      true,
    );
  });

  test("empty line returns false", () => {
    expect(isJsonRpcLine("")).toBe(false);
  });

  test("whitespace-only returns false", () => {
    expect(isJsonRpcLine("   ")).toBe(false);
  });

  test("npx warning returns false", () => {
    expect(isJsonRpcLine("npm warn using --force")).toBe(false);
  });

  test("Node deprecation warning returns false", () => {
    expect(
      isJsonRpcLine("(node:123) DeprecationWarning: something deprecated"),
    ).toBe(false);
  });

  test("random text returns false", () => {
    expect(isJsonRpcLine("Starting server...")).toBe(false);
  });

  test("valid JSON without jsonrpc field returns false", () => {
    expect(isJsonRpcLine('{"name":"test"}')).toBe(false);
  });

  test("invalid JSON starting with { returns false", () => {
    expect(isJsonRpcLine('{"broken')).toBe(false);
  });

  test("ANSI escape codes return false", () => {
    expect(isJsonRpcLine("\x1b[32mSuccess\x1b[0m")).toBe(false);
  });

  test("JSON-RPC notification (no id) returns true", () => {
    expect(
      isJsonRpcLine(
        '{"jsonrpc":"2.0","method":"notifications/initialized"}',
      ),
    ).toBe(true);
  });
});

describe("parseJsonRpcLine", () => {
  test("valid JSON-RPC returns parsed object", () => {
    const result = parseJsonRpcLine('{"jsonrpc":"2.0","id":1,"method":"test"}');
    expect(result).not.toBeNull();
    const obj = result as Record<string, unknown>;
    expect(obj.jsonrpc).toBe("2.0");
    expect(obj.id).toBe(1);
    expect(obj.method).toBe("test");
  });

  test("empty line returns null", () => {
    expect(parseJsonRpcLine("")).toBeNull();
  });

  test("noise returns null", () => {
    expect(parseJsonRpcLine("npm warn using --force")).toBeNull();
  });

  test("valid JSON without jsonrpc field returns null", () => {
    expect(parseJsonRpcLine('{"name":"test"}')).toBeNull();
  });

  test("invalid JSON starting with { returns null", () => {
    expect(parseJsonRpcLine('{"broken')).toBeNull();
  });

  test("notification (no id) returns parsed object", () => {
    const result = parseJsonRpcLine(
      '{"jsonrpc":"2.0","method":"notifications/initialized"}',
    );
    expect(result).not.toBeNull();
    const obj = result as Record<string, unknown>;
    expect(obj.jsonrpc).toBe("2.0");
    expect(obj.method).toBe("notifications/initialized");
  });
});
