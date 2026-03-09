import { describe, test, expect } from "bun:test";
import { validateToolCallInputs } from "../../src/invocation/validate.ts";
import type { ParsedToolCall } from "../../src/invocation/types.ts";

describe("validateToolCallInputs", () => {
  test("clean service + tool + empty params -> valid", () => {
    const parsed: ParsedToolCall = {
      serviceName: "n8n",
      toolName: "list_workflows",
      params: {},
      dryRun: false,
      fields: [],
    };
    const result = validateToolCallInputs(parsed);
    expect(result.valid).toBe(true);
  });

  test('service name "../etc" -> rejected PATH_TRAVERSAL', () => {
    const parsed: ParsedToolCall = {
      serviceName: "../etc",
      toolName: "list",
      params: {},
      dryRun: false,
      fields: [],
    };
    const result = validateToolCallInputs(parsed);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.code).toBe("PATH_TRAVERSAL");
    }
  });

  test('tool name with null byte -> rejected CONTROL_CHAR', () => {
    const parsed: ParsedToolCall = {
      serviceName: "n8n",
      toolName: "list\x00",
      params: {},
      dryRun: false,
      fields: [],
    };
    const result = validateToolCallInputs(parsed);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.code).toBe("CONTROL_CHAR");
    }
  });

  test('param key "../key" -> rejected PATH_TRAVERSAL', () => {
    const parsed: ParsedToolCall = {
      serviceName: "n8n",
      toolName: "list",
      params: { "../key": "value" },
      dryRun: false,
      fields: [],
    };
    const result = validateToolCallInputs(parsed);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.code).toBe("PATH_TRAVERSAL");
    }
  });

  test('param string value with null byte -> rejected CONTROL_CHAR', () => {
    const parsed: ParsedToolCall = {
      serviceName: "n8n",
      toolName: "list",
      params: { name: "val\x00" },
      dryRun: false,
      fields: [],
    };
    const result = validateToolCallInputs(parsed);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.code).toBe("CONTROL_CHAR");
    }
  });

  test("nested object with clean values -> valid", () => {
    const parsed: ParsedToolCall = {
      serviceName: "n8n",
      toolName: "create",
      params: {
        name: "test",
        settings: { timeout: 30, label: "prod" },
      },
      dryRun: false,
      fields: [],
    };
    const result = validateToolCallInputs(parsed);
    expect(result.valid).toBe(true);
  });

  test("deeply nested bad value -> rejected", () => {
    const parsed: ParsedToolCall = {
      serviceName: "n8n",
      toolName: "create",
      params: {
        a: { b: { c: "\x00" } },
      },
      dryRun: false,
      fields: [],
    };
    const result = validateToolCallInputs(parsed);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.code).toBe("CONTROL_CHAR");
    }
  });

  test("numeric/boolean param values pass through -> valid", () => {
    const parsed: ParsedToolCall = {
      serviceName: "n8n",
      toolName: "update",
      params: {
        id: 42,
        active: true,
        retries: 0,
        disabled: false,
      },
      dryRun: false,
      fields: [],
    };
    const result = validateToolCallInputs(parsed);
    expect(result.valid).toBe(true);
  });
});
