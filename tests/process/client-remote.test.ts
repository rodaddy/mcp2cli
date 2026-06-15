import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { getRemoteConfig } from "../../src/daemon/paths.ts";
import { checkRemoteHealth } from "../../src/process/liveness.ts";
import {
  clearRemoteServiceCache,
  getRemoteServiceAvailability,
  getRemoteServiceNames,
} from "../../src/process/remote-discovery.ts";
import { clearClientConfigCache, resolveSource } from "../../src/process/client.ts";
import { join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";

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
    await expect(getRemoteServiceNames()).resolves.toEqual(["yt-dlp", "stealth-browser"]);
  });

  test("distinguishes hosted and non-hosted services", async () => {
    await expect(getRemoteServiceAvailability("yt-dlp")).resolves.toBe("hosted");
    await expect(getRemoteServiceAvailability("king-secrets")).resolves.toBe("not-hosted");
  });

  test("returns no-remote without MCP2CLI_REMOTE_URL", async () => {
    delete process.env.MCP2CLI_REMOTE_URL;
    clearRemoteServiceCache();
    await expect(getRemoteServiceAvailability("yt-dlp")).resolves.toBe("no-remote");
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

    await expect(getRemoteServiceAvailability("recovered")).resolves.toBe("unknown");
    await expect(getRemoteServiceAvailability("recovered")).resolves.toBe("hosted");
  });
});

describe("remote-aware source resolution", () => {
  const originalUrl = process.env.MCP2CLI_REMOTE_URL;
  const originalConfig = process.env.MCP2CLI_CONFIG;
  const originalTtl = process.env.MCP2CLI_REMOTE_SERVICE_CACHE_TTL_MS;
  let server: ReturnType<typeof Bun.serve>;
  let testDir: string;
  let configPath: string;

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
  });

  async function writeServices(services: Record<string, unknown>): Promise<void> {
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
