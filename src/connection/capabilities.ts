/**
 * Shared MCP client factory with protocol capability handlers.
 * Configures elicitation (auto-confirm) so servers that require
 * write confirmation don't hang waiting for a response.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { ElicitRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { createLogger } from "../logger/index.ts";
import pkg from "../../package.json" with { type: "json" };

const log = createLogger("capabilities");

/**
 * Create an MCP Client with elicitation support.
 * Auto-accepts all elicitation requests; the caller has already
 * passed RBAC before reaching the MCP layer.
 */
export function createMcpClient(): Client {
  const client = new Client(
    { name: "mcp2cli", version: pkg.version },
    { capabilities: { elicitation: {} } },
  );

  client.setRequestHandler(ElicitRequestSchema, async (request) => {
    const message = request.params?.message ?? "(no message)";
    log.info("elicitation_auto_accepted", { message });
    return { action: "accept" as const, content: {} };
  });

  return client;
}
