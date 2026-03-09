import { describe, test, expect, beforeEach, mock, afterEach } from "bun:test";
import type { McpConnection } from "../../src/connection/types.ts";
import type { ServicesConfig } from "../../src/config/index.ts";

/**
 * Create a mock McpConnection with configurable health.
 * When healthy=true, listTools resolves. When false, it rejects.
 */
function createMockConnection(healthy = true): McpConnection {
  return {
    client: {
      listTools: healthy
        ? mock(async () => ({ tools: [] }))
        : mock(async () => {
            throw new Error("connection dead");
          }),
    } as never,
    close: mock(async () => {}),
  };
}

// Track connections created by the mock factory
let mockConnectionQueue: McpConnection[] = [];

const mockConnectToService = mock(async () => {
  if (mockConnectionQueue.length > 0) {
    return mockConnectionQueue.shift()!;
  }
  return createMockConnection(true);
});

mock.module("../../src/connection/index.ts", () => ({
  connectToService: mockConnectToService,
}));

// Import pool AFTER mocking
const { ConnectionPool } = await import("../../src/daemon/pool.ts");

function makeConfig(count: number): ServicesConfig {
  const services: Record<string, any> = {};
  for (let i = 0; i < count; i++) {
    services[`svc-${i}`] = {
      backend: "stdio" as const,
      command: "echo",
      args: [`svc-${i}`],
      env: {},
    };
  }
  return { services };
}

const singleConfig: ServicesConfig = {
  services: {
    "test-svc": {
      backend: "stdio" as const,
      command: "echo",
      args: ["hello"],
      env: {},
    },
  },
};

describe("ConnectionPool Hardening", () => {
  let pool: InstanceType<typeof ConnectionPool>;
  const originalEnv = process.env.MCP2CLI_POOL_MAX;

  beforeEach(() => {
    mockConnectToService.mockClear();
    mockConnectionQueue = [];
    delete process.env.MCP2CLI_POOL_MAX;
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.MCP2CLI_POOL_MAX = originalEnv;
    } else {
      delete process.env.MCP2CLI_POOL_MAX;
    }
  });

  // -- MEM-04: Pool size limit --

  describe("MEM-04: Pool size limit", () => {
    test("default maxSize is 50", () => {
      pool = new ConnectionPool();
      expect(pool.maxSize).toBe(50);
    });

    test("respects MCP2CLI_POOL_MAX env var", () => {
      process.env.MCP2CLI_POOL_MAX = "10";
      pool = new ConnectionPool();
      expect(pool.maxSize).toBe(10);
    });

    test("respects constructor maxSize option", () => {
      pool = new ConnectionPool({ maxSize: 5 });
      expect(pool.maxSize).toBe(5);
    });

    test("constructor option overrides env var", () => {
      process.env.MCP2CLI_POOL_MAX = "10";
      pool = new ConnectionPool({ maxSize: 3 });
      expect(pool.maxSize).toBe(3);
    });

    test("ignores invalid MCP2CLI_POOL_MAX (falls back to 50)", () => {
      process.env.MCP2CLI_POOL_MAX = "not-a-number";
      pool = new ConnectionPool();
      expect(pool.maxSize).toBe(50);
    });

    test("allows connections up to maxSize", async () => {
      pool = new ConnectionPool({ maxSize: 3 });
      const config = makeConfig(3);

      await pool.getConnection("svc-0", config);
      await pool.getConnection("svc-1", config);
      await pool.getConnection("svc-2", config);

      expect(pool.size).toBe(3);
    });

    test("rejects connection when pool is at maxSize limit", async () => {
      pool = new ConnectionPool({ maxSize: 2 });
      const config = makeConfig(3);

      await pool.getConnection("svc-0", config);
      await pool.getConnection("svc-1", config);

      await expect(pool.getConnection("svc-2", config)).rejects.toThrow(
        /pool limit reached/i,
      );
      expect(pool.size).toBe(2);
    });

    test("pool limit error has structured error fields", async () => {
      pool = new ConnectionPool({ maxSize: 1 });
      const config = makeConfig(2);

      await pool.getConnection("svc-0", config);

      try {
        await pool.getConnection("svc-1", config);
        expect.unreachable("should have thrown");
      } catch (err: any) {
        expect(err.name).toBe("ConnectionError");
        expect(err.code).toBe("CONNECTION_ERROR");
        expect(err.reason).toBe("pool_limit_reached");
        expect(err.message).toContain("1");
      }
    });

    test("allows reconnection to existing service at pool limit", async () => {
      pool = new ConnectionPool({ maxSize: 1 });
      const config = makeConfig(1);

      // First connection
      await pool.getConnection("svc-0", config);
      // Same service should return cached -- not trigger limit
      const conn2 = await pool.getConnection("svc-0", config);
      expect(conn2).toBeDefined();
      expect(pool.size).toBe(1);
    });

    test("allows new connection after closing one at limit", async () => {
      pool = new ConnectionPool({ maxSize: 2 });
      const config = makeConfig(3);

      await pool.getConnection("svc-0", config);
      await pool.getConnection("svc-1", config);

      // At limit -- close one
      await pool.closeService("svc-0");
      expect(pool.size).toBe(1);

      // Now svc-2 should work
      await pool.getConnection("svc-2", config);
      expect(pool.size).toBe(2);
    });
  });

  // -- MEM-05: Health check before reuse --

  describe("MEM-05: Health check before reuse", () => {
    test("returns cached connection when healthy", async () => {
      pool = new ConnectionPool({ maxSize: 10 });
      const healthyConn = createMockConnection(true);
      mockConnectionQueue.push(healthyConn);

      const conn1 = await pool.getConnection("test-svc", singleConfig);
      expect(conn1).toBe(healthyConn);

      // Second call should return same connection (health check passes)
      const conn2 = await pool.getConnection("test-svc", singleConfig);
      expect(conn2).toBe(healthyConn);
      // connectToService only called once -- cached reuse
      expect(mockConnectToService).toHaveBeenCalledTimes(1);
    });

    test("replaces dead connection on health check failure", async () => {
      pool = new ConnectionPool({ maxSize: 10 });

      // First connection is healthy initially
      const deadConn = createMockConnection(true);
      mockConnectionQueue.push(deadConn);

      const conn1 = await pool.getConnection("test-svc", singleConfig);
      expect(conn1).toBe(deadConn);

      // Now make the connection unhealthy
      (deadConn.client.listTools as any).mockImplementation(async () => {
        throw new Error("pipe broken");
      });

      // Push a fresh healthy connection for reconnect
      const freshConn = createMockConnection(true);
      mockConnectionQueue.push(freshConn);

      const conn2 = await pool.getConnection("test-svc", singleConfig);
      // Should get a NEW connection, not the dead one
      expect(conn2).toBe(freshConn);
      expect(conn2).not.toBe(deadConn);
      // connectToService called twice: initial + reconnect
      expect(mockConnectToService).toHaveBeenCalledTimes(2);
    });

    test("dead connection is closed before reconnect", async () => {
      pool = new ConnectionPool({ maxSize: 10 });

      const deadConn = createMockConnection(true);
      mockConnectionQueue.push(deadConn);

      await pool.getConnection("test-svc", singleConfig);

      // Kill the connection
      (deadConn.client.listTools as any).mockImplementation(async () => {
        throw new Error("dead");
      });

      mockConnectionQueue.push(createMockConnection(true));
      await pool.getConnection("test-svc", singleConfig);

      // close() should have been called on the dead connection
      expect(deadConn.close).toHaveBeenCalled();
    });

    test("health check timeout triggers reconnect", async () => {
      pool = new ConnectionPool({ maxSize: 10, healthCheckTimeoutMs: 100 });

      // Connection whose listTools hangs forever
      const hangingConn: McpConnection = {
        client: {
          listTools: mock(
            () => new Promise(() => {}), // never resolves
          ),
        } as never,
        close: mock(async () => {}),
      };
      mockConnectionQueue.push(hangingConn);

      await pool.getConnection("test-svc", singleConfig);

      // Push replacement
      const freshConn = createMockConnection(true);
      mockConnectionQueue.push(freshConn);

      const conn2 = await pool.getConnection("test-svc", singleConfig);
      expect(conn2).toBe(freshConn);
      expect(conn2).not.toBe(hangingConn);
    });

    test("pool size does not grow when replacing dead connection", async () => {
      pool = new ConnectionPool({ maxSize: 2 });
      const config = makeConfig(2);

      const deadConn = createMockConnection(true);
      mockConnectionQueue.push(deadConn);
      mockConnectionQueue.push(createMockConnection(true)); // svc-1

      await pool.getConnection("svc-0", config);
      await pool.getConnection("svc-1", config);
      expect(pool.size).toBe(2);

      // Kill svc-0
      (deadConn.client.listTools as any).mockImplementation(async () => {
        throw new Error("dead");
      });

      mockConnectionQueue.push(createMockConnection(true)); // replacement for svc-0
      await pool.getConnection("svc-0", config);
      // Size should still be 2, not 3
      expect(pool.size).toBe(2);
    });
  });
});
