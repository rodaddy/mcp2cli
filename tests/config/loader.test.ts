import { describe, test, expect, afterEach } from "bun:test";
import { resolve } from "path";
import { tmpdir } from "os";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { loadConfig, mergeImportedConfig } from "../../src/config/loader.ts";
import { ConfigError } from "../../src/config/errors.ts";
import type { ServicesConfig } from "../../src/config/index.ts";

const FIXTURES_DIR = resolve(import.meta.dir, "../fixtures");

afterEach(() => {
  delete process.env.MCP2CLI_CONFIG;
  delete process.env.MCP2CLI_IMPORT_TOKEN;
  delete process.env.MCP2CLI_IMPORT_ALLOW_HTTP;
  delete process.env.MCP2CLI_IMPORT_ALLOW_PRIVATE;
  delete process.env.MCP2CLI_IMPORT_ALLOWED_HOSTS;
});

describe("loadConfig", () => {
  test("valid config file loads and returns typed ServicesConfig", async () => {
    process.env.MCP2CLI_CONFIG = resolve(FIXTURES_DIR, "valid-config.json");
    const config = await loadConfig();
    expect(config.services).toBeDefined();
    const n8n = config.services["n8n"];
    expect(n8n).toBeDefined();
    expect(n8n!.backend).toBe("stdio");
    if (n8n && n8n.backend === "stdio") {
      expect(n8n.command).toBe("npx");
    }
  });

  test("missing config file throws ConfigError with CONFIG_NOT_FOUND", async () => {
    process.env.MCP2CLI_CONFIG = resolve(
      tmpdir(),
      "nonexistent-mcp2cli-config-12345.json",
    );
    try {
      await loadConfig();
      throw new Error("Expected ConfigError to be thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      if (err instanceof ConfigError) {
        expect(err.code).toBe("CONFIG_NOT_FOUND");
        expect(err.message).toContain("not found");
      }
    }
  });

  test("invalid JSON file throws ConfigError with CONFIG_PARSE_ERROR", async () => {
    process.env.MCP2CLI_CONFIG = resolve(FIXTURES_DIR, "invalid-not-json.txt");
    await expect(loadConfig()).rejects.toThrow(ConfigError);
  });

  test("schema violation throws ConfigError with CONFIG_VALIDATION_ERROR", async () => {
    process.env.MCP2CLI_CONFIG = resolve(
      FIXTURES_DIR,
      "invalid-empty-services.json",
    );
    try {
      await loadConfig();
      throw new Error("Expected ConfigError to be thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      if (err instanceof ConfigError) {
        expect(err.code).toBe("CONFIG_VALIDATION_ERROR");
      }
    }
  });

  test("MCP2CLI_CONFIG env var overrides default path", async () => {
    // Write a temp config file to a custom location
    const customPath = resolve(tmpdir(), `mcp2cli-test-${Date.now()}.json`);
    await Bun.write(
      customPath,
      JSON.stringify({
        services: {
          test: {
            backend: "stdio",
            command: "echo",
            args: ["hello"],
          },
        },
      }),
    );

    process.env.MCP2CLI_CONFIG = customPath;
    const config = await loadConfig();
    const testSvc = config.services["test"];
    expect(testSvc).toBeDefined();
    expect(testSvc!.backend).toBe("stdio");

    // Clean up temp file
    const { unlink } = await import("fs/promises");
    await unlink(customPath).catch(() => {});
  });

  test("importUrl merges remote services when local file is stale", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mcp2cli-import-test-"));
    const configPath = join(dir, "services.json");
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/api/services/export") {
          return Response.json({
            services: {
              remote: {
                backend: "http",
                url: "http://ct216.example/mcp",
                source: "remote",
              },
            },
          });
        }
        return new Response("Not Found", { status: 404 });
      },
    });
    try {
      process.env.MCP2CLI_IMPORT_ALLOW_HTTP = "1";
      process.env.MCP2CLI_IMPORT_ALLOW_PRIVATE = "1";
      process.env.MCP2CLI_IMPORT_ALLOWED_HOSTS = "localhost";
      await Bun.write(
        configPath,
        JSON.stringify({
          importUrl: `http://localhost:${server.port}/api/services/export`,
          importTtlSeconds: 0,
          services: {
            local: {
              backend: "stdio",
              command: "echo",
            },
          },
        }),
      );

      const config = await loadConfig(configPath);
      expect(Object.keys(config.services).sort()).toEqual(["local", "remote"]);
      expect(config.services.remote?.source).toBe("remote");
    } finally {
      server.stop(true);
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("importUrl failure keeps local config", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mcp2cli-import-fail-test-"));
    const configPath = join(dir, "services.json");
    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response("nope", { status: 500 });
      },
    });
    try {
      process.env.MCP2CLI_IMPORT_ALLOW_HTTP = "1";
      process.env.MCP2CLI_IMPORT_ALLOW_PRIVATE = "1";
      process.env.MCP2CLI_IMPORT_ALLOWED_HOSTS = "localhost";
      await Bun.write(
        configPath,
        JSON.stringify({
          importUrl: `http://localhost:${server.port}/api/services/export`,
          importTtlSeconds: 0,
          services: {
            local: {
              backend: "stdio",
              command: "echo",
            },
          },
        }),
      );

      const config = await loadConfig(configPath);
      expect(Object.keys(config.services)).toEqual(["local"]);
    } finally {
      server.stop(true);
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("importUrl imports on first load when ttl is not explicitly set", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mcp2cli-import-default-test-"));
    const configPath = join(dir, "services.json");
    const server = Bun.serve({
      port: 0,
      fetch() {
        return Response.json({
          services: {
            remote: {
              backend: "http",
              url: "http://ct216.example/mcp",
            },
          },
        });
      },
    });
    try {
      process.env.MCP2CLI_IMPORT_ALLOW_HTTP = "1";
      process.env.MCP2CLI_IMPORT_ALLOW_PRIVATE = "1";
      process.env.MCP2CLI_IMPORT_ALLOWED_HOSTS = "localhost";
      await Bun.write(
        configPath,
        JSON.stringify({
          importUrl: `http://localhost:${server.port}/api/services/export`,
          services: {
            local: {
              backend: "stdio",
              command: "echo",
            },
          },
        }),
      );

      const config = await loadConfig(configPath);
      expect(Object.keys(config.services).sort()).toEqual(["local", "remote"]);
    } finally {
      server.stop(true);
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("explicit positive import ttl skips fresh local file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mcp2cli-import-ttl-test-"));
    const configPath = join(dir, "services.json");
    let requests = 0;
    const server = Bun.serve({
      port: 0,
      fetch() {
        requests++;
        return Response.json({
          services: {
            remote: {
              backend: "http",
              url: "http://ct216.example/mcp",
            },
          },
        });
      },
    });
    try {
      process.env.MCP2CLI_IMPORT_ALLOW_HTTP = "1";
      process.env.MCP2CLI_IMPORT_ALLOW_PRIVATE = "1";
      process.env.MCP2CLI_IMPORT_ALLOWED_HOSTS = "localhost";
      await Bun.write(
        configPath,
        JSON.stringify({
          importUrl: `http://localhost:${server.port}/api/services/export`,
          importTtlSeconds: 3600,
          services: {
            local: {
              backend: "stdio",
              command: "echo",
            },
          },
        }),
      );

      const config = await loadConfig(configPath);
      expect(Object.keys(config.services).sort()).toEqual(["local", "remote"]);
      const secondLoad = await loadConfig(configPath);
      expect(Object.keys(secondLoad.services).sort()).toEqual(["local", "remote"]);
      expect(requests).toBe(1);
    } finally {
      server.stop(true);
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("cached import state still requires current importUrl policy", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mcp2cli-import-cache-policy-test-"));
    const configPath = join(dir, "services.json");
    const server = Bun.serve({
      port: 0,
      fetch() {
        return Response.json({
          services: {
            remote: {
              backend: "http",
              url: "http://ct216.example/mcp",
            },
          },
        });
      },
    });
    try {
      process.env.MCP2CLI_IMPORT_ALLOW_HTTP = "1";
      process.env.MCP2CLI_IMPORT_ALLOW_PRIVATE = "1";
      process.env.MCP2CLI_IMPORT_ALLOWED_HOSTS = "localhost";
      await Bun.write(
        configPath,
        JSON.stringify({
          importUrl: `http://localhost:${server.port}/api/services/export`,
          importTtlSeconds: 3600,
          services: { local: { backend: "stdio", command: "echo" } },
        }),
      );

      const first = await loadConfig(configPath);
      expect(Object.keys(first.services).sort()).toEqual(["local", "remote"]);

      delete process.env.MCP2CLI_IMPORT_ALLOWED_HOSTS;
      const second = await loadConfig(configPath);
      expect(Object.keys(second.services)).toEqual(["local"]);
    } finally {
      server.stop(true);
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("importUrl sends bearer token when MCP2CLI_IMPORT_TOKEN is set", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mcp2cli-import-auth-test-"));
    const configPath = join(dir, "services.json");
    let authHeader: string | null = null;
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        authHeader = req.headers.get("authorization");
        return Response.json({
          services: {
            remote: {
              backend: "http",
              url: "http://ct216.example/mcp",
            },
          },
        });
      },
    });
    try {
      process.env.MCP2CLI_IMPORT_ALLOW_HTTP = "1";
      process.env.MCP2CLI_IMPORT_ALLOW_PRIVATE = "1";
      process.env.MCP2CLI_IMPORT_ALLOWED_HOSTS = "localhost";
      process.env.MCP2CLI_IMPORT_TOKEN = "import-token";
      await Bun.write(
        configPath,
        JSON.stringify({
          importUrl: `http://localhost:${server.port}/api/services/export`,
          importTtlSeconds: 0,
          services: {
            local: {
              backend: "stdio",
              command: "echo",
            },
          },
        }),
      );

      await loadConfig(configPath);
      expect(authHeader as string | null).toBe("Bearer import-token");
    } finally {
      server.stop(true);
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("importUrl token requires an explicit host allowlist", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mcp2cli-import-auth-allowlist-test-"));
    const configPath = join(dir, "services.json");
    let requests = 0;
    const server = Bun.serve({
      port: 0,
      fetch() {
        requests++;
        return Response.json({ services: { remote: { backend: "http", url: "http://ct216.example/mcp" } } });
      },
    });
    try {
      process.env.MCP2CLI_IMPORT_ALLOW_HTTP = "1";
      process.env.MCP2CLI_IMPORT_ALLOW_PRIVATE = "1";
      process.env.MCP2CLI_IMPORT_TOKEN = "import-token";
      await Bun.write(
        configPath,
        JSON.stringify({
          importUrl: `http://localhost:${server.port}/api/services/export`,
          importTtlSeconds: 0,
          services: { local: { backend: "stdio", command: "echo" } },
        }),
      );

      const config = await loadConfig(configPath);
      expect(Object.keys(config.services)).toEqual(["local"]);
      expect(requests).toBe(0);
    } finally {
      server.stop(true);
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("importUrl strips bearer token on cross-origin redirects", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mcp2cli-import-redirect-test-"));
    const configPath = join(dir, "services.json");
    let redirectedAuthHeader: string | null = null;
    const target = Bun.serve({
      port: 0,
      fetch(req) {
        redirectedAuthHeader = req.headers.get("authorization");
        return Response.json({ services: { remote: { backend: "http", url: "http://ct216.example/mcp" } } });
      },
    });
    const origin = Bun.serve({
      port: 0,
      fetch() {
        return new Response(null, {
          status: 302,
          headers: { Location: `http://127.0.0.1:${target.port}/api/services/export` },
        });
      },
    });
    try {
      process.env.MCP2CLI_IMPORT_ALLOW_HTTP = "1";
      process.env.MCP2CLI_IMPORT_ALLOW_PRIVATE = "1";
      process.env.MCP2CLI_IMPORT_ALLOWED_HOSTS = "localhost,127.0.0.1";
      process.env.MCP2CLI_IMPORT_TOKEN = "import-token";
      await Bun.write(
        configPath,
        JSON.stringify({
          importUrl: `http://localhost:${origin.port}/api/services/export`,
          importTtlSeconds: 0,
          services: { local: { backend: "stdio", command: "echo" } },
        }),
      );

      const config = await loadConfig(configPath);
      expect(Object.keys(config.services).sort()).toEqual(["local", "remote"]);
      expect(redirectedAuthHeader as string | null).toBeNull();
    } finally {
      origin.stop(true);
      target.stop(true);
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("importUrl does not send general daemon auth token", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mcp2cli-import-no-leak-test-"));
    const configPath = join(dir, "services.json");
    let authHeader: string | null = null;
    const originalAuth = process.env.MCP2CLI_AUTH_TOKEN;
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        authHeader = req.headers.get("authorization");
        return Response.json({ services: { remote: { backend: "http", url: "http://ct216.example/mcp" } } });
      },
    });
    try {
      process.env.MCP2CLI_IMPORT_ALLOW_HTTP = "1";
      process.env.MCP2CLI_IMPORT_ALLOW_PRIVATE = "1";
      process.env.MCP2CLI_IMPORT_ALLOWED_HOSTS = "localhost";
      process.env.MCP2CLI_AUTH_TOKEN = "daemon-token";
      await Bun.write(
        configPath,
        JSON.stringify({
          importUrl: `http://localhost:${server.port}/api/services/export`,
          importTtlSeconds: 0,
          services: { local: { backend: "stdio", command: "echo" } },
        }),
      );

      await loadConfig(configPath);
      expect(authHeader as string | null).toBeNull();
    } finally {
      if (originalAuth === undefined) {
        delete process.env.MCP2CLI_AUTH_TOKEN;
      } else {
        process.env.MCP2CLI_AUTH_TOKEN = originalAuth;
      }
      server.stop(true);
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("importUrl blocks private hosts unless explicitly allowed", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mcp2cli-import-private-test-"));
    const configPath = join(dir, "services.json");
    try {
      process.env.MCP2CLI_IMPORT_ALLOW_HTTP = "1";
      await Bun.write(
        configPath,
        JSON.stringify({
          importUrl: "http://localhost:65535/api/services/export",
          importTtlSeconds: 0,
          services: { local: { backend: "stdio", command: "echo" } },
        }),
      );

      const config = await loadConfig(configPath);
      expect(Object.keys(config.services)).toEqual(["local"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("importUrl blocks IPv4-mapped IPv6 loopback hosts", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mcp2cli-import-mapped-ipv6-test-"));
    const configPath = join(dir, "services.json");
    try {
      process.env.MCP2CLI_IMPORT_ALLOW_HTTP = "1";
      process.env.MCP2CLI_IMPORT_ALLOWED_HOSTS = "[::ffff:7f00:1]";
      await Bun.write(
        configPath,
        JSON.stringify({
          importUrl: "http://[::ffff:127.0.0.1]:65535/api/services/export",
          importTtlSeconds: 0,
          services: { local: { backend: "stdio", command: "echo" } },
        }),
      );

      const config = await loadConfig(configPath);
      expect(Object.keys(config.services)).toEqual(["local"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("importUrl blocks DNS hosts unless explicitly allowed", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mcp2cli-import-dns-test-"));
    const configPath = join(dir, "services.json");
    try {
      process.env.MCP2CLI_IMPORT_ALLOWED_HOSTS = "example.com";
      await Bun.write(
        configPath,
        JSON.stringify({
          importUrl: "https://example.com/api/services/export",
          importTtlSeconds: 0,
          services: { local: { backend: "stdio", command: "echo" } },
        }),
      );

      const config = await loadConfig(configPath);
      expect(Object.keys(config.services)).toEqual(["local"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("mergeImportedConfig", () => {
  test("imported service wins and source comes from imported config", () => {
    const local = {
      services: {
        shared: {
          backend: "stdio",
          command: "old",
          args: [],
          env: {},
          source: "local",
        },
      },
    } satisfies ServicesConfig;
    const imported = {
      services: {
        shared: {
          backend: "http",
          url: "http://ct216.example/mcp",
          headers: {},
          source: "remote",
        },
      },
    } satisfies ServicesConfig;

    const merged = mergeImportedConfig(local, imported);
    const shared = merged.services.shared!;
    expect(shared.backend).toBe("http");
    expect(shared.source).toBe("remote");
  });

  test("imported services default to remote source", () => {
    const local = {
      services: {
        local: {
          backend: "stdio",
          command: "echo",
          args: [],
          env: {},
        },
      },
    } satisfies ServicesConfig;
    const imported = {
      services: {
        remote: {
          backend: "stdio",
          command: "remote-command",
          args: [],
          env: {},
        },
      },
    } satisfies ServicesConfig;

    const merged = mergeImportedConfig(local, imported);
    expect(merged.services.remote?.source).toBe("remote");
  });
});
