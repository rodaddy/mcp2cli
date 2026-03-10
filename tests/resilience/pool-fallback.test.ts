import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import type { McpConnection } from "../../src/connection/types.ts";
import type { ServicesConfig } from "../../src/config/index.ts";
import { saveState } from "../../src/resilience/index.ts";
import type { CircuitBreakerState } from "../../src/resilience/index.ts";

// -- Mocks --

const mockHttpConnection: McpConnection = {
  client: {
    callTool: mock(() => Promise.resolve({})),
    listTools: mock(() => Promise.resolve({ tools: [] })),
  } as never,
  close: mock(() => Promise.resolve()),
};

const mockStdioConnection: McpConnection = {
  client: {
    callTool: mock(() => Promise.resolve({})),
    listTools: mock(() => Promise.resolve({ tools: [] })),
  } as never,
  close: mock(() => Promise.resolve()),
};

const mockConnectToHttpService = mock(async () => mockHttpConnection);
const mockConnectToService = mock(async () => mockStdioConnection);

mock.module("../../src/connection/index.ts", () => ({
  connectToHttpService: mockConnectToHttpService,
  connectToService: mockConnectToService,
}));

// Import pool AFTER mocking
const { ConnectionPool } = await import("../../src/daemon/pool.ts");

// -- Test setup --

let testDir: string;
let origCacheDir: string | undefined;

const httpWithFallbackConfig: ServicesConfig = {
  services: {
    "gateway-svc": {
      backend: "http" as const,
      url: "http://mcp-gateway:3000/n8n",
      headers: {},
      fallback: {
        command: "npx",
        args: ["-y", "n8n-mcp"],
        env: {},
      },
    },
  },
};

const httpNoFallbackConfig: ServicesConfig = {
  services: {
    "no-fallback": {
      backend: "http" as const,
      url: "http://mcp-gateway:3000/vault",
      headers: {},
    },
  },
};

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), "mcp2cli-pool-fb-test-"));
  origCacheDir = process.env.MCP2CLI_CACHE_DIR;
  process.env.MCP2CLI_CACHE_DIR = join(testDir, "schemas");

  mockConnectToHttpService.mockClear();
  mockConnectToService.mockClear();
  mockConnectToHttpService.mockImplementation(async () => mockHttpConnection);
  mockConnectToService.mockImplementation(async () => mockStdioConnection);
});

afterEach(async () => {
  if (origCacheDir !== undefined) {
    process.env.MCP2CLI_CACHE_DIR = origCacheDir;
  } else {
    delete process.env.MCP2CLI_CACHE_DIR;
  }
  await rm(testDir, { recursive: true, force: true });
});

// -- Tests --

describe("pool HTTP with fallback", () => {
  test("connects via HTTP when gateway is reachable", async () => {
    const pool = new ConnectionPool();
    const conn = await pool.getConnection("gateway-svc", httpWithFallbackConfig);

    expect(conn).toBeDefined();
    expect(mockConnectToHttpService).toHaveBeenCalledTimes(1);
    expect(mockConnectToService).not.toHaveBeenCalled();

    await pool.closeAll();
  });

  test("falls back to stdio when HTTP fails", async () => {
    mockConnectToHttpService.mockImplementation(async () => {
      throw new Error("Connection refused");
    });

    const pool = new ConnectionPool();
    const conn = await pool.getConnection("gateway-svc", httpWithFallbackConfig);

    expect(conn).toBeDefined();
    expect(mockConnectToHttpService).toHaveBeenCalledTimes(1);
    expect(mockConnectToService).toHaveBeenCalledTimes(1);

    await pool.closeAll();
  });

  test("skips HTTP when circuit is open, uses fallback directly", async () => {
    // Pre-set open circuit state
    const openState: CircuitBreakerState = {
      state: "open",
      failureCount: 5,
      lastFailureAt: new Date().toISOString(),
      openedAt: new Date().toISOString(),
      lastSuccessAt: null,
    };
    await saveState("gateway-svc", openState);

    const pool = new ConnectionPool();
    const conn = await pool.getConnection("gateway-svc", httpWithFallbackConfig);

    expect(conn).toBeDefined();
    // HTTP should NOT have been attempted
    expect(mockConnectToHttpService).not.toHaveBeenCalled();
    // Stdio fallback should have been used
    expect(mockConnectToService).toHaveBeenCalledTimes(1);

    await pool.closeAll();
  });

  test("throws when HTTP fails and no fallback configured", async () => {
    mockConnectToHttpService.mockImplementation(async () => {
      throw new Error("Connection refused");
    });

    const pool = new ConnectionPool();
    await expect(
      pool.getConnection("no-fallback", httpNoFallbackConfig),
    ).rejects.toThrow("Connection refused");

    expect(mockConnectToHttpService).toHaveBeenCalledTimes(1);
    expect(mockConnectToService).not.toHaveBeenCalled();
  });

  test("throws when circuit open and no fallback configured", async () => {
    const openState: CircuitBreakerState = {
      state: "open",
      failureCount: 5,
      lastFailureAt: new Date().toISOString(),
      openedAt: new Date().toISOString(),
      lastSuccessAt: null,
    };
    await saveState("no-fallback", openState);

    const pool = new ConnectionPool();
    await expect(
      pool.getConnection("no-fallback", httpNoFallbackConfig),
    ).rejects.toThrow("Circuit breaker open");

    expect(mockConnectToHttpService).not.toHaveBeenCalled();
  });

  test("fallback receives correct stdio config from fallback field", async () => {
    mockConnectToHttpService.mockImplementation(async () => {
      throw new Error("Gateway down");
    });

    const pool = new ConnectionPool();
    await pool.getConnection("gateway-svc", httpWithFallbackConfig);

    expect(mockConnectToService).toHaveBeenCalledTimes(1);
    const calls = mockConnectToService.mock.calls as unknown as Array<[{ backend: string; command: string; args: string[]; env: Record<string, string> }]>;
    const callArg = calls[0]![0];
    expect(callArg.backend).toBe("stdio");
    expect(callArg.command).toBe("npx");
    expect(callArg.args).toEqual(["-y", "n8n-mcp"]);

    await pool.closeAll();
  });

  test("records success when HTTP connects", async () => {
    const pool = new ConnectionPool();
    await pool.getConnection("gateway-svc", httpWithFallbackConfig);

    // Verify circuit breaker recorded success
    const { loadState } = await import("../../src/resilience/index.ts");
    const state = await loadState("gateway-svc");
    expect(state.state).toBe("closed");
    expect(state.failureCount).toBe(0);
    expect(state.lastSuccessAt).not.toBeNull();

    await pool.closeAll();
  });

  test("records failure when HTTP fails", async () => {
    mockConnectToHttpService.mockImplementation(async () => {
      throw new Error("Timeout");
    });

    const pool = new ConnectionPool();
    await pool.getConnection("gateway-svc", httpWithFallbackConfig);

    const { loadState } = await import("../../src/resilience/index.ts");
    const state = await loadState("gateway-svc");
    expect(state.failureCount).toBe(1);

    await pool.closeAll();
  });
});

describe("pool HTTP fallback - schema config validation", () => {
  test("services.json with fallback parses correctly", async () => {
    const { ServicesConfigSchema } = await import("../../src/config/index.ts");

    const result = ServicesConfigSchema.safeParse({
      services: {
        n8n: {
          backend: "http",
          url: "http://mcp-gateway:3000/n8n",
          fallback: {
            command: "npx",
            args: ["-y", "n8n-mcp"],
          },
        },
      },
    });

    expect(result.success).toBe(true);
    if (result.success) {
      const svc = result.data.services.n8n!;
      expect(svc.backend).toBe("http");
      if (svc.backend === "http") {
        expect(svc.fallback).toBeDefined();
        expect(svc.fallback!.command).toBe("npx");
        expect(svc.fallback!.args).toEqual(["-y", "n8n-mcp"]);
        expect(svc.fallback!.env).toEqual({});
      }
    }
  });

  test("HTTP service without fallback still valid", async () => {
    const { ServicesConfigSchema } = await import("../../src/config/index.ts");

    const result = ServicesConfigSchema.safeParse({
      services: {
        vault: {
          backend: "http",
          url: "http://mcp-gateway:3000/vault",
        },
      },
    });

    expect(result.success).toBe(true);
  });

  test("fallback with invalid command fails", async () => {
    const { ServicesConfigSchema } = await import("../../src/config/index.ts");

    const result = ServicesConfigSchema.safeParse({
      services: {
        bad: {
          backend: "http",
          url: "http://mcp-gateway:3000/bad",
          fallback: {
            command: "", // empty command should fail
          },
        },
      },
    });

    expect(result.success).toBe(false);
  });
});
