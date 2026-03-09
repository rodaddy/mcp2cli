import { describe, it, expect, afterEach } from "bun:test";
import { McpTransport } from "../../src/connection/transport.ts";
import { ConnectionError } from "../../src/connection/errors.ts";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { resolve } from "path";

const MOCK_SERVER = resolve(import.meta.dir, "../fixtures/mock-mcp-server.ts");
const NOISY_SERVER = resolve(import.meta.dir, "../fixtures/noisy-mcp-server.ts");

/**
 * Helper: create a transport pointing at a mock server script.
 */
function createTransport(script: string) {
  return new McpTransport({
    command: "bun",
    args: [script],
    env: {},
  });
}

/**
 * Helper: create an initialize request message.
 */
function initializeRequest(id: number): JSONRPCMessage {
  return {
    jsonrpc: "2.0",
    id,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "test-client", version: "0.0.1" },
    },
  } as unknown as JSONRPCMessage;
}

describe("McpTransport", () => {
  let transport: McpTransport | null = null;

  afterEach(async () => {
    if (transport) {
      try {
        await transport.close();
      } catch {
        // Already closed
      }
      transport = null;
    }
  });

  it("starts and spawns process", async () => {
    transport = createTransport(MOCK_SERVER);

    let closeCalled = false;
    transport.onclose = () => {
      closeCalled = true;
    };

    await transport.start();

    // Process is running -- onclose should not have fired yet
    // Give a tiny moment for potential immediate failures
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(closeCalled).toBe(false);
  }, 10_000);

  it("sends message to process stdin and receives response", async () => {
    transport = createTransport(MOCK_SERVER);

    const messages: JSONRPCMessage[] = [];
    transport.onmessage = (msg: JSONRPCMessage) => {
      messages.push(msg);
    };

    await transport.start();
    await transport.send(initializeRequest(1));

    // Wait for response
    await new Promise<void>((resolve) => {
      const check = () => {
        if (messages.length > 0) return resolve();
        setTimeout(check, 50);
      };
      check();
    });

    const response = messages[0] as Record<string, unknown>;
    expect(response).toBeDefined();
    const result = response.result as Record<string, unknown>;
    expect(result.protocolVersion).toBe("2024-11-05");
  }, 10_000);

  it("receives and parses JSON-RPC messages correctly", async () => {
    transport = createTransport(MOCK_SERVER);

    const messages: JSONRPCMessage[] = [];
    transport.onmessage = (msg: JSONRPCMessage) => {
      messages.push(msg);
    };

    await transport.start();
    await transport.send(initializeRequest(42));

    await new Promise<void>((resolve) => {
      const check = () => {
        if (messages.length > 0) return resolve();
        setTimeout(check, 50);
      };
      check();
    });

    const response = messages[0] as Record<string, unknown>;
    expect(response.jsonrpc).toBe("2.0");
    expect(response.id).toBe(42);
  }, 10_000);

  it("filters non-JSON-RPC stdout noise", async () => {
    transport = createTransport(NOISY_SERVER);

    const messages: JSONRPCMessage[] = [];
    transport.onmessage = (msg: JSONRPCMessage) => {
      messages.push(msg);
    };

    await transport.start();
    await transport.send(initializeRequest(1));

    // Wait for the response
    await new Promise<void>((resolve) => {
      const check = () => {
        if (messages.length > 0) return resolve();
        setTimeout(check, 50);
      };
      check();
    });

    // Only valid JSON-RPC messages should have come through
    for (const msg of messages) {
      const raw = msg as Record<string, unknown>;
      expect(raw.jsonrpc).toBe("2.0");
    }

    // No noise lines (npm warn, ExperimentalWarning, blank) should appear
    const asStrings = messages.map((m) => JSON.stringify(m));
    for (const s of asStrings) {
      expect(s).not.toContain("npm warn");
      expect(s).not.toContain("ExperimentalWarning");
    }
  }, 10_000);

  it("close() shuts down process gracefully", async () => {
    transport = createTransport(MOCK_SERVER);

    let closeCalled = false;
    transport.onclose = () => {
      closeCalled = true;
    };

    await transport.start();
    await transport.send(initializeRequest(1));

    // Wait a bit for server to be running
    await new Promise((resolve) => setTimeout(resolve, 200));

    await transport.close();
    expect(closeCalled).toBe(true);

    // Prevent double-close in afterEach
    transport = null;
  }, 10_000);

  it("throws ConnectionError on spawn failure", async () => {
    transport = new McpTransport({
      command: "/nonexistent/binary/that-does-not-exist",
      args: [],
      env: {},
    });

    try {
      await transport.start();
      // Should not reach here
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(ConnectionError);
      const connErr = err as ConnectionError;
      expect(connErr.message).toContain("spawn");
      expect(connErr.code).toBe("CONNECTION_ERROR");
    }
  }, 10_000);
});
