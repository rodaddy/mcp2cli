import { afterEach, describe, test, expect, mock } from "bun:test";
import {
  hasSecretRefs,
  resolveServiceSecretRefs,
  SecretResolutionError,
  VaultwardenSecretResolver,
} from "../../src/secrets/index.ts";
import type { SecretResolver } from "../../src/secrets/index.ts";
import type { ServiceConfig } from "../../src/config/index.ts";
import { resolve } from "node:path";

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
  const originalCommand = process.env.MCP2CLI_VAULTWARDEN_COMMAND;
  const originalArgs = process.env.MCP2CLI_VAULTWARDEN_COMMAND_ARGS;
  const originalTimeout = process.env.MCP2CLI_VAULTWARDEN_TIMEOUT_MS;

  afterEach(() => {
    if (originalCommand !== undefined) {
      process.env.MCP2CLI_VAULTWARDEN_COMMAND = originalCommand;
    } else {
      delete process.env.MCP2CLI_VAULTWARDEN_COMMAND;
    }
    if (originalArgs !== undefined) {
      process.env.MCP2CLI_VAULTWARDEN_COMMAND_ARGS = originalArgs;
    } else {
      delete process.env.MCP2CLI_VAULTWARDEN_COMMAND_ARGS;
    }
    if (originalTimeout !== undefined) {
      process.env.MCP2CLI_VAULTWARDEN_TIMEOUT_MS = originalTimeout;
    } else {
      delete process.env.MCP2CLI_VAULTWARDEN_TIMEOUT_MS;
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
