import { describe, test, expect } from "bun:test";
import {
  formatToolResult,
  extractTextContent,
} from "../../src/invocation/format.ts";
import { ToolError } from "../../src/invocation/errors.ts";

// Helper to build mock CallToolResult objects
function mockResult(overrides: Record<string, unknown> = {}) {
  return {
    content: [],
    ...overrides,
  };
}

describe("formatToolResult", () => {
  test("single text content with valid JSON -> parsed result", () => {
    const result = mockResult({
      content: [{ type: "text", text: '{"id":1,"name":"test"}' }],
    });
    const formatted = formatToolResult(result as never);
    expect(formatted.success).toBe(true);
    expect(formatted.result).toEqual({ id: 1, name: "test" });
  });

  test("single text content with non-JSON -> wrapped text", () => {
    const result = mockResult({
      content: [{ type: "text", text: "hello world" }],
    });
    const formatted = formatToolResult(result as never);
    expect(formatted.success).toBe(true);
    expect(formatted.result).toEqual({ text: "hello world" });
  });

  test("multiple content blocks -> content array", () => {
    const content = [
      { type: "text", text: "first" },
      { type: "text", text: "second" },
    ];
    const result = mockResult({ content });
    const formatted = formatToolResult(result as never);
    expect(formatted.success).toBe(true);
    expect(formatted.result).toEqual({ content });
  });

  test("structuredContent present -> used directly", () => {
    const structured = { workflows: [{ id: 1 }] };
    const result = mockResult({ structuredContent: structured });
    const formatted = formatToolResult(result as never);
    expect(formatted.success).toBe(true);
    expect(formatted.result).toEqual(structured);
  });

  test("legacy toolResult -> used directly", () => {
    const result = mockResult({
      content: [],
      toolResult: { legacy: true },
    });
    const formatted = formatToolResult(result as never);
    expect(formatted.success).toBe(true);
    expect(formatted.result).toEqual({ legacy: true });
  });

  test("isError=true -> throws ToolError", () => {
    const result = mockResult({
      isError: true,
      content: [{ type: "text", text: "workflow not found" }],
    });
    expect(() => formatToolResult(result as never)).toThrow(ToolError);
    try {
      formatToolResult(result as never);
    } catch (err) {
      expect(err).toBeInstanceOf(ToolError);
      if (err instanceof ToolError) {
        expect(err.code).toBe("TOOL_ERROR");
        expect(err.message).toBe("workflow not found");
        expect(err.reason).toBe("tool_reported_error");
      }
    }
  });

  test("empty content array -> null result", () => {
    const result = mockResult({ content: [] });
    const formatted = formatToolResult(result as never);
    expect(formatted.success).toBe(true);
    expect(formatted.result).toBeNull();
  });
});

describe("extractTextContent", () => {
  test("extracts text from first text content block", () => {
    const result = mockResult({
      content: [{ type: "text", text: "hello" }],
    });
    expect(extractTextContent(result as never)).toBe("hello");
  });

  test("returns undefined for empty content", () => {
    const result = mockResult({ content: [] });
    expect(extractTextContent(result as never)).toBeUndefined();
  });
});
