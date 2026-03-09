#!/usr/bin/env bun
/**
 * Slow mock MCP server for timeout testing.
 * Handles initialize/tools/list normally but delays tools/call responses.
 */

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

function handleMessage(msg: { jsonrpc: string; id?: number; method?: string; params?: Record<string, unknown> }) {
  if (msg.id === undefined) return;

  switch (msg.method) {
    case "initialize":
      respond(msg.id, {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "slow-mcp-server", version: "1.0.0" },
      });
      break;

    case "tools/list":
      respond(msg.id, {
        tools: [
          {
            name: "slow_tool",
            description: "A tool that takes a long time to respond",
            inputSchema: {
              type: "object",
              properties: {
                delay_ms: {
                  type: "number",
                  description: "How long to delay in milliseconds",
                },
              },
              required: [],
            },
          },
        ],
      });
      break;

    case "tools/call": {
      const params = (msg.params as { arguments?: { delay_ms?: number } })?.arguments;
      const delay = params?.delay_ms ?? 60000;
      // Delay the response
      setTimeout(() => {
        respond(msg.id!, {
          content: [{ type: "text", text: JSON.stringify({ status: "ok", delayed: delay }) }],
        });
      }, delay);
      break;
    }

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
