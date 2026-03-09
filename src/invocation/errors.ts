import type { ErrorCode } from "../types/index.ts";

/**
 * Structured error for MCP tool-level failures.
 * Thrown when the tool itself reports isError=true in its response.
 */
export class ToolError extends Error {
  readonly code: ErrorCode;
  readonly reason?: string;

  constructor(message: string, reason?: string) {
    super(message);
    this.name = "ToolError";
    this.code = "TOOL_ERROR" satisfies ErrorCode;
    this.reason = reason;
  }
}
