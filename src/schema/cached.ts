/**
 * Cache-aware schema introspection.
 * Checks disk cache before hitting MCP servers. Writes through on miss.
 * All call sites should use these instead of raw listToolsForService/getToolSchema.
 */
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { ToolSummary, SchemaOutput } from "./types.ts";
import { listAllTools, generateUsageExample, resolveToolName } from "./introspect.ts";
import { truncateDescription } from "./format.ts";
import { readCache, writeCache, resolveTtlMs, mapToolsToCachedSchemas } from "../cache/index.ts";
import type { RawMcpTool } from "../cache/index.ts";
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
    return cached.tools
      .map((t) => ({
        name: t.name,
        description: truncateDescription(t.description),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  const rawTools = await listAllTools(client);
  cacheToolsFromResponse(serviceName, rawTools);
  return rawTools
    .map((t) => ({
      name: t.name,
      description: truncateDescription(t.description ?? "(no description)"),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
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

  const rawTools = await listAllTools(client);
  const resolved = resolveToolName(rawTools, toolName, serviceName);
  const tool = resolved ? rawTools.find((t) => t.name === resolved) : null;

  if (tool) {
    cacheToolsFromResponse(serviceName, rawTools);
    return {
      tool: tool.name,
      description: tool.description ?? "(no description)",
      inputSchema: tool.inputSchema,
      annotations: tool.annotations as object | undefined,
      usage: generateUsageExample(serviceName, tool.name, tool.inputSchema),
    };
  }

  return null;
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

  const rawTools = await listAllTools(client);
  const resolved = resolveToolName(rawTools, toolName, serviceName);
  cacheToolsFromResponse(serviceName, rawTools);
  return {
    resolvedName: resolved ?? toolName,
    tools: rawTools,
  };
}

/**
 * Hash and write pre-fetched tools to cache.
 * Fire-and-forget — errors are logged but never propagated.
 * Callers pass already-fetched tools to avoid double round-trips.
 */
async function cacheToolsFromResponse(serviceName: string, tools: RawMcpTool[]): Promise<void> {
  try {
    const schemas = await mapToolsToCachedSchemas(tools);
    await writeCache(serviceName, schemas, resolveTtlMs());
    log.debug("cache_populated", { service: serviceName, toolCount: schemas.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn("cache_write_failed", { service: serviceName, error: message });
  }
}
