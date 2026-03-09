#!/usr/bin/env bun
/**
 * Minimal mock MCP server for testing.
 * Reads JSON-RPC messages from stdin, responds to initialize/tools/list/tools/call.
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

function handleMessage(msg: { jsonrpc: string; id?: number; method?: string }) {
  // Notifications have no id -- no response needed
  if (msg.id === undefined) return;

  switch (msg.method) {
    case "initialize":
      respond(msg.id, {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "mock-mcp-server", version: "1.0.0" },
      });
      break;

    case "tools/list":
      respond(msg.id, {
        tools: [
          {
            name: "json_tool",
            description: "Returns a JSON object with status and data fields",
            inputSchema: {
              type: "object",
              properties: {
                filter: {
                  type: "string",
                  description: "Optional filter expression",
                },
                limit: {
                  type: "number",
                  description: "Maximum results to return",
                },
              },
              required: [],
            },
            annotations: { readOnlyHint: true },
          },
          {
            name: "error_tool",
            description: "Always returns an error (for testing)",
            inputSchema: {
              type: "object",
              properties: {},
              required: [],
            },
            annotations: { destructiveHint: false },
          },
          {
            name: "create_item",
            description: "Create a new item with the given name and type",
            inputSchema: {
              type: "object",
              properties: {
                name: {
                  type: "string",
                  description: "Item name (required)",
                },
                type: {
                  type: "string",
                  description: "Item type",
                  enum: ["widget", "gadget", "doohickey"],
                },
                tags: {
                  type: "array",
                  description: "Optional tags",
                  items: { type: "string" },
                },
              },
              required: ["name"],
            },
            annotations: { destructiveHint: false, idempotentHint: false },
          },
        ],
      });
      break;

    case "tools/call": {
      const toolName = (msg as { params?: { name?: string } }).params?.name;
      if (toolName === "error_tool") {
        respond(msg.id, {
          content: [{ type: "text", text: "Tool execution failed: invalid parameters" }],
          isError: true,
        });
      } else if (toolName === "json_tool") {
        respond(msg.id, {
          content: [{ type: "text", text: JSON.stringify({ status: "ok", data: [{ id: "1", name: "test" }] }) }],
        });
      } else {
        respond(msg.id, {
          content: [{ type: "text", text: JSON.stringify({ status: "ok", data: [] }) }],
        });
      }
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
