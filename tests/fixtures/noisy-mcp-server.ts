#!/usr/bin/env bun
/**
 * Mock MCP server that emits stdout noise before JSON-RPC handling.
 * Used to test that the stdout filter correctly discards non-protocol output.
 */

// Emit noise lines before any protocol handling
process.stdout.write("npm warn using --force\n");
process.stdout.write(
  "(node:12345) ExperimentalWarning: something experimental\n",
);
process.stdout.write("\n");

// Now handle MCP protocol identically to mock-mcp-server
let buffer = "";

const decoder = new TextDecoder();

for await (const chunk of Bun.stdin.stream()) {
  buffer += decoder.decode(chunk, { stream: true });

  let newlineIndex: number;
  while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
    const line = buffer.slice(0, newlineIndex).trim();
    buffer = buffer.slice(newlineIndex + 1);

    if (line.length === 0) continue;

    try {
      const msg = JSON.parse(line);
      handleMessage(msg);
    } catch {
      // Ignore non-JSON lines
    }
  }
}

function handleMessage(msg: { jsonrpc: string; id?: number; method?: string }) {
  if (msg.id === undefined) return;

  switch (msg.method) {
    case "initialize":
      respond(msg.id, {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "noisy-mcp-server", version: "1.0.0" },
      });
      break;

    case "tools/list":
      respond(msg.id, { tools: [] });
      break;

    case "tools/call":
      respond(msg.id, {
        content: [{ type: "text", text: "noisy mock result" }],
      });
      break;

    default:
      respondError(msg.id, -32601, `Method not found: ${msg.method}`);
  }
}

function respond(id: number, result: unknown) {
  const response = JSON.stringify({ jsonrpc: "2.0", id, result });
  process.stdout.write(response + "\n");
}

function respondError(id: number, code: number, message: string) {
  const response = JSON.stringify({
    jsonrpc: "2.0",
    id,
    error: { code, message },
  });
  process.stdout.write(response + "\n");
}
