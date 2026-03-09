/**
 * Stdout line filter for MCP stdio transport.
 * Identifies JSON-RPC 2.0 messages and discards noise
 * (npx warnings, Node deprecation notices, blank lines, etc).
 */

import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";

/**
 * Parses a line as a JSON-RPC 2.0 message, returning the parsed object
 * or null if the line is not valid JSON-RPC. Eliminates double-parsing
 * by returning the already-parsed message.
 */
export function parseJsonRpcLine(line: string): JSONRPCMessage | null {
  const trimmed = line.trim();
  if (trimmed.length === 0) return null;
  if (trimmed[0] !== "{") return null;

  try {
    const parsed = JSON.parse(trimmed);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      parsed.jsonrpc === "2.0"
    ) {
      return parsed as JSONRPCMessage;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Returns true if the given line is a valid JSON-RPC 2.0 message.
 * Boolean wrapper around parseJsonRpcLine for backward compatibility.
 */
export function isJsonRpcLine(line: string): boolean {
  return parseJsonRpcLine(line) !== null;
}
