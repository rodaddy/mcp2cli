import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { getRemoteConfig } from "../../src/daemon/paths.ts";
import { checkRemoteHealth } from "../../src/process/liveness.ts";

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
