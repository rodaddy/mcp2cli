#!/usr/bin/env bun
/**
 * Mock MCP server that echoes back its own process environment and argv.
 * Used to prove that ${secret:...} refs in a stdio service's env/args are
 * resolved to their real values BEFORE the child is spawned.
 *
 * tools/call "echo_env" returns { env, argv } as JSON text content.
 */

export {}; // mark as a module so top-level `for await` is valid under strict TS (TS1431)

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
      handleMessage(JSON.parse(line));
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
        serverInfo: { name: "env-echo-mcp-server", version: "1.0.0" },
      });
      break;

    case "tools/list":
      respond(msg.id, {
        tools: [
          {
            name: "echo_env",
            description: "Echoes back the server's env and argv",
            inputSchema: { type: "object", properties: {}, required: [] },
            annotations: { readOnlyHint: true },
          },
        ],
      });
      break;

    case "tools/call":
      respond(msg.id, {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              env: process.env,
              argv: process.argv.slice(2),
            }),
          },
        ],
      });
      break;

    default:
      respondError(msg.id, -32601, `Method not found: ${msg.method}`);
  }
}

function respond(id: number, result: unknown) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
}

function respondError(id: number, code: number, message: string) {
  process.stdout.write(
    JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }) + "\n",
  );
}
