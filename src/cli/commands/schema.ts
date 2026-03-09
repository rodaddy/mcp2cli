/**
 * Handle `mcp2cli schema <service>.<tool>` -- get full input schema for a tool.
 * Routes through daemon by default. Set MCP2CLI_NO_DAEMON=1 for direct connection.
 * ADV-01: Checks cache first, falls back to live fetch, caches result.
 * Supports --fresh flag to bypass cache for one call.
 */
import { loadConfig } from "../../config/index.ts";
import { connectToService, connectToHttpService, connectToWebSocketService } from "../../connection/index.ts";
import { getSchemaViaDaemon } from "../../process/index.ts";
import {
  parseDotNotation,
  getToolSchema,
  formatSchemaOutput,
} from "../../schema/index.ts";
import type { SchemaOutput } from "../../schema/index.ts";
import { readCache, writeCache, hashToolSchema } from "../../cache/index.ts";
import type { CachedToolSchema } from "../../cache/index.ts";
import { checkToolAccess, extractPolicy } from "../../access/index.ts";
import { validateIdentifier } from "../../validation/pipelines.ts";
import { printError } from "../errors.ts";
import { EXIT_CODES } from "../../types/index.ts";
import type { CommandHandler } from "../../types/index.ts";

export const handleSchema: CommandHandler = async (args: string[]) => {
  // Extract --fresh flag before parsing positional args
  const fresh = args.includes("--fresh");
  const positionalArgs = args.filter((a) => a !== "--fresh");
  const target = positionalArgs[0];

  // No argument or empty string
  if (!target) {
    printError({
      error: true,
      code: "UNKNOWN_COMMAND",
      message:
        "Usage: mcp2cli schema <service>.<tool> [--fresh]",
    });
    process.exitCode = EXIT_CODES.VALIDATION;
    return;
  }

  // Parse dot notation
  const parsed = parseDotNotation(target);
  if (!parsed.ok) {
    printError({
      error: true,
      code: "UNKNOWN_COMMAND",
      message: parsed.error,
    });
    process.exitCode = EXIT_CODES.VALIDATION;
    return;
  }

  const { service: serviceName, tool: toolName } = parsed.value;

  // Validate identifiers before any config/cache lookup
  const svcCheck = validateIdentifier(serviceName, "service");
  if (!svcCheck.valid) {
    printError({ error: true, code: "INPUT_VALIDATION_ERROR", message: svcCheck.message });
    process.exitCode = EXIT_CODES.VALIDATION;
    return;
  }
  const toolCheck = validateIdentifier(toolName, "tool");
  if (!toolCheck.valid) {
    printError({ error: true, code: "INPUT_VALIDATION_ERROR", message: toolCheck.message });
    process.exitCode = EXIT_CODES.VALIDATION;
    return;
  }

  // Load config and resolve service
  const config = await loadConfig();
  const service = config.services[serviceName];

  if (!service) {
    printError({
      error: true,
      code: "UNKNOWN_COMMAND",
      message: `Unknown service: "${serviceName}". Run 'mcp2cli services' to list available services.`,
    });
    process.exitCode = EXIT_CODES.VALIDATION;
    return;
  }

  // Access control: check if tool is blocked by policy
  const policy = extractPolicy(service);
  const accessResult = checkToolAccess(toolName, policy);
  if (!accessResult.allowed) {
    printError({
      error: true,
      code: "TOOL_BLOCKED",
      message: `Tool '${toolName}' is blocked by access policy for service '${serviceName}'`,
    });
    process.exitCode = EXIT_CODES.VALIDATION;
    return;
  }

  // ADV-01: Check cache first (unless --fresh)
  if (!fresh) {
    const cached = await readCache(serviceName);
    if (cached) {
      const cachedTool = cached.tools.find((t) => t.name === toolName);
      if (cachedTool) {
        const output: SchemaOutput = {
          tool: cachedTool.name,
          description: cachedTool.description,
          inputSchema: cachedTool.inputSchema,
          annotations: cachedTool.annotations,
          usage: `mcp2cli ${serviceName} ${cachedTool.name}`,
        };
        console.log(formatSchemaOutput(output));
        process.exitCode = EXIT_CODES.SUCCESS;
        return;
      }
      // Tool not in cache -- fall through to live fetch
    }
  }

  const daemonEnabled = !process.env.MCP2CLI_NO_DAEMON;

  if (daemonEnabled) {
    // Daemon path: get full SchemaOutput via daemon's /schema endpoint
    const result = await getSchemaViaDaemon({ service: serviceName, tool: toolName });

    if (result.success) {
      const schemaOutput = result.result as SchemaOutput;
      console.log(formatSchemaOutput(schemaOutput));
      // Cache the result from daemon
      await cacheSchemaResult(serviceName, schemaOutput);
      process.exitCode = EXIT_CODES.SUCCESS;
    } else {
      printError({
        error: true,
        code: result.error.code,
        message: result.error.message,
        ...(result.error.reason ? { reason: result.error.reason } : {}),
      });
      process.exitCode = EXIT_CODES.VALIDATION;
    }
    return;
  }

  // Direct path (MCP2CLI_NO_DAEMON=1): legacy direct connection

  // Connect and get schema (stdio, http, or websocket)
  const connection = service.backend === "http"
    ? await connectToHttpService(service)
    : service.backend === "websocket"
      ? await connectToWebSocketService(service)
      : await connectToService(service);

  try {
    const result = await getToolSchema(connection.client, toolName, serviceName);

    if (!result) {
      printError({
        error: true,
        code: "UNKNOWN_COMMAND",
        message: `Unknown tool "${toolName}" for service "${serviceName}". Run 'mcp2cli ${serviceName} --help' to list available tools.`,
      });
      process.exitCode = EXIT_CODES.VALIDATION;
    } else {
      console.log(formatSchemaOutput(result));
      // Cache the result from direct connection
      await cacheSchemaResult(serviceName, result);
      process.exitCode = EXIT_CODES.SUCCESS;
    }
  } finally {
    await connection.close();
  }
};

/**
 * Cache a single tool schema result.
 * Merges into existing cache for the service (upsert by tool name).
 */
async function cacheSchemaResult(
  serviceName: string,
  schema: SchemaOutput,
): Promise<void> {
  try {
    // Read existing cache to merge
    const { readCacheRaw } = await import("../../cache/index.ts");
    const existing = await readCacheRaw(serviceName);
    const existingTools = existing?.tools ?? [];

    const hash = await hashToolSchema({
      name: schema.tool,
      description: schema.description,
      inputSchema: schema.inputSchema,
      annotations: schema.annotations,
    });

    const newTool: CachedToolSchema = {
      name: schema.tool,
      description: schema.description,
      inputSchema: schema.inputSchema,
      annotations: schema.annotations,
      hash,
    };

    // Replace existing entry or append
    const toolIndex = existingTools.findIndex((t) => t.name === schema.tool);
    if (toolIndex >= 0) {
      existingTools[toolIndex] = newTool;
    } else {
      existingTools.push(newTool);
    }

    await writeCache(serviceName, existingTools);
  } catch {
    // Cache write failure is non-fatal -- log and continue
  }
}
