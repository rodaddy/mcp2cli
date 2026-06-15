import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ConfigManager } from "../../src/daemon/config-manager.ts";
import type { ServicesConfig } from "../../src/config/index.ts";
import { isAuthExempt } from "../../src/daemon/auth.ts";
import { createDaemonServer } from "../../src/daemon/server.ts";
import { ConnectionPool } from "../../src/daemon/pool.ts";
import { IdleTimer } from "../../src/daemon/idle.ts";
import { TokenAuthProvider } from "../../src/daemon/auth-provider.ts";
import { MetricsCollector } from "../../src/daemon/metrics.ts";

const STDIO_SERVICE = {
  backend: "stdio" as const,
  command: "/usr/bin/echo",
  args: ["hello"],
  env: {},
};

function makeConfig(services: Record<string, unknown> = {}): ServicesConfig {
  return { services } as ServicesConfig;
}

describe("Management API auth exemptions", () => {
  test("/ is auth-exempt (UI shell)", () => {
    expect(isAuthExempt("/")).toBe(true);
  });

  test("/health is auth-exempt", () => {
    expect(isAuthExempt("/health")).toBe(true);
  });

  test("/metrics is auth-exempt", () => {
    expect(isAuthExempt("/metrics")).toBe(true);
  });

  test("/api/services requires auth", () => {
    expect(isAuthExempt("/api/services")).toBe(false);
  });

  test("/api/services/import requires auth", () => {
    expect(isAuthExempt("/api/services/import")).toBe(false);
  });

  test("/api/services/export requires auth", () => {
    expect(isAuthExempt("/api/services/export")).toBe(false);
  });

  test("/api/services/myservice/status requires auth", () => {
    expect(isAuthExempt("/api/services/myservice/status")).toBe(false);
  });

  test("/call requires auth", () => {
    expect(isAuthExempt("/call")).toBe(false);
  });

  test("/shutdown requires auth", () => {
    expect(isAuthExempt("/shutdown")).toBe(false);
  });
});

describe("ConfigManager API operations", () => {
  let tmpDir: string;
  let configPath: string;
  let mgr: ConfigManager;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "mcp2cli-api-test-"));
    configPath = join(tmpDir, "services.json");
    const initial = makeConfig({ echo: STDIO_SERVICE });
    await Bun.write(configPath, JSON.stringify(initial, null, 2));
    mgr = new ConfigManager(initial, configPath);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  test("full CRUD lifecycle", async () => {
    // List: starts with echo
    const initial = mgr.getServices();
    expect(Object.keys(initial.services)).toEqual(["echo"]);

    // Add: new stdio service
    await mgr.addService("cat", {
      backend: "stdio",
      command: "/bin/cat",
      args: [],
      env: {},
    });
    expect(mgr.serviceNames).toContain("cat");
    expect(mgr.serviceNames).toContain("echo");

    // Update: change command
    await mgr.updateService("cat", {
      backend: "stdio",
      command: "/usr/bin/cat",
      args: ["-n"],
      env: {},
    });
    const updated = mgr.getService("cat");
    expect((updated as typeof STDIO_SERVICE).command).toBe("/usr/bin/cat");

    // Remove
    await mgr.removeService("cat");
    expect(mgr.getService("cat")).toBeNull();
    expect(mgr.serviceNames).toEqual(["echo"]);

    // Verify final disk state
    const onDisk = await Bun.file(configPath).json();
    expect(Object.keys(onDisk.services)).toEqual(["echo"]);
  });

  test("add rejects invalid backend", async () => {
    expect(
      mgr.addService("bad", { backend: "ftp", url: "ftp://localhost" }),
    ).rejects.toThrow();
  });

  test("add rejects stdio without command", async () => {
    expect(
      mgr.addService("bad", { backend: "stdio" }),
    ).rejects.toThrow();
  });

  test("add rejects http without url", async () => {
    expect(
      mgr.addService("bad", { backend: "http" }),
    ).rejects.toThrow();
  });

  test("add service with http backend", async () => {
    await mgr.addService("web", {
      backend: "http",
      url: "http://localhost:8080/sse",
      headers: { Authorization: "Bearer test" },
    });
    const svc = mgr.getService("web");
    expect(svc).not.toBeNull();
    expect(svc!.backend).toBe("http");
  });

  test("add service with websocket backend", async () => {
    await mgr.addService("ws", {
      backend: "websocket",
      url: "ws://localhost:9090",
      headers: {},
    });
    const svc = mgr.getService("ws");
    expect(svc).not.toBeNull();
    expect(svc!.backend).toBe("websocket");
  });

  test("sanitized export strips env, headers, URL credentials, and sensitive args", async () => {
    const exportConfig = makeConfig({
      local: {
        backend: "stdio",
        command: "/usr/bin/env",
        source: "local",
        args: [
          "--api-key",
          "do-not-export",
          "--header",
          "Authorization: Bearer do-not-export",
          "Cookie: session=do-not-export",
          "--mode=ok",
        ],
        env: { SECRET_TOKEN: "do-not-export" },
      },
      remote: {
        backend: "http",
        url: "http://user:pass@example.test/mcp?token=do-not-export#frag",
        headers: { Authorization: "Bearer do-not-export" },
        fallback: {
          command: "/usr/bin/env",
          args: ["--api-key=do-not-export", "--safe", "value"],
          env: { API_KEY: "do-not-export" },
        },
      },
    });
    exportConfig.importUrl = "https://user:pass@example.test/export?token=do-not-export#frag";
    exportConfig.importTtlSeconds = 3600;
    const exportMgr = new ConfigManager(exportConfig, configPath);
    const pool = new ConnectionPool();
    const server = createDaemonServer({
      listenConfig: { mode: "unix", socketPath: join(tmpDir, "export.sock") },
      pool,
      config: exportConfig,
      configManager: exportMgr,
      idleTimer: new IdleTimer(60000, () => {}),
      onShutdown: () => {},
      authProvider: new TokenAuthProvider([]),
      metrics: new MetricsCollector(),
    });

    try {
      const res = await server.fetch(
        new Request("http://localhost/api/services/export", { method: "GET" }),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as ServicesConfig;
      expect("importUrl" in body).toBe(false);
      expect("importTtlSeconds" in body).toBe(false);
      const local = body.services.local!;
      expect(local.backend).toBe("stdio");
      if (local.backend === "stdio") {
        expect(local.source).toBe("remote");
        expect(local.args).toEqual([
          "--api-key",
          "[REDACTED]",
          "--header",
          "[REDACTED]",
          "[REDACTED]",
          "--mode=ok",
        ]);
        expect(local.env).toEqual({});
      }
      const remote = body.services.remote!;
      expect(remote.backend).toBe("http");
      if (remote.backend === "http") {
        expect(remote.url).toBe("http://example.test/mcp");
        expect(remote.headers).toEqual({});
        expect(remote.fallback).toEqual({ command: "/usr/bin/env", args: ["--api-key=[REDACTED]", "--safe", "value"], env: {} });
      }
    } finally {
      server.stop(true);
      await pool.closeAll();
    }
  });
});

describe("Auth refresh API", () => {
  let tmpDir: string;
  let tokensPath: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "mcp2cli-auth-api-test-"));
    tokensPath = join(tmpDir, "tokens.json");
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  test("POST /api/auth/refresh rotates a valid near-expiry token", async () => {
    const now = Date.now();
    await Bun.write(tokensPath, JSON.stringify({
      tokens: [{
        id: "skippy",
        token: "old-token",
        role: "agent",
        expiresAt: new Date(now + 5 * 60 * 1000).toISOString(),
      }],
    }));
    process.env.MCP2CLI_TOKEN_REFRESH_WINDOW_MS = String(10 * 60 * 1000);
    process.env.MCP2CLI_TOKEN_TTL_MS = String(60 * 60 * 1000);

    const pool = new ConnectionPool();
    const authProvider = await TokenAuthProvider.load(tokensPath);
    const server = createDaemonServer({
      listenConfig: { mode: "unix", socketPath: join(tmpDir, "auth-refresh.sock") },
      pool,
      config: makeConfig({ echo: STDIO_SERVICE }),
      idleTimer: new IdleTimer(60000, () => {}),
      onShutdown: () => {},
      authProvider,
      metrics: new MetricsCollector(),
    });

    try {
      const res = await server.fetch(
        new Request("http://localhost/api/auth/refresh", {
          method: "POST",
          headers: { Authorization: "Bearer old-token" },
        }),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { success: boolean; token: string; userId: string; role: string };
      expect(body.success).toBe(true);
      expect(body.token).not.toBe("old-token");
      expect(body.userId).toBe("skippy");
      expect(body.role).toBe("agent");

      const meOld = await server.fetch(
        new Request("http://localhost/api/auth/me", {
          method: "GET",
          headers: { Authorization: "Bearer old-token" },
        }),
      );
      expect(meOld.status).toBe(401);

      const meNew = await server.fetch(
        new Request("http://localhost/api/auth/me", {
          method: "GET",
          headers: { Authorization: `Bearer ${body.token}` },
        }),
      );
      expect(meNew.status).toBe(200);
    } finally {
      delete process.env.MCP2CLI_TOKEN_REFRESH_WINDOW_MS;
      delete process.env.MCP2CLI_TOKEN_TTL_MS;
      server.stop(true);
      await pool.closeAll();
    }
  });
});
