import type { Client } from "@modelcontextprotocol/sdk/client/index.js";

/** Options for establishing an MCP connection */
export interface ConnectionOptions {
  command: string;
  args: string[];
  env: Record<string, string>;
  /** Timeout for initialization handshake in ms (default: 30000) */
  timeout?: number;
}

/** A live MCP connection with cleanup */
export interface McpConnection {
  client: Client;
  close: () => Promise<void>;
}
