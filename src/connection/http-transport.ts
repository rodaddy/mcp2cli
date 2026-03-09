/**
 * HTTP/SSE transport for connecting to remote MCP servers.
 * Tries StreamableHTTPClientTransport first (modern, spec 2025-03-26),
 * falls back to SSEClientTransport (deprecated, spec 2024-11-05).
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { ConnectionError } from "./errors.ts";
import type { McpConnection } from "./types.ts";
import type { HttpService } from "../config/schema.ts";
import { createLogger } from "../logger/index.ts";
import pkg from "../../package.json" with { type: "json" };

const log = createLogger("http-transport");

/**
 * Connect to an MCP server via HTTP transport.
 * Tries StreamableHTTP first, falls back to SSE if the server
 * doesn't support the modern protocol (4xx response).
 */
export async function connectToHttpService(
  service: HttpService,
  options?: { timeout?: number },
): Promise<McpConnection> {
  const timeout = options?.timeout ?? 30000;
  const url = new URL(service.url);

  const requestInit: RequestInit | undefined =
    Object.keys(service.headers).length > 0
      ? { headers: service.headers }
      : undefined;

  // Step 1: Try StreamableHTTPClientTransport (modern)
  try {
    log.info("trying_streamable_http", { url: service.url });
    const streamableTransport = new StreamableHTTPClientTransport(url, {
      requestInit,
    });
    const client = new Client({ name: "mcp2cli", version: pkg.version });

    await Promise.race([
      client.connect(streamableTransport),
      rejectAfter(timeout, service.url),
    ]);

    log.info("connected_streamable_http", { url: service.url });
    return {
      client,
      close: async () => {
        await client.close();
      },
    };
  } catch (err) {
    // If it's a timeout, don't fall back -- the server is unreachable
    if (err instanceof ConnectionError && err.message.includes("timed out")) {
      log.warn("timeout", { url: service.url, timeout });
      throw err;
    }
    log.info("streamable_http_failed_trying_sse", {
      url: service.url,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Step 2: Fall back to SSEClientTransport (deprecated but widely supported)
  try {
    log.info("trying_sse", { url: service.url });
    const sseTransport = new SSEClientTransport(url, {
      requestInit,
    });

    const client = new Client({ name: "mcp2cli", version: pkg.version });

    await Promise.race([
      client.connect(sseTransport),
      rejectAfter(timeout, service.url),
    ]);

    log.info("connected_sse", { url: service.url });
    return {
      client,
      close: async () => {
        await client.close();
      },
    };
  } catch (err) {
    if (err instanceof ConnectionError) {
      throw err;
    }
    const message = err instanceof Error ? err.message : String(err);
    log.error("connect_failed", { url: service.url, error: message });
    throw new ConnectionError(
      `Failed to connect to HTTP MCP server: ${message}`,
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
            `Connection timed out after ${ms}ms`,
            `url: ${url}`,
          ),
        ),
      ms,
    ),
  );
}
