import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { getRemoteConfig } from "../../src/daemon/paths.ts";
import { checkRemoteHealth } from "../../src/process/liveness.ts";
import {
  clearRemoteServiceCache,
  getRemoteServiceAvailability,
  getRemoteServiceNames,
} from "../../src/process/remote-discovery.ts";
import {
  callViaDaemon,
  clearClientConfigCache,
  clearLocalTokenCache,
  resolveSource,
} from "../../src/process/client.ts";
import { createDaemonServer } from "../../src/daemon/server.ts";
import { ConnectionPool } from "../../src/daemon/pool.ts";
import { IdleTimer } from "../../src/daemon/idle.ts";
import { MetricsCollector } from "../../src/daemon/metrics.ts";
import { join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import type { AuthProvider } from "../../src/daemon/auth-provider.ts";

describe("getRemoteConfig", () => {
  const originalUrl = process.env.MCP2CLI_REMOTE_URL;
  const originalToken = process.env.MCP2CLI_AUTH_TOKEN;

  afterEach(() => {
    // Restore original env
    if (originalUrl !== undefined) {
      process.env.MCP2CLI_REMOTE_URL = originalUrl;
    } else {
      delete process.env.MCP2CLI_REMOTE_URL;
    }
    if (originalToken !== undefined) {
      process.env.MCP2CLI_AUTH_TOKEN = originalToken;
    } else {
      delete process.env.MCP2CLI_AUTH_TOKEN;
    }
  });

  test("returns null when MCP2CLI_REMOTE_URL is not set", () => {
    delete process.env.MCP2CLI_REMOTE_URL;
    delete process.env.MCP2CLI_AUTH_TOKEN;
    const result = getRemoteConfig();
    expect(result).toBeNull();
  });

  test("returns config when MCP2CLI_REMOTE_URL is set", () => {
    process.env.MCP2CLI_REMOTE_URL = "http://10.0.0.5:9500";
    delete process.env.MCP2CLI_AUTH_TOKEN;
    const result = getRemoteConfig();
    expect(result).toEqual({
      url: "http://10.0.0.5:9500",
      token: undefined,
    });
  });

  test("returns config with token when both env vars set", () => {
    process.env.MCP2CLI_REMOTE_URL = "http://10.0.0.5:9500";
    process.env.MCP2CLI_AUTH_TOKEN = "test-secret-token";
    const result = getRemoteConfig();
    expect(result).toEqual({
      url: "http://10.0.0.5:9500",
      token: "test-secret-token",
    });
  });
});

describe("checkRemoteHealth", () => {
  let server: ReturnType<typeof Bun.serve>;
  let baseUrl: string;

  beforeEach(() => {
    server = Bun.serve({
      port: 0, // random available port
      fetch(req) {
        const url = new URL(req.url);

        if (url.pathname === "/health") {
          // Check auth if token header present
          const auth = req.headers.get("authorization");
          if (auth === "Bearer bad-token") {
            return new Response(JSON.stringify({ error: "unauthorized" }), {
              status: 401,
            });
          }
          return Response.json({
            status: "ok",
            uptime: 1234,
            services: 3,
          });
        }

        return new Response("Not Found", { status: 404 });
      },
    });
    baseUrl = `http://localhost:${server.port}`;
  });

  afterEach(() => {
    server.stop(true);
  });

  test("returns ok with data for healthy server", async () => {
    const result = await checkRemoteHealth(baseUrl, undefined);
    expect(result.status).toBe("ok");
    expect(result.data).toEqual({
      status: "ok",
      uptime: 1234,
      services: 3,
    });
  });

  test("returns ok with token auth", async () => {
    const result = await checkRemoteHealth(baseUrl, "valid-token");
    expect(result.status).toBe("ok");
    expect(result.data).toBeDefined();
  });

  test("returns unreachable for non-existent server", async () => {
    const result = await checkRemoteHealth("http://127.0.0.1:1", undefined);
    expect(result.status).toBe("unreachable");
    expect(result.data).toBeUndefined();
  });

  test("handles trailing slash in URL", async () => {
    const result = await checkRemoteHealth(`${baseUrl}/`, undefined);
    expect(result.status).toBe("ok");
  });
});

describe("remote service discovery", () => {
  const originalUrl = process.env.MCP2CLI_REMOTE_URL;
  const originalToken = process.env.MCP2CLI_AUTH_TOKEN;
  const originalTtl = process.env.MCP2CLI_REMOTE_SERVICE_CACHE_TTL_MS;
  let server: ReturnType<typeof Bun.serve>;
  let baseUrl: string;

  beforeEach(() => {
    clearRemoteServiceCache();
    process.env.MCP2CLI_REMOTE_SERVICE_CACHE_TTL_MS = "0";
    server = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/api/services/discovery") {
          return Response.json({
            success: true,
            version: "0.3.3",
            configuredServices: ["yt-dlp", "stealth-browser"],
          });
        }
        return new Response("Not Found", { status: 404 });
      },
    });
    baseUrl = `http://localhost:${server.port}`;
    process.env.MCP2CLI_REMOTE_URL = baseUrl;
    delete process.env.MCP2CLI_AUTH_TOKEN;
  });

  afterEach(() => {
    server.stop(true);
    clearRemoteServiceCache();
    if (originalUrl !== undefined) {
      process.env.MCP2CLI_REMOTE_URL = originalUrl;
    } else {
      delete process.env.MCP2CLI_REMOTE_URL;
    }
    if (originalToken !== undefined) {
      process.env.MCP2CLI_AUTH_TOKEN = originalToken;
    } else {
      delete process.env.MCP2CLI_AUTH_TOKEN;
    }
    if (originalTtl !== undefined) {
      process.env.MCP2CLI_REMOTE_SERVICE_CACHE_TTL_MS = originalTtl;
    } else {
      delete process.env.MCP2CLI_REMOTE_SERVICE_CACHE_TTL_MS;
    }
  });

  test("lists remote configured services from authenticated daemon discovery", async () => {
    await expect(getRemoteServiceNames()).resolves.toEqual([
      "yt-dlp",
      "stealth-browser",
    ]);
  });

  test("distinguishes hosted and non-hosted services", async () => {
    await expect(getRemoteServiceAvailability("yt-dlp")).resolves.toBe(
      "hosted",
    );
    await expect(getRemoteServiceAvailability("king-secrets")).resolves.toBe(
      "not-hosted",
    );
  });

  test("returns no-remote without MCP2CLI_REMOTE_URL", async () => {
    delete process.env.MCP2CLI_REMOTE_URL;
    clearRemoteServiceCache();
    await expect(getRemoteServiceAvailability("yt-dlp")).resolves.toBe(
      "no-remote",
    );
  });

  test("does not cache failed discovery snapshots", async () => {
    let fail = true;
    server.stop(true);
    clearRemoteServiceCache();
    server = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/api/services/discovery") {
          if (fail) {
            fail = false;
            return new Response("temporary failure", { status: 500 });
          }
          return Response.json({
            success: true,
            configuredServices: ["recovered"],
          });
        }
        return new Response("Not Found", { status: 404 });
      },
    });
    process.env.MCP2CLI_REMOTE_URL = `http://localhost:${server.port}`;
    process.env.MCP2CLI_REMOTE_SERVICE_CACHE_TTL_MS = "60000";

    await expect(getRemoteServiceAvailability("recovered")).resolves.toBe(
      "unknown",
    );
    await expect(getRemoteServiceAvailability("recovered")).resolves.toBe(
      "hosted",
    );
  });
});

describe("remote-aware source resolution", () => {
  const originalUrl = process.env.MCP2CLI_REMOTE_URL;
  const originalConfig = process.env.MCP2CLI_CONFIG;
  const originalTtl = process.env.MCP2CLI_REMOTE_SERVICE_CACHE_TTL_MS;
  const originalRemoteRequestTimeout = process.env.MCP2CLI_REMOTE_REQUEST_TIMEOUT_MS;
  const originalRemoteFallbackTimeout = process.env.MCP2CLI_REMOTE_FALLBACK_TIMEOUT_MS;
  const originalRemoteFallbackRetries = process.env.MCP2CLI_REMOTE_FALLBACK_RETRIES;
  const originalPidFile = process.env.MCP2CLI_PID_FILE;
  const originalSocketPath = process.env.MCP2CLI_SOCKET_PATH;
  const originalAuthToken = process.env.MCP2CLI_AUTH_TOKEN;
  const originalMcpToken = process.env.MCP_TOKEN;
  let server: ReturnType<typeof Bun.serve>;
  let testDir: string;
  let configPath: string;
  const disabledAuthProvider: AuthProvider = {
    enabled: false,
    authenticate: () => null,
  };

  beforeEach(async () => {
    clearRemoteServiceCache();
    clearClientConfigCache();
    process.env.MCP2CLI_REMOTE_SERVICE_CACHE_TTL_MS = "0";
    testDir = await mkdtemp(join(tmpdir(), "mcp2cli-remote-source-test-"));
    configPath = join(testDir, "services.json");
    server = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/api/services/discovery") {
          return Response.json({
            success: true,
            configuredServices: ["remote-only", "hosted-local"],
          });
        }
        return new Response("Not Found", { status: 404 });
      },
    });
    process.env.MCP2CLI_REMOTE_URL = `http://localhost:${server.port}`;
    process.env.MCP2CLI_CONFIG = configPath;
  });

  afterEach(async () => {
    server.stop(true);
    clearRemoteServiceCache();
    clearClientConfigCache();
    await rm(testDir, { recursive: true, force: true });
    if (originalUrl !== undefined) {
      process.env.MCP2CLI_REMOTE_URL = originalUrl;
    } else {
      delete process.env.MCP2CLI_REMOTE_URL;
    }
    if (originalConfig !== undefined) {
      process.env.MCP2CLI_CONFIG = originalConfig;
    } else {
      delete process.env.MCP2CLI_CONFIG;
    }
    if (originalTtl !== undefined) {
      process.env.MCP2CLI_REMOTE_SERVICE_CACHE_TTL_MS = originalTtl;
    } else {
      delete process.env.MCP2CLI_REMOTE_SERVICE_CACHE_TTL_MS;
    }
    if (originalRemoteRequestTimeout !== undefined) {
      process.env.MCP2CLI_REMOTE_REQUEST_TIMEOUT_MS = originalRemoteRequestTimeout;
    } else {
      delete process.env.MCP2CLI_REMOTE_REQUEST_TIMEOUT_MS;
    }
    if (originalRemoteFallbackTimeout !== undefined) {
      process.env.MCP2CLI_REMOTE_FALLBACK_TIMEOUT_MS = originalRemoteFallbackTimeout;
    } else {
      delete process.env.MCP2CLI_REMOTE_FALLBACK_TIMEOUT_MS;
    }
    if (originalRemoteFallbackRetries !== undefined) {
      process.env.MCP2CLI_REMOTE_FALLBACK_RETRIES = originalRemoteFallbackRetries;
    } else {
      delete process.env.MCP2CLI_REMOTE_FALLBACK_RETRIES;
    }
    if (originalPidFile !== undefined) {
      process.env.MCP2CLI_PID_FILE = originalPidFile;
    } else {
      delete process.env.MCP2CLI_PID_FILE;
    }
    if (originalSocketPath !== undefined) {
      process.env.MCP2CLI_SOCKET_PATH = originalSocketPath;
    } else {
      delete process.env.MCP2CLI_SOCKET_PATH;
    }
    if (originalAuthToken !== undefined) {
      process.env.MCP2CLI_AUTH_TOKEN = originalAuthToken;
    } else {
      delete process.env.MCP2CLI_AUTH_TOKEN;
    }
    if (originalMcpToken !== undefined) {
      process.env.MCP_TOKEN = originalMcpToken;
    } else {
      delete process.env.MCP_TOKEN;
    }
    clearLocalTokenCache();
  });

  async function writeServices(
    services: Record<string, unknown>,
  ): Promise<void> {
    await Bun.write(configPath, JSON.stringify({ services }, null, 2));
    clearClientConfigCache();
  }

  test("uses remote for remote-only services discovered via authenticated discovery", async () => {
    await writeServices({
      local: { backend: "stdio", command: "echo" },
    });
    await expect(resolveSource("remote-only")).resolves.toBe("remote");
  });

  test("uses local when the remote daemon does not host an unpinned local service", async () => {
    await writeServices({
      local: { backend: "stdio", command: "echo" },
    });
    await expect(resolveSource("local")).resolves.toBe("local");
  });

  test("uses local for configured services when remote discovery is unavailable", async () => {
    server.stop(true);
    clearRemoteServiceCache();
    await writeServices({
      local: { backend: "stdio", command: "echo" },
    });
    await expect(resolveSource("local")).resolves.toBe("local");
  });

  test("explicit source wins over platform and remote discovery inference", async () => {
    await writeServices({
      local: {
        backend: "stdio",
        command: "echo",
        source: "remote-local",
        platforms: ["plan9"],
      },
    });
    await expect(resolveSource("local")).resolves.toBe("remote-local");
  });

  test("requiresCredentials service does not fall back to local on remote connection error", async () => {
    server.stop(true);
    server = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/call") {
          return Response.json({
            success: false,
            error: {
              code: "CONNECTION_ERROR",
              message:
                "Failed to connect to HTTP MCP server: SSE error: Non-200 status code (401)",
            },
          });
        }
        if (url.pathname === "/api/services/discovery") {
          return Response.json({
            success: true,
            configuredServices: ["open-brain"],
          });
        }
        return new Response("Not Found", { status: 404 });
      },
    });
    process.env.MCP2CLI_REMOTE_URL = `http://localhost:${server.port}`;
    await writeServices({
      "open-brain": {
        backend: "http",
        url: "http://local-open-brain.example/mcp",
        source: "remote-local",
        requiresCredentials: true,
      },
    });

    const result = await callViaDaemon({
      service: "open-brain",
      tool: "session_start",
      params: {},
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toContain("remote daemon");
      expect(result.error.message).not.toContain("local daemon");
      expect(result.error.message).toContain("401");
    }
  });

  test("honors remote request timeout override for hosted tool calls", async () => {
    server.stop(true);
    let remoteCalls = 0;
    server = Bun.serve({
      port: 0,
      async fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/call") {
          remoteCalls += 1;
          await new Promise((resolve) => setTimeout(resolve, 50));
          return Response.json({ success: true, result: { ok: true } });
        }
        if (url.pathname === "/api/services/discovery") {
          return Response.json({
            success: true,
            configuredServices: ["slow-remote"],
          });
        }
        return new Response("Not Found", { status: 404 });
      },
    });
    process.env.MCP2CLI_REMOTE_URL = `http://localhost:${server.port}`;
    await writeServices({
      "slow-remote": {
        backend: "stdio",
        command: "echo",
        source: "remote",
      },
    });

    process.env.MCP2CLI_REMOTE_REQUEST_TIMEOUT_MS = "10";
    const timedOut = await callViaDaemon({
      service: "slow-remote",
      tool: "wait",
      params: {},
    });
    expect(timedOut.success).toBe(false);
    if (!timedOut.success) {
      expect(timedOut.error.code).toBe("CONNECTION_ERROR");
      expect(timedOut.error.message).toContain("timed out");
    }
    expect(remoteCalls).toBe(3);

    process.env.MCP2CLI_REMOTE_REQUEST_TIMEOUT_MS = "250";
    remoteCalls = 0;
    const succeeded = await callViaDaemon({
      service: "slow-remote",
      tool: "wait",
      params: {},
    });
    expect(succeeded).toEqual({ success: true, result: { ok: true } });
    expect(remoteCalls).toBe(1);
  });

  test("uses short fallback timeout for remote-local services", async () => {
    server.stop(true);
    const localSocketPath = join(testDir, "local-daemon.sock");
    const localPidFile = join(testDir, "local-daemon.pid");
    await Bun.write(localPidFile, String(process.pid));
    process.env.MCP2CLI_PID_FILE = localPidFile;
    process.env.MCP2CLI_SOCKET_PATH = localSocketPath;
    delete process.env.MCP2CLI_AUTH_TOKEN;
    delete process.env.MCP_TOKEN;
    clearLocalTokenCache();

    const localPool = new ConnectionPool();
    const localServer = createDaemonServer({
      listenConfig: { mode: "unix", socketPath: localSocketPath },
      pool: localPool,
      config: { services: {} },
      idleTimer: new IdleTimer(60000, () => {}),
      onShutdown: () => {},
      authProvider: disabledAuthProvider,
      metrics: new MetricsCollector(),
    });

    let remoteCalls = 0;
    server = Bun.serve({
      port: 0,
      async fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/call") {
          remoteCalls += 1;
          await new Promise((resolve) => setTimeout(resolve, 50));
          return Response.json({ success: true, result: { ok: true } });
        }
        if (url.pathname === "/api/services/discovery") {
          return Response.json({
            success: true,
            configuredServices: ["fallback-sensitive"],
          });
        }
        return new Response("Not Found", { status: 404 });
      },
    });
    process.env.MCP2CLI_REMOTE_URL = `http://localhost:${server.port}`;
    await writeServices({
      "fallback-sensitive": {
        backend: "http",
        url: "http://local-fallback.example/mcp",
        source: "remote-local",
      },
    });

    try {
      process.env.MCP2CLI_REMOTE_REQUEST_TIMEOUT_MS = "250";
      process.env.MCP2CLI_REMOTE_FALLBACK_TIMEOUT_MS = "10";
      delete process.env.MCP2CLI_REMOTE_FALLBACK_RETRIES;
      const result = await callViaDaemon({
        service: "fallback-sensitive",
        tool: "wait",
        params: {},
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("CONNECTION_ERROR");
        expect(result.error.message).toContain(
          "Service not found in config: fallback-sensitive",
        );
        expect(result.error.message).not.toContain("remote daemon");
      }
      expect(remoteCalls).toBe(1);
    } finally {
      localServer.stop(true);
      await localPool.closeAll();
    }
  });

  test("platforms prefer local when current OS is allowed", async () => {
    await writeServices({
      local: {
        backend: "stdio",
        command: "echo",
        platforms: [process.platform],
      },
    });
    await expect(resolveSource("local")).resolves.toBe("local");
  });

  test("platforms prefer remote when current OS is not allowed", async () => {
    await writeServices({
      local: {
        backend: "stdio",
        command: "echo",
        platforms: ["not-this-platform"],
      },
    });
    await expect(resolveSource("local")).resolves.toBe("local");
  });

  test("platforms use remote only when unsupported service is hosted remotely", async () => {
    await writeServices({
      "hosted-local": {
        backend: "stdio",
        command: "echo",
        platforms: ["not-this-platform"],
      },
    });
    await expect(resolveSource("hosted-local")).resolves.toBe("remote");
  });
});
