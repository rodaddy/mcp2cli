import { afterEach, describe, expect, test } from "bun:test";
import { shouldRouteMissingServiceToRemote } from "../../src/cli/commands/remote-routing.ts";
import { clearRemoteServiceCache } from "../../src/process/remote-discovery.ts";

describe("shouldRouteMissingServiceToRemote", () => {
  const originalUrl = process.env.MCP2CLI_REMOTE_URL;
  const originalTtl = process.env.MCP2CLI_REMOTE_SERVICE_CACHE_TTL_MS;

  afterEach(() => {
    clearRemoteServiceCache();
    if (originalUrl === undefined) {
      delete process.env.MCP2CLI_REMOTE_URL;
    } else {
      process.env.MCP2CLI_REMOTE_URL = originalUrl;
    }
    if (originalTtl === undefined) {
      delete process.env.MCP2CLI_REMOTE_SERVICE_CACHE_TTL_MS;
    } else {
      process.env.MCP2CLI_REMOTE_SERVICE_CACHE_TTL_MS = originalTtl;
    }
  });

  test("does not route without daemon mode", async () => {
    await expect(shouldRouteMissingServiceToRemote("missing", false)).resolves.toBe(false);
  });

  test("does not route when no remote is configured", async () => {
    delete process.env.MCP2CLI_REMOTE_URL;
    await expect(shouldRouteMissingServiceToRemote("missing", true)).resolves.toBe(false);
  });

  test("routes only when discovery positively hosts the service", async () => {
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/api/services/discovery") {
          return Response.json({ success: true, configuredServices: ["hosted"] });
        }
        return new Response("Not Found", { status: 404 });
      },
    });
    try {
      process.env.MCP2CLI_REMOTE_URL = `http://localhost:${server.port}`;
      process.env.MCP2CLI_REMOTE_SERVICE_CACHE_TTL_MS = "0";
      clearRemoteServiceCache();
      await expect(shouldRouteMissingServiceToRemote("hosted", true)).resolves.toBe(true);
      await expect(shouldRouteMissingServiceToRemote("missing", true)).resolves.toBe(false);
    } finally {
      server.stop(true);
    }
  });

  test("does not route on discovery failure", async () => {
    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response("temporary failure", { status: 500 });
      },
    });
    try {
      process.env.MCP2CLI_REMOTE_URL = `http://localhost:${server.port}`;
      process.env.MCP2CLI_REMOTE_SERVICE_CACHE_TTL_MS = "0";
      clearRemoteServiceCache();
      await expect(shouldRouteMissingServiceToRemote("missing", true)).resolves.toBe(false);
    } finally {
      server.stop(true);
    }
  });
});
