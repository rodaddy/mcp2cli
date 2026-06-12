/**
 * Handle `mcp2cli <service> --help` -- list available tools for a service.
 * Routes through daemon by default. Set MCP2CLI_NO_DAEMON=1 for direct connection.
 */
import { ConfigError, loadConfig } from "../../config/index.ts";
import { connectToService } from "../../connection/index.ts";
import { connectToHttpService } from "../../connection/http-transport.ts";
import { connectToWebSocketService } from "../../connection/websocket-transport.ts";
import { listToolsViaDaemon } from "../../process/index.ts";
import { listToolsCached, formatToolListing } from "../../schema/index.ts";
import type { ToolListing, ToolSummary } from "../../schema/index.ts";
import { filterTools, extractPolicy } from "../../access/index.ts";
import { isAiMode } from "../help.ts";
import { printError } from "../errors.ts";
import { EXIT_CODES } from "../../types/index.ts";
import { resolveDirectServiceConfig } from "./direct-service.ts";
import { shouldRouteMissingServiceToRemote } from "./remote-routing.ts";

export async function handleServiceHelp(
  serviceName: string,
  args: string[],
): Promise<void> {
  // Load config and resolve service
  const daemonEnabled = !process.env.MCP2CLI_NO_DAEMON;
  let config: Awaited<ReturnType<typeof loadConfig>> | null = null;
  try {
    config = await loadConfig();
  } catch (err) {
    if (!(err instanceof ConfigError) || err.code !== "CONFIG_NOT_FOUND" || !daemonEnabled) {
      throw err;
    }
  }
  const service = config?.services[serviceName];

  if (!service) {
    if (await shouldRouteMissingServiceToRemote(serviceName, daemonEnabled)) {
      const result = await listToolsViaDaemon({ service: serviceName });

      if (result.success) {
        const listing: ToolListing = {
          service: serviceName,
          description: "(remote only)",
          tools: result.result as ToolSummary[],
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

    printError({
      error: true,
      code: "UNKNOWN_COMMAND",
      message: `Unknown service: "${serviceName}". Run 'mcp2cli services' to list available services.`,
    });
    process.exitCode = EXIT_CODES.VALIDATION;
    return;
  }

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
  const directService = await resolveDirectServiceConfig(serviceName, service);
  const connection = directService.backend === "http"
    ? await connectToHttpService(directService)
    : directService.backend === "websocket"
      ? await connectToWebSocketService(directService)
      : await connectToService(directService);

  try {
    const allTools = await listToolsCached(connection.client, serviceName);
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
