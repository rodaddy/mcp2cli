import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createDaemonServer } from "../../src/daemon/server.ts";
import { ConnectionPool } from "../../src/daemon/pool.ts";
import { IdleTimer } from "../../src/daemon/idle.ts";
import { MetricsCollector } from "../../src/daemon/metrics.ts";
import { TokenAuthProvider } from "../../src/daemon/auth-provider.ts";
import { clearLocalTokenCache, fetchDaemonApi } from "../../src/process/client.ts";
import type { ServicesConfig } from "../../src/config/index.ts";

const EMPTY_CONFIG: ServicesConfig = { services: {} };

describe("client token refresh", () => {
  let tempDir: string;
  let originalEnv: Record<string, string | undefined>;
  let servers: ReturnType<typeof createDaemonServer>[] = [];
  let pools: ConnectionPool[] = [];

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "mcp2cli-client-refresh-test-"));
    originalEnv = {
      MCP2CLI_PID_FILE: process.env.MCP2CLI_PID_FILE,
      MCP2CLI_SOCKET_PATH: process.env.MCP2CLI_SOCKET_PATH,
      MCP2CLI_TOKENS_FILE: process.env.MCP2CLI_TOKENS_FILE,
      MCP2CLI_TOKEN_REFRESH_WINDOW_MS: process.env.MCP2CLI_TOKEN_REFRESH_WINDOW_MS,
      MCP2CLI_TOKEN_TTL_MS: process.env.MCP2CLI_TOKEN_TTL_MS,
      MCP2CLI_AUTH_TOKEN: process.env.MCP2CLI_AUTH_TOKEN,
      MCP_TOKEN: process.env.MCP_TOKEN,
    };
    delete process.env.MCP2CLI_AUTH_TOKEN;
    delete process.env.MCP_TOKEN;
    clearLocalTokenCache();
  });

  afterEach(async () => {
    for (const server of servers) server.stop(true);
    for (const pool of pools) await pool.closeAll();
    servers = [];
    pools = [];
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    clearLocalTokenCache();
    await rm(tempDir, { recursive: true, force: true });
  });

  test("refreshes a near-expiry local token before retryable daemon API calls", async () => {
    const socketPath = join(tempDir, "daemon.sock");
    const pidFile = join(tempDir, "daemon.pid");
    const tokensPath = join(tempDir, "tokens.json");
    const oldExpiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    await Bun.write(pidFile, String(process.pid));
    await Bun.write(tokensPath, JSON.stringify({
      tokens: [{
        id: "rico",
        token: "old-token",
        role: "admin",
        expiresAt: oldExpiresAt,
      }],
    }, null, 2));
    process.env.MCP2CLI_PID_FILE = pidFile;
    process.env.MCP2CLI_SOCKET_PATH = socketPath;
    process.env.MCP2CLI_TOKENS_FILE = tokensPath;
    process.env.MCP2CLI_TOKEN_REFRESH_WINDOW_MS = String(10 * 60 * 1000);
    process.env.MCP2CLI_TOKEN_TTL_MS = String(60 * 60 * 1000);

    const pool = new ConnectionPool();
    pools.push(pool);
    const server = createDaemonServer({
      listenConfig: { mode: "unix", socketPath },
      pool,
      config: EMPTY_CONFIG,
      idleTimer: new IdleTimer(60000, () => {}),
      onShutdown: () => {},
      authProvider: await TokenAuthProvider.load(tokensPath),
      metrics: new MetricsCollector(),
    });
    servers.push(server);

    const result = await fetchDaemonApi("GET", "/api/auth/me") as { success: boolean; userId: string; role: string };
    expect(result).toEqual({ success: true, userId: "rico", role: "admin" });

    const onDisk = await Bun.file(tokensPath).json() as { tokens: Array<{ token: string; expiresAt: string }> };
    expect(onDisk.tokens[0]!.token).not.toBe("old-token");
    expect(onDisk.tokens[0]!.expiresAt).not.toBe(oldExpiresAt);
  });

  test("skips expired admin tokens when selecting local daemon credentials", async () => {
    const socketPath = join(tempDir, "daemon.sock");
    const pidFile = join(tempDir, "daemon.pid");
    const tokensPath = join(tempDir, "tokens.json");
    await Bun.write(pidFile, String(process.pid));
    await Bun.write(tokensPath, JSON.stringify({
      tokens: [
        {
          id: "expired-admin",
          token: "expired-token",
          role: "admin",
          expiresAt: new Date(Date.now() - 60_000).toISOString(),
        },
        {
          id: "valid-admin",
          token: "valid-token",
          role: "admin",
          expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        },
      ],
    }, null, 2));
    process.env.MCP2CLI_PID_FILE = pidFile;
    process.env.MCP2CLI_SOCKET_PATH = socketPath;
    process.env.MCP2CLI_TOKENS_FILE = tokensPath;
    process.env.MCP2CLI_TOKEN_REFRESH_WINDOW_MS = String(10 * 60 * 1000);

    const pool = new ConnectionPool();
    pools.push(pool);
    const server = createDaemonServer({
      listenConfig: { mode: "unix", socketPath },
      pool,
      config: EMPTY_CONFIG,
      idleTimer: new IdleTimer(60000, () => {}),
      onShutdown: () => {},
      authProvider: await TokenAuthProvider.load(tokensPath),
      metrics: new MetricsCollector(),
    });
    servers.push(server);

    const result = await fetchDaemonApi("GET", "/api/auth/me") as { success: boolean; userId: string; role: string };
    expect(result).toEqual({ success: true, userId: "valid-admin", role: "admin" });
  });
});
