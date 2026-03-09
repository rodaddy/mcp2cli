/**
 * Handle `mcp2cli schema <service>.<tool>` -- get full input schema for a tool.
 * Routes through daemon by default. Set MCP2CLI_NO_DAEMON=1 for direct connection.
 */
import { loadConfig } from "../../config/index.ts";
import { connectToService, connectToHttpService } from "../../connection/index.ts";
import { getSchemaViaDaemon } from "../../process/index.ts";
import {
  parseDotNotation,
  getToolSchema,
  formatSchemaOutput,
} from "../../schema/index.ts";
import type { SchemaOutput } from "../../schema/index.ts";
import { printError } from "../errors.ts";
import { EXIT_CODES } from "../../types/index.ts";
import type { CommandHandler } from "../../types/index.ts";

export const handleSchema: CommandHandler = async (args: string[]) => {
  const target = args[0];

  // No argument or empty string
  if (!target) {
    printError({
      error: true,
      code: "UNKNOWN_COMMAND",
      message:
        "Usage: mcp2cli schema <service>.<tool>",
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

  const daemonEnabled = !process.env.MCP2CLI_NO_DAEMON;

  if (daemonEnabled) {
    // Daemon path: get full SchemaOutput via daemon's /schema endpoint
    const result = await getSchemaViaDaemon({ service: serviceName, tool: toolName });

    if (result.success) {
      console.log(formatSchemaOutput(result.result as SchemaOutput));
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

  // Connect and get schema (stdio or http)
  const connection = service.backend === "http"
    ? await connectToHttpService(service)
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
      process.exitCode = EXIT_CODES.SUCCESS;
    }
  } finally {
    await connection.close();
  }
};
