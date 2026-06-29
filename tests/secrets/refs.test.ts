import { afterEach, describe, test, expect, mock } from "bun:test";
import {
  hasSecretRefs,
  resolveServiceSecretRefs,
  SecretResolutionError,
  VaultwardenSecretResolver,
} from "../../src/secrets/index.ts";
import type { SecretResolver } from "../../src/secrets/index.ts";
import type { ServiceConfig } from "../../src/config/index.ts";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

describe("secret refs", () => {
  test("detects nested secret refs", () => {
    expect(hasSecretRefs({ headers: { Authorization: "Bearer ${secret:token}" } })).toBe(true);
    expect(hasSecretRefs({ headers: { Authorization: "Bearer token" } })).toBe(false);
  });

  test("resolves secret refs in service config without mutating original", async () => {
    const resolver: SecretResolver = {
      resolve: mock(async (ref: string) => {
        if (ref === "open-brain#url") return "http://ct216.example/mcp";
        if (ref === "open-brain#token") return "resolved-token";
        throw new Error(`unexpected ref ${ref}`);
      }),
    };
    const service = {
      backend: "http",
      url: "${secret:open-brain#url}",
      headers: { Authorization: "Bearer ${secret:open-brain#token}" },
    } satisfies ServiceConfig;

    const resolved = await resolveServiceSecretRefs("open-brain", service, resolver);
    expect(resolved).toEqual({
      backend: "http",
      url: "http://ct216.example/mcp",
      headers: { Authorization: "Bearer resolved-token" },
    });
    expect(service.url).toBe("${secret:open-brain#url}");
  });

  test("throws on empty secret ref", async () => {
    const resolver: SecretResolver = { resolve: mock(async () => "unused") };
    const service = {
      backend: "stdio",
      command: "echo",
      args: ["${secret:}"],
      env: {},
    } satisfies ServiceConfig;
    await expect(resolveServiceSecretRefs("bad", service, resolver)).rejects.toThrow(SecretResolutionError);
  });

  test("resolves secret values containing replacement metacharacters literally", async () => {
    const resolver: SecretResolver = {
      resolve: mock(async () => "$&-$1-$$"),
    };
    const service = {
      backend: "stdio",
      command: "echo",
      args: ["value=${secret:literal}"],
      env: {},
    } satisfies ServiceConfig;

    const resolved = await resolveServiceSecretRefs("literal", service, resolver);
    expect(resolved.backend).toBe("stdio");
    if (resolved.backend === "stdio") {
      expect(resolved.args).toEqual(["value=$&-$1-$$"]);
    }
  });
});

describe("VaultwardenSecretResolver", () => {
  const envKeys = [
    "MCP2CLI_VAULTWARDEN_COMMAND",
    "MCP2CLI_VAULTWARDEN_COMMAND_ARGS",
    "MCP2CLI_VAULTWARDEN_TIMEOUT_MS",
    "MCP2CLI_VAULTWARDEN_REMOTE_URL",
    "MCP2CLI_VAULTWARDEN_AUTH_TOKEN",
    "MCP2CLI_VAULTWARDEN_USE_DAEMON",
    "MCP2CLI_VAULTWARDEN_ALLOW_REMOTE_AUTH",
    "MCP2CLI_AUTH_TOKEN",
    "MCP_TOKEN",
    ["MCP2CLI_REMOTE", "URL"].join("_"),
    "MCP_HOST",
    "MCP2CLI_TOKENS_FILE",
  ] as const;
  const originalEnv = new Map(envKeys.map((key) => [key, process.env[key]]));

  afterEach(() => {
    for (const key of envKeys) {
      const original = originalEnv.get(key);
      if (original !== undefined) {
        process.env[key] = original;
      } else {
        delete process.env[key];
      }
    }
  });

  test("extracts field paths from wrapped mcp2cli JSON output", async () => {
    process.env.MCP2CLI_VAULTWARDEN_COMMAND = Bun.argv[0]!;
    process.env.MCP2CLI_VAULTWARDEN_COMMAND_ARGS = JSON.stringify([
      "run",
      resolve(import.meta.dir, "../fixtures/mock-vaultwarden-command.ts"),
    ]);
    const resolver = new VaultwardenSecretResolver();
    const value = await resolver.resolve(
      `fixture#fields.token`,
    );
    expect(value).toBe("fixture-token");
  });

  test("clears MCP2CLI_DAEMON in the resolver subprocess (runs CLI, not a daemon)", async () => {
    // Regression: when the resolver runs INSIDE the daemon, the daemon's
    // MCP2CLI_DAEMON=1 is inherited via process.env; without clearing it the
    // spawned `mcp2cli vaultwarden-secrets` boots a daemon instead of resolving,
    // breaking every ${secret:...} ref in a stdio service's env.
    const originalDaemon = process.env.MCP2CLI_DAEMON;
    process.env.MCP2CLI_DAEMON = "1"; // simulate running inside the daemon
    process.env.MCP2CLI_VAULTWARDEN_COMMAND = Bun.argv[0]!;
    process.env.MCP2CLI_VAULTWARDEN_COMMAND_ARGS = JSON.stringify([
      "run",
      resolve(import.meta.dir, "../fixtures/mock-vaultwarden-command.ts"),
    ]);
    try {
      const resolver = new VaultwardenSecretResolver();
      const value = await resolver.resolve("daemon-env-check#fields.token");
      // The child must have seen MCP2CLI_DAEMON cleared, so it resolved normally
      // instead of booting a daemon.
      expect(value).toBe("resolved-not-as-daemon");
    } finally {
      if (originalDaemon !== undefined) process.env.MCP2CLI_DAEMON = originalDaemon;
      else delete process.env.MCP2CLI_DAEMON;
    }
  });

  test("uses hosted daemon HTTP path when configured", async () => {
    let sawAuth = false;
    const server = Bun.serve({
      port: 0,
      async fetch(req) {
        const url = new URL(req.url);
        expect(url.pathname).toBe("/call");
        sawAuth = req.headers.get("Authorization") === "Bearer test-token";

        const body = await req.json() as {
          service?: string;
          tool?: string;
          params?: { query?: string };
        };
        expect(body).toEqual({
          service: "vaultwarden-secrets",
          tool: "get_credential",
          params: { query: "hosted" },
        });

        return Response.json({
          success: true,
          result: { fields: { token: "hosted-token" } },
        });
      },
    });

    try {
      process.env.MCP2CLI_VAULTWARDEN_REMOTE_URL = `http://127.0.0.1:${server.port}`;
      process.env.MCP2CLI_AUTH_TOKEN = "test-token";
      const resolver = new VaultwardenSecretResolver();

      await expect(resolver.resolve("hosted#fields.token")).resolves.toBe("hosted-token");
      expect(sawAuth).toBe(true);
    } finally {
      server.stop(true);
    }
  });

  test("uses daemon token file for hosted daemon HTTP auth", async () => {
    let sawAuth = false;
    const tempDir = await mkdtemp(join(tmpdir(), "mcp2cli-refs-"));
    const tokensPath = join(tempDir, "tokens.json");
    await writeFile(tokensPath, JSON.stringify({
      tokens: [{ token: "file-token", role: "admin" }],
    }));

    const server = Bun.serve({
      port: 0,
      async fetch(req) {
        sawAuth = req.headers.get("Authorization") === "Bearer file-token";
        return Response.json({
          success: true,
          result: { fields: { token: "file-backed-token" } },
        });
      },
    });

    try {
      delete process.env.MCP2CLI_AUTH_TOKEN;
      delete process.env.MCP_TOKEN;
      delete process.env.MCP2CLI_VAULTWARDEN_AUTH_TOKEN;
      process.env.MCP2CLI_TOKENS_FILE = tokensPath;
      process.env.MCP2CLI_VAULTWARDEN_REMOTE_URL = `http://127.0.0.1:${server.port}`;
      const resolver = new VaultwardenSecretResolver();

      await expect(resolver.resolve("hosted#fields.token")).resolves.toBe("file-backed-token");
      expect(sawAuth).toBe(true);
    } finally {
      server.stop(true);
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("refuses to forward daemon auth to non-loopback remotes by default", async () => {
    process.env.MCP2CLI_VAULTWARDEN_REMOTE_URL = "https://vaultwarden.example.test";
    process.env.MCP2CLI_AUTH_TOKEN = "test-token";
    const resolver = new VaultwardenSecretResolver();

    await expect(resolver.resolve("hosted#fields.token")).rejects.toThrow(SecretResolutionError);
  });

  test("times out stalled Vaultwarden lookups", async () => {
    process.env.MCP2CLI_VAULTWARDEN_COMMAND = Bun.argv[0]!;
    process.env.MCP2CLI_VAULTWARDEN_COMMAND_ARGS = JSON.stringify([
      "run",
      resolve(import.meta.dir, "../fixtures/mock-vaultwarden-command.ts"),
    ]);
    process.env.MCP2CLI_VAULTWARDEN_TIMEOUT_MS = "25";
    const resolver = new VaultwardenSecretResolver();
    await expect(resolver.resolve("slow")).rejects.toThrow(SecretResolutionError);
  });
});
