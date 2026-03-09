import { describe, test, expect } from "bun:test";
import {
  WebSocketServiceSchema,
  ServiceSchema,
  ServicesConfigSchema,
} from "../../src/config/schema.ts";

describe("WebSocketService config validation", () => {
  test("valid WebSocket service with url only", () => {
    const result = WebSocketServiceSchema.safeParse({
      backend: "websocket",
      url: "ws://mcp-gateway.local:3000/mcp",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.backend).toBe("websocket");
      expect(result.data.url).toBe("ws://mcp-gateway.local:3000/mcp");
      expect(result.data.headers).toEqual({});
    }
  });

  test("valid WebSocket service with headers", () => {
    const result = WebSocketServiceSchema.safeParse({
      backend: "websocket",
      url: "wss://mcp-gateway.local:3000/mcp",
      headers: { Authorization: "Bearer tok_123" },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.headers).toEqual({ Authorization: "Bearer tok_123" });
    }
  });

  test("valid WebSocket service with description and fallback", () => {
    const result = WebSocketServiceSchema.safeParse({
      backend: "websocket",
      url: "ws://localhost:3000/mcp",
      description: "Remote MCP via WebSocket",
      fallback: {
        command: "npx",
        args: ["-y", "@anthropic/n8n-mcp"],
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.description).toBe("Remote MCP via WebSocket");
      expect(result.data.fallback).toBeDefined();
      expect(result.data.fallback!.command).toBe("npx");
    }
  });

  test("missing url fails", () => {
    const result = WebSocketServiceSchema.safeParse({
      backend: "websocket",
    });
    expect(result.success).toBe(false);
  });

  test("invalid url fails", () => {
    const result = WebSocketServiceSchema.safeParse({
      backend: "websocket",
      url: "not-a-valid-url",
    });
    expect(result.success).toBe(false);
  });

  test("empty string url fails", () => {
    const result = WebSocketServiceSchema.safeParse({
      backend: "websocket",
      url: "",
    });
    expect(result.success).toBe(false);
  });

  test("access control fields are accepted", () => {
    const result = WebSocketServiceSchema.safeParse({
      backend: "websocket",
      url: "ws://localhost:3000/mcp",
      allowTools: ["tool_*"],
      blockTools: ["tool_delete_*"],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.allowTools).toEqual(["tool_*"]);
      expect(result.data.blockTools).toEqual(["tool_delete_*"]);
    }
  });
});

describe("ServiceSchema accepts websocket backend", () => {
  test("websocket service via discriminated union", () => {
    const result = ServiceSchema.safeParse({
      backend: "websocket",
      url: "ws://localhost:3000/mcp",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.backend).toBe("websocket");
    }
  });
});

describe("ServicesConfig with websocket backend", () => {
  test("config with stdio + http + websocket services", () => {
    const result = ServicesConfigSchema.safeParse({
      services: {
        n8n: {
          backend: "stdio",
          command: "npx",
          args: ["-y", "n8n-mcp"],
        },
        vault: {
          backend: "http",
          url: "http://10.71.20.14:3001/mcp",
        },
        remote: {
          backend: "websocket",
          url: "ws://mcp-gateway.local:3000/mcp",
        },
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(Object.keys(result.data.services)).toHaveLength(3);
      const remote = result.data.services.remote;
      expect(remote).toBeDefined();
      expect(remote!.backend).toBe("websocket");
      if (remote!.backend === "websocket") {
        expect(remote!.url).toBe("ws://mcp-gateway.local:3000/mcp");
      }
    }
  });

  test("websocket-only config is valid", () => {
    const result = ServicesConfigSchema.safeParse({
      services: {
        remote: {
          backend: "websocket",
          url: "ws://localhost:3000/mcp",
        },
      },
    });
    expect(result.success).toBe(true);
  });
});

describe("WebSocket transport module imports", () => {
  test("connectToWebSocketService is exported from connection index", async () => {
    const mod = await import("../../src/connection/index.ts");
    expect(typeof mod.connectToWebSocketService).toBe("function");
  });

  test("connectToWebSocketService function exists in websocket-transport module", async () => {
    const mod = await import("../../src/connection/websocket-transport.ts");
    expect(typeof mod.connectToWebSocketService).toBe("function");
  });
});

describe("WebSocket config type export", () => {
  test("WebSocketServiceSchema is exported from config index", async () => {
    const mod = await import("../../src/config/index.ts");
    expect(mod.WebSocketServiceSchema).toBeDefined();
  });
});
