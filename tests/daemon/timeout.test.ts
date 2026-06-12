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

class FakePool {
  async getConnection() {
    return {
      client: {
        async callTool(request: { arguments?: { delay_ms?: number } }) {
          const delay = request.arguments?.delay_ms ?? 0;
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
});
