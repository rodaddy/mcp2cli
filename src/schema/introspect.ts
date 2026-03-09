/**
 * Core schema introspection functions.
 * Queries MCP servers for tool metadata via client.listTools().
 */
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { DotNotation, SchemaOutput, ToolSummary } from "./types.ts";

/**
 * Truncate a description to first sentence or 80 chars.
 * Shared utility used by listToolsForService and format.ts.
 */
function truncateDesc(desc: string | undefined): string {
  if (!desc) return "(no description)";

  // Try to extract first sentence (split on ". " or ".\n")
  const sentenceMatch = desc.match(/^[^.]*\./);
  if (sentenceMatch && sentenceMatch[0]!.length <= 80) {
    return sentenceMatch[0]!;
  }

  // Truncate at 80 chars if too long
  if (desc.length > 80) {
    return desc.slice(0, 80) + "...";
  }

  return desc;
}

/** Parse "service.tool" dot notation into components */
export function parseDotNotation(
  arg: string,
): { ok: true; value: DotNotation } | { ok: false; error: string } {
  const dotIndex = arg.indexOf(".");
  if (dotIndex === -1) {
    return { ok: false, error: "Expected dot notation: <service>.<tool>" };
  }

  const service = arg.slice(0, dotIndex);
  const tool = arg.slice(dotIndex + 1);

  if (!service) {
    return { ok: false, error: "Empty service name in dot notation" };
  }
  if (!tool) {
    return { ok: false, error: "Empty tool name in dot notation" };
  }

  return { ok: true, value: { service, tool } };
}

/** List all tools for a service, sorted alphabetically */
export async function listToolsForService(
  client: Client,
): Promise<ToolSummary[]> {
  const allTools: ToolSummary[] = [];
  let cursor: string | undefined;

  // Loop for pagination support
  do {
    const response = await client.listTools(
      cursor ? { cursor } : undefined,
    );

    for (const tool of response.tools) {
      allTools.push({
        name: tool.name,
        description: truncateDesc(tool.description),
      });
    }

    cursor = response.nextCursor;
  } while (cursor);

  // Sort alphabetically by name
  allTools.sort((a, b) => a.name.localeCompare(b.name));

  return allTools;
}

/** Get full schema for a specific tool by name */
export async function getToolSchema(
  client: Client,
  toolName: string,
  serviceName?: string,
): Promise<SchemaOutput | null> {
  const response = await client.listTools();
  const tool = response.tools.find((t) => t.name === toolName);

  if (!tool) return null;

  return {
    tool: tool.name,
    description: tool.description ?? "(no description)",
    inputSchema: tool.inputSchema,
    annotations: tool.annotations as object | undefined,
    usage: generateUsageExample(
      serviceName ?? "service",
      tool.name,
      tool.inputSchema,
    ),
  };
}

/** Type for JSON Schema properties we care about */
interface SchemaProperties {
  type?: string;
  properties?: Record<string, { type?: string }>;
  required?: string[];
}

/** Generate a usage example from tool schema */
export function generateUsageExample(
  serviceName: string,
  toolName: string,
  schema: object,
): string {
  const s = schema as SchemaProperties;
  const required = s.required ?? [];
  const properties = s.properties ?? {};

  if (required.length === 0) {
    return `mcp2cli ${serviceName} ${toolName}`;
  }

  // Build placeholder params from required fields
  const params: Record<string, unknown> = {};
  for (const key of required) {
    const prop = properties[key];
    const propType = prop?.type ?? "string";
    switch (propType) {
      case "string":
        params[key] = "value";
        break;
      case "number":
      case "integer":
        params[key] = 1;
        break;
      case "boolean":
        params[key] = true;
        break;
      case "array":
        params[key] = [];
        break;
      case "object":
        params[key] = {};
        break;
      default:
        params[key] = "value";
    }
  }

  return `mcp2cli ${serviceName} ${toolName} --params '${JSON.stringify(params)}'`;
}
