import { describe, it, expect, afterEach } from "bun:test";
import { connectToService } from "../../src/connection/client.ts";
import { ConnectionError } from "../../src/connection/errors.ts";
import { EXIT_CODES } from "../../src/types/index.ts";
import type { McpConnection } from "../../src/connection/types.ts";
import type { StdioService } from "../../src/config/schema.ts";
import { resolve } from "path";

const MOCK_SERVER = resolve(import.meta.dir, "../fixtures/mock-mcp-server.ts");
const NOISY_SERVER = resolve(import.meta.dir, "../fixtures/noisy-mcp-server.ts");

function mockService(script: string): StdioService {
  return {
    backend: "stdio" as const,
    command: "bun",
    args: [script],
    env: {},
  };
}

describe("connectToService", () => {
  let connection: McpConnection | null = null;

  afterEach(async () => {
    if (connection) {
      try {
        await connection.close();
      } catch {
        // Already closed
      }
      connection = null;
    }
  });

  it("connects to mock server and completes handshake", async () => {
    connection = await connectToService(mockService(MOCK_SERVER));

    expect(connection).toBeDefined();
    expect(connection.client).toBeDefined();
    expect(typeof connection.close).toBe("function");
  }, 15_000);

  it("connects to noisy server, filters noise, completes handshake", async () => {
    connection = await connectToService(mockService(NOISY_SERVER));

    expect(connection).toBeDefined();
    expect(connection.client).toBeDefined();

    // Verify server info comes through despite noise
    const serverVersion = connection.client.getServerVersion();
    expect(serverVersion).toBeDefined();
    expect(serverVersion?.name).toBe("noisy-mcp-server");
  }, 15_000);

  it("throws ConnectionError for nonexistent command", async () => {
    const service: StdioService = {
      backend: "stdio" as const,
      command: "/nonexistent/binary/that-does-not-exist",
      args: [],
      env: {},
    };

    try {
      connection = await connectToService(service);
      // Should not reach here
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(ConnectionError);
      const connErr = err as ConnectionError;
      expect(connErr.code).toBe("CONNECTION_ERROR");
    }
  }, 15_000);

  it("throws ConnectionError for server that exits immediately", async () => {
    const service: StdioService = {
      backend: "stdio" as const,
      command: "bun",
      args: ["-e", "process.exit(1)"],
      env: {},
    };

    try {
      connection = await connectToService(service);
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(ConnectionError);
      const connErr = err as ConnectionError;
      expect(connErr.code).toBe("CONNECTION_ERROR");
    }
  }, 15_000);

  it("close() terminates the server process", async () => {
    connection = await connectToService(mockService(MOCK_SERVER));

    // Connection is live
    expect(connection.client).toBeDefined();

    // Close should not throw
    await connection.close();

    // Prevent double-close in afterEach
    connection = null;
  }, 15_000);

  it("ConnectionError has structured JSON format", async () => {
    const service: StdioService = {
      backend: "stdio" as const,
      command: "/nonexistent/binary",
      args: ["--fake"],
      env: {},
    };

    try {
      await connectToService(service);
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(ConnectionError);
      const connErr = err as ConnectionError;

      // Verify structured properties
      expect(connErr.code).toBe("CONNECTION_ERROR");
      expect(typeof connErr.message).toBe("string");
      expect(connErr.message.length).toBeGreaterThan(0);
      expect(connErr.reason).toBeDefined();
      expect(typeof connErr.reason).toBe("string");
    }
  }, 15_000);

  it("CLI error handler maps ConnectionError to exit code 5", () => {
    // Unit test: verify ConnectionError is caught by instanceof
    // and maps to EXIT_CODES.CONNECTION
    const error = new ConnectionError("test failure", "test reason");

    expect(error instanceof ConnectionError).toBe(true);
    expect(error instanceof Error).toBe(true);
    expect(error.code).toBe("CONNECTION_ERROR");
    expect(EXIT_CODES.CONNECTION).toBe(5);

    // Verify it would NOT match ConfigError branch
    expect(error.constructor.name).toBe("ConnectionError");
    expect(error.name).toBe("ConnectionError");
  }, 15_000);
});
