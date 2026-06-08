import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { resolveTtlMs } from "../../src/cache/storage.ts";

let origTtl: string | undefined;

beforeEach(() => {
  origTtl = process.env.MCP2CLI_SCHEMA_TTL;
});

afterEach(() => {
  if (origTtl !== undefined) {
    process.env.MCP2CLI_SCHEMA_TTL = origTtl;
  } else {
    delete process.env.MCP2CLI_SCHEMA_TTL;
  }
});

describe("resolveTtlMs", () => {
  test("returns 24h default when env var not set", () => {
    delete process.env.MCP2CLI_SCHEMA_TTL;
    expect(resolveTtlMs()).toBe(24 * 60 * 60 * 1000);
  });

  test("converts seconds from env var to milliseconds", () => {
    process.env.MCP2CLI_SCHEMA_TTL = "3600";
    expect(resolveTtlMs()).toBe(3600 * 1000);
  });

  test("handles 1-second TTL", () => {
    process.env.MCP2CLI_SCHEMA_TTL = "1";
    expect(resolveTtlMs()).toBe(1000);
  });

  test("falls back to default on non-numeric value", () => {
    process.env.MCP2CLI_SCHEMA_TTL = "not-a-number";
    expect(resolveTtlMs()).toBe(24 * 60 * 60 * 1000);
  });

  test("falls back to default on zero", () => {
    process.env.MCP2CLI_SCHEMA_TTL = "0";
    expect(resolveTtlMs()).toBe(24 * 60 * 60 * 1000);
  });

  test("falls back to default on negative value", () => {
    process.env.MCP2CLI_SCHEMA_TTL = "-100";
    expect(resolveTtlMs()).toBe(24 * 60 * 60 * 1000);
  });

  test("falls back to default on empty string", () => {
    process.env.MCP2CLI_SCHEMA_TTL = "";
    expect(resolveTtlMs()).toBe(24 * 60 * 60 * 1000);
  });
});
