/**
 * WebSocket transport for connecting to remote MCP servers.
 * Uses the SDK's built-in WebSocketClientTransport.
 */
import { WebSocketClientTransport } from "@modelcontextprotocol/sdk/client/websocket.js";
import { ConnectionError } from "./errors.ts";
import { createMcpClient } from "./capabilities.ts";
import type { McpConnection } from "./types.ts";
import type { WebSocketService } from "../config/schema.ts";
import { createLogger } from "../logger/index.ts";

const log = createLogger("websocket-transport");

/**
 * Connect to an MCP server via WebSocket transport.
 * Wraps the SDK's WebSocketClientTransport with timeout and error handling.
 */
export async function connectToWebSocketService(
  service: WebSocketService,
  options?: { timeout?: number },
): Promise<McpConnection> {
  const timeout = options?.timeout ?? 30000;
  const url = new URL(service.url);

  try {
    log.info("connecting_websocket", { url: service.url });
    const transport = new WebSocketClientTransport(url);
    const client = createMcpClient();

    await Promise.race([
      client.connect(transport),
      rejectAfter(timeout, service.url),
    ]);

    log.info("connected_websocket", { url: service.url });
    return {
      client,
      close: async () => {
        await client.close();
      },
    };
  } catch (err) {
    if (err instanceof ConnectionError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    log.error("websocket_connect_failed", { url: service.url, error: message });
    throw new ConnectionError(
      `Failed to connect to WebSocket MCP server: ${message}`,
      `url: ${service.url}`,
    );
  }
}

/** Create a timeout rejection promise. */
function rejectAfter(ms: number, url: string): Promise<never> {
  return new Promise<never>((_, reject) =>
    setTimeout(
      () =>
        reject(
          new ConnectionError(
            `WebSocket connection timed out after ${ms}ms`,
            `url: ${url}`,
          ),
        ),
      ms,
    ),
  );
}
