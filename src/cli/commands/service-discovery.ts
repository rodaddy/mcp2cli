import type { ServiceConfig } from "../../config/index.ts";
import { connectToService } from "../../connection/client.ts";
import { connectToHttpService } from "../../connection/http-transport.ts";
import { connectToWebSocketService } from "../../connection/websocket-transport.ts";
import { hashToolSchema } from "../../cache/index.ts";
import type { CachedToolSchema } from "../../cache/index.ts";
import { listAllTools } from "../../schema/introspect.ts";
import type { SchemaOutput, ToolSummary } from "../../schema/types.ts";
import { listToolsViaDaemon, getSchemaViaDaemon } from "./daemon-schema-client.ts";
import { resolveDirectServiceConfig } from "./direct-service.ts";

export interface ServiceDiscoveryResult {
  tools: ToolSummary[];
  schemas: SchemaOutput[];
  cachedSchemas: CachedToolSchema[];
}

export async function discoverServiceSchemas(
  serviceName: string,
  service: ServiceConfig,
  options: { fresh?: boolean } = {},
): Promise<ServiceDiscoveryResult> {
  if (!process.env.MCP2CLI_NO_DAEMON) {
    return discoverServiceSchemasViaDaemon(serviceName, options);
  }

  return discoverServiceSchemasDirect(serviceName, service);
}

async function discoverServiceSchemasViaDaemon(
  serviceName: string,
  options: { fresh?: boolean },
): Promise<ServiceDiscoveryResult> {
  const listResult = await listToolsViaDaemon({ service: serviceName, fresh: options.fresh });
  if (!listResult.success) {
    throw new Error(listResult.error.message);
  }

  const tools = listResult.result as ToolSummary[];
  const schemas: SchemaOutput[] = [];
  const cachedSchemas: CachedToolSchema[] = [];

  for (const tool of tools) {
    const schemaResult = await getSchemaViaDaemon({
      service: serviceName,
      tool: tool.name,
      fresh: options.fresh,
    });
    if (!schemaResult.success) {
      throw new Error(schemaResult.error.message);
    }

    const schema = schemaResult.result as SchemaOutput;
    schemas.push(schema);
    cachedSchemas.push(await schemaToCachedTool(schema));
  }

  return { tools, schemas, cachedSchemas };
}

async function discoverServiceSchemasDirect(
  serviceName: string,
  service: ServiceConfig,
): Promise<ServiceDiscoveryResult> {
  const directService = await resolveDirectServiceConfig(serviceName, service);
  const connection = directService.backend === "http"
    ? await connectToHttpService(directService)
    : directService.backend === "websocket"
      ? await connectToWebSocketService(directService)
      : await connectToService(directService);

  try {
    const rawTools = await listAllTools(connection.client);
    const tools = rawTools
      .map((tool) => ({
        name: tool.name,
        description: tool.description ?? "(no description)",
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const schemas: SchemaOutput[] = rawTools.map((tool) => ({
      tool: tool.name,
      description: tool.description ?? "(no description)",
      inputSchema: tool.inputSchema,
      annotations: tool.annotations as object | undefined,
      usage: `mcp2cli ${serviceName} ${tool.name}`,
    }));
    const cachedSchemas = await Promise.all(schemas.map(schemaToCachedTool));
    return { tools, schemas, cachedSchemas };
  } finally {
    await connection.close();
  }
}

async function schemaToCachedTool(schema: SchemaOutput): Promise<CachedToolSchema> {
  return {
    name: schema.tool,
    description: schema.description,
    inputSchema: schema.inputSchema,
    annotations: schema.annotations,
    hash: await hashToolSchema({
      name: schema.tool,
      description: schema.description,
      inputSchema: schema.inputSchema,
      annotations: schema.annotations,
    }),
  };
}
