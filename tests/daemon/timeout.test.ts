/**
 * MEM-02: Tool call timeout tests.
 * Exercises the daemon /call path against a slow MCP fixture without relying on
 * CLI-managed daemon startup timing.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDaemonServer } from "../../src/daemon/server.ts";
import { ConnectionPool } from "../../src/daemon/pool.ts";
import { IdleTimer } from "../../src/daemon/idle.ts";
import { TokenAuthProvider } from "../../src/daemon/auth-provider.ts";
import { MetricsCollector } from "../../src/daemon/metrics.ts";
import type { ServicesConfig } from "../../src/config/index.ts";

let tempDir: string;
let pool: ConnectionPool;
let server: ReturnType<typeof createDaemonServer>;

function makeConfig(): ServicesConfig {
  return {
    services: {
      slowOk: {
        backend: "stdio",
        command: "fake",
        args: [],
        env: {},
        timeout: 30_000,
      },
      slowTimeout: {
        backend: "stdio",
        command: "fake",
        args: [],
        env: {},
        timeout: 500,
      },
    },
  };
}

/**
 * Error shape the real MCP SDK raises when its own request deadline fires:
 * a JSON-RPC error carrying ErrorCode.RequestTimeout (-32001).
 */
class FakeMcpTimeoutError extends Error {
  readonly code = -32001;
  constructor(timeoutMs: number) {
    super(`MCP error -32001: Request timed out after ${timeoutMs}ms`);
  }
}

/**
 * Stands in for the SDK client. The deadline lives HERE, driven by the
 * RequestOptions the daemon passes in -- which is the contract under test
 * (rtech-infra#418). A fake that ignores the options argument would pass
 * whether or not the daemon forwarded the timeout at all.
 */
class FakePool {
  async getConnection() {
    return {
      client: {
        async callTool(
          request: { arguments?: { delay_ms?: number } },
          _resultSchema?: unknown,
          options?: { timeout?: number },
        ) {
          const delay = request.arguments?.delay_ms ?? 0;
          const timeout = options?.timeout;

          if (timeout !== undefined && delay > timeout) {
            await new Promise((r) => setTimeout(r, timeout));
            throw new FakeMcpTimeoutError(timeout);
          }

          await new Promise((resolveDelay) => setTimeout(resolveDelay, delay));
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({ status: "ok", delayed: delay }),
              },
            ],
          };
        },
      },
    };
  }

  async closeAll() {}
}

async function callTool(service: string, delayMs: number): Promise<unknown> {
  const response = await server.fetch(
    new Request("http://localhost/call", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        service,
        tool: "slow_tool",
        params: { delay_ms: delayMs },
      }),
    }),
  );

  return response.json();
}

describe("MEM-02: Tool call timeout", () => {
  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "mcp2cli-timeout-"));
    const config = makeConfig();
    pool = new FakePool() as unknown as ConnectionPool;
    server = createDaemonServer({
      listenConfig: { mode: "unix", socketPath: join(tempDir, "daemon.sock") },
      pool,
      config,
      idleTimer: new IdleTimer(60_000, () => {}),
      onShutdown: () => {},
      authProvider: new TokenAuthProvider([]),
      metrics: new MetricsCollector(),
    });
  });

  afterEach(async () => {
    server.stop(true);
    await pool.closeAll();
    await rm(tempDir, { recursive: true, force: true });
  });

  test("tool call within timeout succeeds normally", async () => {
    const parsed = await callTool("slowOk", 10) as { success?: boolean; result?: { delayed?: number } };

    expect(parsed.success).toBe(true);
    expect(parsed.result?.delayed).toBe(10);
  });

  test("tool call exceeding timeout returns TOOL_TIMEOUT error", async () => {
    const parsed = await callTool("slowTimeout", 2_000) as {
      success?: boolean;
      error?: { code?: string; message?: string };
    };

    expect(parsed.success).toBe(false);
    expect(parsed.error?.code).toBe("TOOL_TIMEOUT");
    expect(parsed.error?.message).toContain("timed out");
    expect(parsed.error?.message).toContain("500ms");
  });

  // rtech-infra#418: the SDK applies DEFAULT_REQUEST_TIMEOUT_MSEC (60s) to any
  // callTool that receives no RequestOptions, so a per-service timeout that is
  // never handed to the SDK is inert. Assert the options object directly --
  // an outer deadline in the daemon cannot substitute for it.
  test("per-service timeout is passed into the SDK callTool options", async () => {
    const seen: Array<{ timeout?: number; resetTimeoutOnProgress?: boolean; maxTotalTimeout?: number }> = [];

    const recordingPool = {
      async getConnection() {
        return {
          client: {
            async callTool(
              _request: unknown,
              _resultSchema?: unknown,
              options?: {
                timeout?: number;
                resetTimeoutOnProgress?: boolean;
                maxTotalTimeout?: number;
              },
            ) {
              seen.push(options ?? {});
              return { content: [{ type: "text", text: "{}" }] };
            },
          },
        };
      },
      async closeAll() {},
    } as unknown as ConnectionPool;

    const recordingServer = createDaemonServer({
      listenConfig: {
        mode: "unix",
        socketPath: join(tempDir, "daemon-record.sock"),
      },
      pool: recordingPool,
      // slowOk declares timeout: 30_000
      config: makeConfig(),
      idleTimer: new IdleTimer(60_000, () => {}),
      onShutdown: () => {},
      authProvider: new TokenAuthProvider([]),
      metrics: new MetricsCollector(),
    });

    try {
      await recordingServer.fetch(
        new Request("http://localhost/call", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            service: "slowOk",
            tool: "slow_tool",
            params: {},
          }),
        }),
      );
    } finally {
      recordingServer.stop(true);
    }

    expect(seen.length).toBe(1);
    expect(seen[0]?.timeout).toBe(30_000);
    expect(seen[0]?.maxTotalTimeout).toBe(30_000);
    expect(seen[0]?.resetTimeoutOnProgress).toBe(true);
  });
});

// rtech-infra#1956: a timed-out call must drop its pooled connection so the
// next call reconnects instead of reusing a wedged session.
describe("timeout drops the pooled connection", () => {
  test("timed-out key is closed and the next call opens a new connection", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mcp2cli-timeout-close-"));
    const live = new Map<string, number>();
    let created = 0;
    const closed: string[] = [];

    const trackingPool = {
      async getConnection(key: string) {
        if (!live.has(key)) live.set(key, ++created);
        const connId = live.get(key)!;
        return {
          client: {
            async callTool(
              request: { arguments?: { delay_ms?: number } },
              _s?: unknown,
              options?: { timeout?: number },
            ) {
              const delay = request.arguments?.delay_ms ?? 0;
              const t = options?.timeout;
              if (t !== undefined && delay > t) {
                await new Promise((r) => setTimeout(r, t));
                throw new FakeMcpTimeoutError(t);
              }
              return { content: [{ type: "text", text: JSON.stringify({ connId }) }] };
            },
          },
        };
      },
      async closeService(key: string) {
        closed.push(key);
        live.delete(key);
        throw new Error("close failed"); // must not mask the timeout
      },
      async closeAll() {},
    } as unknown as ConnectionPool;

    const s = createDaemonServer({
      listenConfig: { mode: "unix", socketPath: join(dir, "d.sock") },
      pool: trackingPool,
      config: makeConfig(),
      idleTimer: new IdleTimer(60_000, () => {}),
      onShutdown: () => {},
      authProvider: new TokenAuthProvider([]),
      metrics: new MetricsCollector(),
    });
    const call = async (delay: number) =>
      (await (
        await s.fetch(
          new Request("http://localhost/call", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ service: "slowTimeout", tool: "t", params: { delay_ms: delay } }),
          }),
        )
      ).json()) as { success?: boolean; error?: { code?: string }; result?: { connId?: number } };

    try {
      const first = await call(2_000);
      expect(first.success).toBe(false);
      expect(first.error?.code).toBe("TOOL_TIMEOUT");
      expect(closed).toEqual(["slowTimeout"]);
      expect(live.has("slowTimeout")).toBe(false);

      const second = await call(0);
      expect(second.success).toBe(true);
      expect(second.result?.connId).toBe(2);
      expect(created).toBe(2);
    } finally {
      s.stop(true);
      await rm(dir, { recursive: true, force: true });
    }
  });
});
