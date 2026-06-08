/**
 * Map raw MCP tool responses to CachedToolSchema objects.
 * Shared by all code paths that need to hash and cache tool schemas.
 */
import type { CachedToolSchema } from "./types.ts";
import { hashToolSchema } from "./hash.ts";

/** Raw tool shape returned by MCP client.listTools() */
export interface RawMcpTool {
  name: string;
  description?: string;
  inputSchema: object;
  annotations?: unknown;
}

/**
 * Map an array of raw MCP tools to CachedToolSchema objects.
 * Computes the SHA-256 hash for each tool's schema surface.
 */
export async function mapToolsToCachedSchemas(
  tools: RawMcpTool[],
): Promise<CachedToolSchema[]> {
  return Promise.all(
    tools.map(async (tool) => ({
      name: tool.name,
      description: tool.description ?? "(no description)",
      inputSchema: tool.inputSchema,
      annotations: tool.annotations as object | undefined,
      hash: await hashToolSchema({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: tool.annotations as object | undefined,
      }),
    })),
  );
}
