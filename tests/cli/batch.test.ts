import { describe, test, expect } from "bun:test";
import { parseBatchInput } from "../../src/cli/commands/batch.ts";
import type { BatchResult } from "../../src/cli/commands/batch.ts";

describe("parseBatchInput", () => {
  test("parses valid NDJSON lines", () => {
    const input = [
      '{"service": "n8n", "tool": "n8n_list_workflows", "params": {}}',
      '{"service": "n8n", "tool": "n8n_get_workflow", "params": {"id": "1"}}',
    ].join("\n");

    const results = parseBatchInput(input);
    expect(results).toHaveLength(2);
    expect(results[0]!.spec).toEqual({
      service: "n8n",
      tool: "n8n_list_workflows",
      params: {},
    });
    expect(results[1]!.spec).toEqual({
      service: "n8n",
      tool: "n8n_get_workflow",
      params: { id: "1" },
    });
  });

  test("skips blank lines", () => {
    const input = [
      '{"service": "n8n", "tool": "n8n_list_workflows", "params": {}}',
      "",
      "   ",
      '{"service": "n8n", "tool": "n8n_get_workflow", "params": {}}',
    ].join("\n");

    const results = parseBatchInput(input);
    expect(results).toHaveLength(2);
    expect(results[0]!.spec!.tool).toBe("n8n_list_workflows");
    expect(results[1]!.spec!.tool).toBe("n8n_get_workflow");
  });

  test("handles empty input", () => {
    const results = parseBatchInput("");
    expect(results).toHaveLength(0);
  });

  test("handles whitespace-only input", () => {
    const results = parseBatchInput("   \n  \n   ");
    expect(results).toHaveLength(0);
  });

  test("reports invalid JSON lines as errors", () => {
    const input = [
      '{"service": "n8n", "tool": "n8n_list_workflows", "params": {}}',
      "not valid json",
      '{"service": "n8n", "tool": "n8n_get_workflow", "params": {}}',
    ].join("\n");

    const results = parseBatchInput(input);
    expect(results).toHaveLength(3);
    expect(results[0]!.spec).toBeDefined();
    expect(results[1]!.error).toContain("Invalid JSON");
    expect(results[1]!.line).toBe(2);
    expect(results[2]!.spec).toBeDefined();
  });

  test("reports missing service field as error", () => {
    const input = '{"tool": "n8n_list_workflows", "params": {}}';
    const results = parseBatchInput(input);
    expect(results).toHaveLength(1);
    expect(results[0]!.error).toContain("Missing required fields");
  });

  test("reports missing tool field as error", () => {
    const input = '{"service": "n8n", "params": {}}';
    const results = parseBatchInput(input);
    expect(results).toHaveLength(1);
    expect(results[0]!.error).toContain("Missing required fields");
  });

  test("defaults params to empty object when missing", () => {
    const input = '{"service": "n8n", "tool": "n8n_list_workflows"}';
    const results = parseBatchInput(input);
    expect(results).toHaveLength(1);
    expect(results[0]!.spec!.params).toEqual({});
  });

  test("preserves line numbers for error reporting", () => {
    const input = [
      '{"service": "n8n", "tool": "tool1", "params": {}}',
      "",
      "bad json",
      '{"service": "n8n", "tool": "tool2", "params": {}}',
    ].join("\n");

    const results = parseBatchInput(input);
    expect(results).toHaveLength(3);
    expect(results[0]!.line).toBe(1);
    // Line 2 is blank, skipped
    expect(results[1]!.line).toBe(3);
    expect(results[1]!.error).toBeDefined();
    expect(results[2]!.line).toBe(4);
  });

  test("handles mixed valid and invalid lines without aborting", () => {
    const input = [
      '{"service": "a", "tool": "t1", "params": {}}',
      "garbage",
      '{"service": "b", "tool": "t2", "params": {"x": 1}}',
      '{"no_service": true}',
      '{"service": "c", "tool": "t3", "params": {}}',
    ].join("\n");

    const results = parseBatchInput(input);
    expect(results).toHaveLength(5);

    // Valid entries
    const validSpecs = results.filter((r) => r.spec).map((r) => r.spec!);
    expect(validSpecs).toHaveLength(3);
    expect(validSpecs[0]!.service).toBe("a");
    expect(validSpecs[1]!.service).toBe("b");
    expect(validSpecs[2]!.service).toBe("c");

    // Error entries
    const errors = results.filter((r) => r.error);
    expect(errors).toHaveLength(2);
  });
});

describe("BatchResult type conformance", () => {
  test("success result has expected shape", () => {
    const result: BatchResult = {
      service: "n8n",
      tool: "n8n_list_workflows",
      success: true,
      result: { workflows: [] },
    };
    expect(result.success).toBe(true);
    expect(result.service).toBe("n8n");
    expect(result.tool).toBe("n8n_list_workflows");
    expect(result.result).toEqual({ workflows: [] });
  });

  test("error result has expected shape", () => {
    const result: BatchResult = {
      service: "n8n",
      tool: "n8n_get_workflow",
      success: false,
      error: { code: "TOOL_ERROR", message: "Not found" },
    };
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error!.code).toBe("TOOL_ERROR");
  });
});
