import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { setLogLevel, resetLogLevel } from "../../src/logger/index.ts";
import type { LogEntry } from "../../src/logger/types.ts";

/**
 * Capture stderr output during an async callback.
 * Replaces process.stderr.write temporarily, returns captured strings.
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

// --- Mock the connection module so pool.getConnection doesn't spawn real processes ---
const mockCallTool = mock(() =>
  Promise.resolve({ content: [{ type: "text", text: "ok" }] }),
);
const mockClose = mock(() => Promise.resolve());

const mockConnectToService = mock(async () => ({
  client: { callTool: mockCallTool } as never,
  close: mockClose,
}));

mock.module("../../src/connection/index.ts", () => ({
  connectToService: mockConnectToService,
}));

// Import pool and server AFTER mocking
const { ConnectionPool } = await import("../../src/daemon/pool.ts");
const { createDaemonServer } = await import("../../src/daemon/server.ts");
const { IdleTimer } = await import("../../src/daemon/idle.ts");
const { MetricsCollector } = await import("../../src/daemon/metrics.ts");

const testConfig = {
  services: {
    "test-svc": {
      backend: "stdio" as const,
      command: "echo",
      args: ["hello"],
      env: {},
    },
  },
};

describe("Daemon Observability", () => {
  let tempDir: string;
  let origCacheDir: string | undefined;
  let servers: ReturnType<typeof createDaemonServer>[] = [];

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "mcp2cli-obs-test-"));
    origCacheDir = process.env.MCP2CLI_CACHE_DIR;
    process.env.MCP2CLI_CACHE_DIR = join(tempDir, "schemas");
    mockConnectToService.mockClear();
    mockCallTool.mockClear();
    mockClose.mockClear();
  });

  afterEach(async () => {
    if (origCacheDir !== undefined) {
      process.env.MCP2CLI_CACHE_DIR = origCacheDir;
    } else {
      delete process.env.MCP2CLI_CACHE_DIR;
    }
    resetLogLevel();
    for (const s of servers) {
      try {
        s.stop(true);
      } catch {
        // Already stopped
      }
    }
    servers = [];
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  /** Create a daemon server bound to a unique unix socket in tempDir */
  function makeServer(pool: InstanceType<typeof ConnectionPool>) {
    const socketPath = join(tempDir, `test-${Date.now()}.sock`);
    const idleTimer = new IdleTimer(60000, () => {});
    const server = createDaemonServer({
      listenConfig: { mode: "unix", socketPath },
      pool,
      config: testConfig,
      idleTimer,
      onShutdown: () => {},
      authToken: undefined,
      metrics: new MetricsCollector(),
    });
    servers.push(server);
    return server;
  }

  describe("LOG-05: /health memory stats", () => {
    test("/health response includes memory object with rss, heapUsed, heapTotal", async () => {
      const pool = new ConnectionPool();
      const server = makeServer(pool);

      const req = new Request("http://localhost/health", { method: "GET" });
      const res = await server.fetch(req);
      const body = (await res.json()) as Record<string, unknown>;

      expect(body.status).toBe("ok");
      expect(body.uptime).toBeDefined();
      expect(body.services).toBeDefined();
      expect(body.activeConnections).toBeDefined();

      // Memory stats
      const memory = body.memory as Record<string, unknown>;
      expect(memory).toBeDefined();
      expect(typeof memory.rss).toBe("number");
      expect(typeof memory.heapUsed).toBe("number");
      expect(typeof memory.heapTotal).toBe("number");

      // Sanity: values should be positive
      expect(memory.rss).toBeGreaterThan(0);
      expect(memory.heapUsed).toBeGreaterThan(0);
      expect(memory.heapTotal).toBeGreaterThan(0);

      await pool.closeAll();
    });
  });

  describe("LOG-02: /call request tracing", () => {
    test("/call response shape is unchanged (backward compat)", async () => {
      const pool = new ConnectionPool();
      const server = makeServer(pool);

      const req = new Request("http://localhost/call", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          service: "test-svc",
          tool: "my-tool",
          params: {},
        }),
      });

      const res = await server.fetch(req);
      const body = (await res.json()) as Record<string, unknown>;

      // Response shape: { success: true, result: ... }
      expect(body.success).toBe(true);
      expect("result" in body).toBe(true);

      await pool.closeAll();
    });

    test("successful /call logs tool_call with service, tool, duration, result=success", async () => {
      setLogLevel("info");

      const pool = new ConnectionPool();
      const server = makeServer(pool);

      const lines = await captureStderrAsync(async () => {
        const req = new Request("http://localhost/call", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            service: "test-svc",
            tool: "my-tool",
            params: {},
          }),
        });
        await server.fetch(req);
      });

      // Find the tool_call log entry from daemon:request component
      const toolCallLines = parseLogEntries(lines).filter(
        (e) =>
          e.component === "daemon:request" && e.message === "tool_call",
      );

      expect(toolCallLines.length).toBeGreaterThanOrEqual(1);
      const entry = toolCallLines[0]!;
      expect(entry.data?.service).toBe("test-svc");
      expect(entry.data?.tool).toBe("my-tool");
      expect(typeof entry.data?.duration).toBe("number");
      expect(entry.data?.result).toBe("success");

      await pool.closeAll();
    });

    test("failed /call logs tool_call with result=error", async () => {
      setLogLevel("info");

      // Make callTool fail
      mockCallTool.mockImplementationOnce(() =>
        Promise.reject(new Error("boom")),
      );

      const pool = new ConnectionPool();
      const server = makeServer(pool);

      const lines = await captureStderrAsync(async () => {
        const req = new Request("http://localhost/call", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            service: "test-svc",
            tool: "fail-tool",
            params: {},
          }),
        });
        await server.fetch(req);
      });

      const toolCallLines = parseLogEntries(lines).filter(
        (e) =>
          e.component === "daemon:request" && e.message === "tool_call",
      );

      expect(toolCallLines.length).toBeGreaterThanOrEqual(1);
      const entry = toolCallLines[0]!;
      expect(entry.data?.service).toBe("test-svc");
      expect(entry.data?.tool).toBe("fail-tool");
      expect(typeof entry.data?.duration).toBe("number");
      expect(entry.data?.result).toBe("error");
      expect(entry.data?.error).toBeDefined();

      await pool.closeAll();
    });
  });

  describe("LOG-03: pool lifecycle logging", () => {
    test("pool getConnection logs connecting and connected", async () => {
      setLogLevel("info");

      const pool = new ConnectionPool();

      try {
        const lines = await captureStderrAsync(async () => {
          await pool.getConnection("test-svc", testConfig);
        });

        const poolEntries = parseLogEntries(lines).filter(
          (e) => e.component === "pool",
        );

        const messages = poolEntries.map((e) => e.message);
        expect(messages).toContain("connecting");
        expect(messages).toContain("connected");

        // Check data fields
        const connecting = poolEntries.find((e) => e.message === "connecting");
        expect(connecting?.data?.service).toBe("test-svc");
      } finally {
        await pool.closeAll();
      }
    });

    test("pool closeService logs disconnecting", async () => {
      setLogLevel("info");

      const pool = new ConnectionPool();
      await pool.getConnection("test-svc", testConfig);

      const lines = await captureStderrAsync(async () => {
        await pool.closeService("test-svc");
      });

      const poolEntries = parseLogEntries(lines).filter(
        (e) => e.component === "pool",
      );

      const messages = poolEntries.map((e) => e.message);
      expect(messages).toContain("disconnecting");
    });

    test("pool closeAll logs closing_all with count", async () => {
      setLogLevel("info");

      const pool = new ConnectionPool();
      await pool.getConnection("test-svc", testConfig);

      const lines = await captureStderrAsync(async () => {
        await pool.closeAll();
      });

      const poolEntries = parseLogEntries(lines).filter(
        (e) => e.component === "pool",
      );

      const closingAll = poolEntries.find((e) => e.message === "closing_all");
      expect(closingAll).toBeDefined();
      expect(closingAll?.data?.count).toBe(1);
    });
  });
});
