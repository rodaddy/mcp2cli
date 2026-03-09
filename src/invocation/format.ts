import type { ToolCallSuccess } from "./types.ts";
import { ToolError } from "./errors.ts";

/**
 * Shape of an MCP SDK CallToolResult.
 * Defined locally to avoid tight coupling to SDK version internals.
 */
interface SdkCallToolResult {
  content: Array<{ type: string; text?: string; [key: string]: unknown }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
  toolResult?: unknown;
  _meta?: Record<string, unknown>;
}

/**
 * Extract text from the first text content block in an SDK result.
 * Returns undefined if no text content block is found.
 */
export function extractTextContent(
  result: SdkCallToolResult,
): string | undefined {
  const textBlock = result.content.find((block) => block.type === "text");
  return textBlock?.text;
}

/**
 * Normalize an SDK CallToolResult into a clean { success: true, result: ... } envelope.
 *
 * Priority order:
 * 1. isError=true -> throw ToolError with text content
 * 2. structuredContent present -> use directly
 * 3. Single text content with valid JSON -> parse and embed
 * 4. Single text content with non-JSON -> wrap as { text: "..." }
 * 5. Multiple content blocks -> wrap as { content: [...] }
 * 6. Empty content -> null
 * 7. Legacy toolResult -> use directly
 * 8. Fallback -> null
 */
export function formatToolResult(result: SdkCallToolResult): ToolCallSuccess {
  // 1. Error results throw
  if (result.isError) {
    const text = extractTextContent(result) ?? "Tool call failed";
    throw new ToolError(text, "tool_reported_error");
  }

  // 2. Structured content takes priority
  if (result.structuredContent !== undefined) {
    return { success: true, result: result.structuredContent };
  }

  const { content } = result;

  // 5. Multiple content blocks
  if (content.length > 1) {
    return { success: true, result: { content } };
  }

  // 3-4. Single text content block
  if (content.length === 1) {
    const block = content[0];
    if (block?.type === "text" && typeof block.text === "string") {
      try {
        const parsed = JSON.parse(block.text) as unknown;
        return { success: true, result: parsed };
      } catch {
        return { success: true, result: { text: block.text } };
      }
    }
    // Non-text single block -- wrap in content array
    return { success: true, result: { content } };
  }

  // 6. Empty content -- check for legacy toolResult, then null
  // 7. Check for legacy toolResult
  if ("toolResult" in result && result.toolResult !== undefined) {
    return { success: true, result: result.toolResult };
  }
  return { success: true, result: null };
}
