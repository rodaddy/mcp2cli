import { describe, test, expect, afterEach } from "bun:test";
import { resolve } from "path";
import { setLogLevel, resetLogLevel } from "../../src/logger/index.ts";
import type { LogEntry } from "../../src/logger/types.ts";
import { McpTransport } from "../../src/connection/transport.ts";

const MOCK_SERVER = resolve(import.meta.dir, "../fixtures/mock-mcp-server.ts");

/**
 * Capture stderr output during an async callback.
 */
async function captureStderrAsync(fn: () => Promise<void>): Promise<string[]> {
  const captured: string[] = [];
  const original = process.stderr.write;
  process.stderr.write = (chunk: string | Uint8Array) => {
    captured.push(
      typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk),
    );
    return true;
  };
  try {
    await fn();
  } finally {
    process.stderr.write = original;
  }
  return captured;
}

/** Parse captured stderr lines into LogEntry objects, filtering nulls. */
function parseLogEntries(lines: string[]): LogEntry[] {
  return lines
    .map((l) => {
      try {
        return JSON.parse(l) as LogEntry;
      } catch {
        return null;
      }
    })
    .filter((e): e is LogEntry => e !== null);
}

describe("Connection Lifecycle Logging", () => {
  afterEach(() => {
    resetLogLevel();
  });

  test("transport close() logs disconnected entry", async () => {
    setLogLevel("info");

    const transport = new McpTransport({
      command: "bun",
      args: [MOCK_SERVER],
      env: {},
    });

    // Start and then close
    await transport.start();
    // Small delay to let process start
    await new Promise((resolve) => setTimeout(resolve, 200));

    const lines = await captureStderrAsync(async () => {
      await transport.close();
    });

    const entries = parseLogEntries(lines);
    const disconnected = entries.find(
      (e) => e.component === "transport" && e.message === "disconnected",
    );

    expect(disconnected).toBeDefined();
    expect(disconnected?.data?.command).toBe("bun");
  }, 15_000);

  test("successful connectToService logs connected entry", async () => {
    setLogLevel("info");

    // Import connectToService (uses real transport, real mock server)
    const { connectToService } = await import(
      "../../src/connection/client.ts"
    );

    let conn: Awaited<ReturnType<typeof connectToService>> | null = null;

    const lines = await captureStderrAsync(async () => {
      conn = await connectToService(
        {
          backend: "stdio" as const,
          command: "bun",
          args: [MOCK_SERVER],
          env: {},
        },
        { timeout: 10000 },
      );
    });

    try {
      const entries = parseLogEntries(lines);
      const connected = entries.find(
        (e) => e.component === "connection" && e.message === "connected",
      );

      expect(connected).toBeDefined();
      expect(connected?.data?.service).toContain("bun");
    } finally {
      if (conn) {
        await (conn as Awaited<ReturnType<typeof connectToService>>).close();
      }
    }
  }, 15_000);

  test("failed connectToService logs connect_failed entry", async () => {
    setLogLevel("info");

    const { connectToService } = await import(
      "../../src/connection/client.ts"
    );

    const lines = await captureStderrAsync(async () => {
      try {
        await connectToService(
          {
            backend: "stdio" as const,
            command: "/nonexistent/binary/that-does-not-exist",
            args: [],
            env: {},
          },
          { timeout: 5000 },
        );
      } catch {
        // Expected to fail
      }
    });

    const entries = parseLogEntries(lines);
    const failed = entries.find(
      (e) =>
        e.component === "connection" && e.message === "connect_failed",
    );

    expect(failed).toBeDefined();
    expect(failed?.data?.service).toContain("/nonexistent");
    expect(failed?.data?.error).toBeDefined();
  }, 15_000);
});
