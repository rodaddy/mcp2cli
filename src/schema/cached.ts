/**
 * Cache-aware schema introspection.
 * Checks disk cache before hitting MCP servers. Writes through on miss.
 * All call sites should use these instead of raw listToolsForService/getToolSchema.
 */
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { ToolSummary, SchemaOutput } from "./types.ts";
import type { CachedToolSchema } from "../cache/types.ts";
import { listToolsForService, getToolSchema, generateUsageExample, resolveToolName } from "./introspect.ts";
import { readCache, writeCache, hashToolSchema, resolveTtlMs } from "../cache/index.ts";
import { createLogger } from "../logger/index.ts";

const log = createLogger("schema-cache");

/**
 * List tools for a service, using cache when available.
 * Falls back to live MCP introspection on cache miss/expiry.
 */
export async function listToolsCached(
  client: Client,
  serviceName: string,
): Promise<ToolSummary[]> {
  const cached = await readCache(serviceName);
  if (cached) {
    log.debug("list_tools_cache_hit", { service: serviceName, toolCount: cached.tools.length });
    return cached.tools.map((t) => ({
      name: t.name,
      description: t.description,
    }));
  }

  const tools = await listToolsForService(client);
  cacheToolList(serviceName, client).catch(() => {});
  return tools;
}

/**
 * Get full schema for a specific tool, using cache when available.
 * Falls back to live MCP introspection on cache miss/expiry.
 */
export async function getToolSchemaCached(
  client: Client,
  toolName: string,
  serviceName: string,
): Promise<SchemaOutput | null> {
  const cached = await readCache(serviceName);
  if (cached) {
    const resolved = resolveToolName(cached.tools, toolName, serviceName);
    const cachedTool = resolved ? cached.tools.find((t) => t.name === resolved) : null;
    if (cachedTool) {
      log.debug("get_schema_cache_hit", { service: serviceName, tool: cachedTool.name });
      return {
        tool: cachedTool.name,
        description: cachedTool.description,
        inputSchema: cachedTool.inputSchema,
        annotations: cachedTool.annotations,
        usage: generateUsageExample(serviceName, cachedTool.name, cachedTool.inputSchema),
      };
    }
  }

  const result = await getToolSchema(client, toolName, serviceName);
  if (result) {
    cacheToolList(serviceName, client).catch(() => {});
  }
  return result;
}

/**
 * Resolve a tool name using cached schemas when available.
 * Falls back to live listTools if cache misses.
 * Returns the resolved name or the original if no resolution found.
 */
export async function resolveToolNameCached(
  client: Client,
  toolName: string,
  serviceName: string,
): Promise<{ resolvedName: string; tools: { name: string }[] }> {
  const cached = await readCache(serviceName);
  if (cached) {
    const resolved = resolveToolName(cached.tools, toolName, serviceName);
    return {
      resolvedName: resolved ?? toolName,
      tools: cached.tools,
    };
  }

  const response = await client.listTools();
  const resolved = resolveToolName(response.tools, toolName, serviceName);
  cacheToolList(serviceName, client).catch(() => {});
  return {
    resolvedName: resolved ?? toolName,
    tools: response.tools,
  };
}

/**
 * Fetch full tool list from MCP server and write to cache.
 * Fire-and-forget — errors are logged but never propagated.
 */
async function cacheToolList(serviceName: string, client: Client): Promise<void> {
  try {
    const response = await client.listTools();
    const schemas: CachedToolSchema[] = await Promise.all(
      response.tools.map(async (tool) => ({
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
    await writeCache(serviceName, schemas, resolveTtlMs());
    log.debug("cache_populated", { service: serviceName, toolCount: schemas.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn("cache_write_failed", { service: serviceName, error: message });
  }
}
