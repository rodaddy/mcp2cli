import { describe, test, expect, beforeEach, mock } from "bun:test";
import type { McpConnection } from "../../src/connection/types.ts";
import type { ServicesConfig } from "../../src/config/index.ts";

// Mock connectToService before importing the pool
const mockConnectToService = mock(async () => {
  const conn: McpConnection = {
    client: { callTool: mock(() => Promise.resolve({})), listTools: mock(() => Promise.resolve({ tools: [] })) } as never,
    close: mock(() => Promise.resolve()),
  };
  return conn;
});

// Apply the mock to the connection module
mock.module("../../src/connection/index.ts", () => ({
  connectToService: mockConnectToService,
}));

// Import pool AFTER mocking
const { ConnectionPool } = await import("../../src/daemon/pool.ts");

const testConfig: ServicesConfig = {
  services: {
    "test-svc": {
      backend: "stdio" as const,
      command: "echo",
      args: ["hello"],
      env: {},
    },
    "other-svc": {
      backend: "stdio" as const,
      command: "echo",
      args: ["other"],
      env: {},
    },
  },
};

describe("ConnectionPool", () => {
  let pool: InstanceType<typeof ConnectionPool>;

  beforeEach(() => {
    pool = new ConnectionPool();
    mockConnectToService.mockClear();
  });

  test("getConnection creates new connection (mock called once)", async () => {
    const conn = await pool.getConnection("test-svc", testConfig);
    expect(conn).toBeDefined();
    expect(conn.client).toBeDefined();
    expect(mockConnectToService).toHaveBeenCalledTimes(1);
  });

  test("getConnection returns cached connection on second call", async () => {
    const conn1 = await pool.getConnection("test-svc", testConfig);
    const conn2 = await pool.getConnection("test-svc", testConfig);
    expect(conn1).toBe(conn2);
    expect(mockConnectToService).toHaveBeenCalledTimes(1);
  });

  test("closeService removes connection and calls close()", async () => {
    const conn = await pool.getConnection("test-svc", testConfig);
    await pool.closeService("test-svc");
    expect(conn.close).toHaveBeenCalledTimes(1);
    expect(pool.size).toBe(0);
  });

  test("closeAll closes all connections and clears pool", async () => {
    const conn1 = await pool.getConnection("test-svc", testConfig);
    const conn2 = await pool.getConnection("other-svc", testConfig);
    await pool.closeAll();
    expect(conn1.close).toHaveBeenCalledTimes(1);
    expect(conn2.close).toHaveBeenCalledTimes(1);
    expect(pool.size).toBe(0);
  });

  test("getConnection after closeService creates fresh connection", async () => {
    await pool.getConnection("test-svc", testConfig);
    await pool.closeService("test-svc");
    expect(mockConnectToService).toHaveBeenCalledTimes(1);

    await pool.getConnection("test-svc", testConfig);
    expect(mockConnectToService).toHaveBeenCalledTimes(2);
  });

  test("size and serviceNames reflect pool state", async () => {
    expect(pool.size).toBe(0);
    expect(pool.serviceNames).toEqual([]);

    await pool.getConnection("test-svc", testConfig);
    expect(pool.size).toBe(1);
    expect(pool.serviceNames).toContain("test-svc");

    await pool.getConnection("other-svc", testConfig);
    expect(pool.size).toBe(2);
    expect(pool.serviceNames).toContain("other-svc");
  });

  test("concurrent getConnection for same service only calls connectToService once", async () => {
    // Make connectToService take some time to simulate real connection
    mockConnectToService.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => {
            resolve({
              client: { callTool: mock(() => Promise.resolve({})), listTools: mock(() => Promise.resolve({ tools: [] })) } as never,
              close: mock(() => Promise.resolve()),
            });
          }, 50);
        }),
    );

    const [conn1, conn2] = await Promise.all([
      pool.getConnection("test-svc", testConfig),
      pool.getConnection("test-svc", testConfig),
    ]);

    // Should have only spawned ONE MCP process
    expect(mockConnectToService).toHaveBeenCalledTimes(1);
    // Both should be the same instance
    expect(conn1).toBe(conn2);
  });
});
