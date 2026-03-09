/**
 * Handle `mcp2cli <service> --help` -- list available tools for a service.
 * Routes through daemon by default. Set MCP2CLI_NO_DAEMON=1 for direct connection.
 */
import { loadConfig } from "../../config/index.ts";
import { connectToService, connectToHttpService, connectToWebSocketService } from "../../connection/index.ts";
import { listToolsViaDaemon } from "../../process/index.ts";
import { listToolsForService, formatToolListing } from "../../schema/index.ts";
import type { ToolListing, ToolSummary } from "../../schema/index.ts";
import { filterTools, extractPolicy } from "../../access/index.ts";
import { isAiMode } from "../help.ts";
import { printError } from "../errors.ts";
import { EXIT_CODES } from "../../types/index.ts";

export async function handleServiceHelp(
  serviceName: string,
  args: string[],
): Promise<void> {
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
    // Daemon path: route through persistent daemon process
    const result = await listToolsViaDaemon({ service: serviceName });

    if (result.success) {
      const allTools = result.result as ToolSummary[];
      const policy = extractPolicy(service);
      const tools = filterTools(allTools, policy);
      const listing: ToolListing = {
        service: serviceName,
        description: service.description ?? "(no description)",
        tools,
        usage: `mcp2cli ${serviceName} <tool> [--params '{}']`,
      };

      const aiMode = isAiMode(args);
      console.log(formatToolListing(listing, aiMode));
      process.exitCode = EXIT_CODES.SUCCESS;
    } else {
      printError({
        error: true,
        code: result.error.code,
        message: result.error.message,
        ...(result.error.reason ? { reason: result.error.reason } : {}),
      });
      process.exitCode = EXIT_CODES.CONNECTION;
    }
    return;
  }

  // Direct path (MCP2CLI_NO_DAEMON=1): legacy direct connection

  // Connect and introspect (stdio, http, or websocket)
  const connection = service.backend === "http"
    ? await connectToHttpService(service)
    : service.backend === "websocket"
      ? await connectToWebSocketService(service)
      : await connectToService(service);

  try {
    const allTools = await listToolsForService(connection.client);
    const policy = extractPolicy(service);
    const tools = filterTools(allTools, policy);

    const listing: ToolListing = {
      service: serviceName,
      description: service.description ?? "(no description)",
      tools,
      usage: `mcp2cli ${serviceName} <tool> [--params '{}']`,
    };

    const aiMode = isAiMode(args);
    console.log(formatToolListing(listing, aiMode));
    process.exitCode = EXIT_CODES.SUCCESS;
  } finally {
    await connection.close();
  }
}
