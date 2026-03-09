import { describe, it, expect, afterEach } from "bun:test";
import { McpTransport } from "../../src/connection/transport.ts";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { resolve } from "path";

const MOCK_SERVER = resolve(import.meta.dir, "../fixtures/mock-mcp-server.ts");

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

/**
 * Helper: wait for at least one message.
 */
function waitForMessage(messages: JSONRPCMessage[], timeoutMs = 5000): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const deadline = setTimeout(() => reject(new Error("Timed out waiting for message")), timeoutMs);
    const check = () => {
      if (messages.length > 0) {
        clearTimeout(deadline);
        return resolve();
      }
      setTimeout(check, 50);
    };
    check();
  });
}

describe("MEM-01: Reader cleanup on transport close", () => {
  let transport: McpTransport | null = null;

  afterEach(async () => {
    if (transport) {
      try { await transport.close(); } catch { /* already closed */ }
      transport = null;
    }
  });

  it("close() cancels active reader, readStdout exits without error", async () => {
    transport = createTransport(MOCK_SERVER);

    const errors: Error[] = [];
    transport.onerror = (err) => errors.push(err);

    const messages: JSONRPCMessage[] = [];
    transport.onmessage = (msg) => messages.push(msg);

    await transport.start();
    await transport.send(initializeRequest(1));
    await waitForMessage(messages);

    // Transport is actively reading stdout -- close should cancel the reader
    await transport.close();
    transport = null;

    // No unhandled errors should have been reported from readStdout
    const readErrors = errors.filter((e) => e.message.includes("stdout read error"));
    expect(readErrors).toHaveLength(0);
  }, 10_000);

  it("reader reference is null after close", async () => {
    transport = createTransport(MOCK_SERVER);
    await transport.start();
    await transport.send(initializeRequest(1));

    // Give readStdout time to acquire the reader
    await new Promise((r) => setTimeout(r, 200));

    await transport.close();

    // Access private field via any cast for verification
    const readerRef = (transport as unknown as { reader: unknown }).reader;
    expect(readerRef).toBeNull();
    transport = null;
  }, 10_000);

  it("after close + new transport, no previous readers remain active", async () => {
    // First transport
    transport = createTransport(MOCK_SERVER);
    const messages1: JSONRPCMessage[] = [];
    transport.onmessage = (msg) => messages1.push(msg);
    await transport.start();
    await transport.send(initializeRequest(1));
    await waitForMessage(messages1);
    await transport.close();
    transport = null;

    // Second transport
    transport = createTransport(MOCK_SERVER);
    const messages2: JSONRPCMessage[] = [];
    const errors2: Error[] = [];
    transport.onmessage = (msg) => messages2.push(msg);
    transport.onerror = (err) => errors2.push(err);
    await transport.start();
    await transport.send(initializeRequest(2));
    await waitForMessage(messages2);

    // Second transport works independently
    const response = messages2[0] as Record<string, unknown>;
    expect(response.id).toBe(2);
    expect(errors2).toHaveLength(0);
  }, 15_000);
});

describe("MEM-03: Fire-and-forget task cancellation", () => {
  let transport: McpTransport | null = null;

  afterEach(async () => {
    if (transport) {
      try { await transport.close(); } catch { /* already closed */ }
      transport = null;
    }
  });

  it("readStdout exits cleanly when transport closes (no unhandled rejections)", async () => {
    transport = createTransport(MOCK_SERVER);

    const errors: Error[] = [];
    transport.onerror = (err) => errors.push(err);

    let closeCalled = false;
    transport.onclose = () => { closeCalled = true; };

    await transport.start();
    await transport.send(initializeRequest(1));

    // Let the server start responding
    await new Promise((r) => setTimeout(r, 200));

    await transport.close();

    // onclose should fire from close(), not from monitorExit
    expect(closeCalled).toBe(true);

    // No spurious errors from readStdout or monitorExit during shutdown
    const spuriousErrors = errors.filter(
      (e) => e.message.includes("stdout read error") || e.message.includes("exited unexpectedly"),
    );
    expect(spuriousErrors).toHaveLength(0);

    transport = null;
  }, 10_000);

  it("monitorExit exits cleanly when transport closes", async () => {
    transport = createTransport(MOCK_SERVER);

    const errors: Error[] = [];
    transport.onerror = (err) => errors.push(err);

    await transport.start();
    await transport.send(initializeRequest(1));
    await new Promise((r) => setTimeout(r, 200));

    await transport.close();

    // Wait a bit for any deferred error callbacks
    await new Promise((r) => setTimeout(r, 500));

    // monitorExit should NOT report "exited unexpectedly" after close()
    const exitErrors = errors.filter((e) => e.message.includes("exited unexpectedly"));
    expect(exitErrors).toHaveLength(0);

    transport = null;
  }, 10_000);

  it("double close is safe", async () => {
    transport = createTransport(MOCK_SERVER);
    await transport.start();
    await transport.send(initializeRequest(1));
    await new Promise((r) => setTimeout(r, 200));

    // Close twice -- should not throw or double-fire onclose
    let closeCount = 0;
    transport.onclose = () => { closeCount++; };

    await transport.close();
    await transport.close();

    expect(closeCount).toBe(1);
    transport = null;
  }, 10_000);
});
