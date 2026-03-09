import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpTransport } from "./transport.ts";
import { ConnectionError } from "./errors.ts";
import type { ConnectionOptions, McpConnection } from "./types.ts";
import type { StdioService } from "../config/schema.ts";
import { createLogger } from "../logger/index.ts";
import pkg from "../../package.json" with { type: "json" };

const log = createLogger("connection");

/**
 * Connect to an MCP server via stdio transport.
 * Spawns the process, completes the initialization handshake, returns a live connection.
 * Enforces timeout -- server hang won't block indefinitely.
 */
export async function connectToService(
  service: StdioService,
  options?: { timeout?: number },
): Promise<McpConnection> {
  const timeout = options?.timeout ?? 30000;

  const connOpts: ConnectionOptions = {
    command: service.command,
    args: service.args,
    env: service.env,
    timeout,
  };

  const transport = new McpTransport(connOpts);
  const client = new Client({ name: "mcp2cli", version: pkg.version });

  const cmdLabel = `${service.command} ${service.args.join(" ")}`;

  try {
    // SDK's client.connect() calls transport.start(), sends initialize,
    // waits for response, sends initialized notification.
    // Race against timeout to prevent indefinite hangs.
    await Promise.race([
      client.connect(transport),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new ConnectionError(
            `Connection timed out after ${timeout}ms`,
            `command: ${service.command} ${service.args.join(" ")}`,
          )),
          timeout,
        ),
      ),
    ]);
  } catch (err) {
    // Ensure transport is cleaned up on failure
    try {
      await transport.close();
    } catch {
      // Best-effort cleanup
    }

    // Re-throw ConnectionError as-is, wrap anything else
    if (err instanceof ConnectionError) {
      if (err.message.includes("timed out")) {
        log.warn("timeout", { service: cmdLabel, timeout });
      } else {
        log.error("connect_failed", { service: cmdLabel, error: err.message });
      }
      throw err;
    }
    const message = err instanceof Error ? err.message : String(err);
    log.error("connect_failed", { service: cmdLabel, error: message });
    throw new ConnectionError(
      `Failed to connect to MCP server: ${message}`,
      `command: ${service.command} ${service.args.join(" ")}`,
    );
  }

  log.info("connected", { service: cmdLabel });

  return {
    client,
    close: async () => {
      await client.close(); // SDK calls transport.close() internally
    },
  };
}
