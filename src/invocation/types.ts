import type { ErrorCode } from "../types/index.ts";
import type { OutputFormat } from "../format/types.ts";

/**
 * Parsed CLI tool call arguments.
 * Extracted from argv: mcp2cli <service> <tool> [--params '{}']
 */
export interface ParsedToolCall {
  serviceName: string;
  toolName: string;
  params: Record<string, unknown>;
  dryRun: boolean;
  fields: string[];
  format: OutputFormat;
}

/**
 * Structured parse error with machine-readable code.
 */
export interface ParseError {
  error: true;
  code: ErrorCode;
  message: string;
  reason?: string;
}

/**
 * Discriminated union for parse results.
 * Callers check .ok to narrow the type.
 */
export type ParseResult =
  | { ok: true; value: ParsedToolCall }
  | { ok: false; error: ParseError };

/**
 * Normalized successful tool call response.
 * All SDK result shapes collapse into this envelope.
 */
export interface ToolCallSuccess {
  success: true;
  result: unknown;
}
