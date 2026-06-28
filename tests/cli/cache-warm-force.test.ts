import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { handleCache } from "../../src/cli/commands/cache.ts";
import { writeCache, getCacheFilePath } from "../../src/cache/storage.ts";

// Verifies the `cache warm --force` argument handling: the flag is recognized,
// it does not interfere with positional service extraction, and (for a service
// that fails to connect) the stale entry is cleared before the refetch attempt
// -- the documented recovery after an upstream contract bump.

let testCacheDir: string;
let testConfigPath: string;
let origCacheDir: string | undefined;
let origConfig: string | undefined;
let origNoDaemon: string | undefined;

beforeEach(async () => {
  testCacheDir = await mkdtemp(join(tmpdir(), "mcp2cli-warm-force-cache-"));
  const cfgDir = await mkdtemp(join(tmpdir(), "mcp2cli-warm-force-cfg-"));
  testConfigPath = join(cfgDir, "services.json");

  origCacheDir = process.env.MCP2CLI_CACHE_DIR;
  origConfig = process.env.MCP2CLI_CONFIG;
  origNoDaemon = process.env.MCP2CLI_NO_DAEMON;
  process.env.MCP2CLI_CACHE_DIR = testCacheDir;
  process.env.MCP2CLI_CONFIG = testConfigPath;
  // Use the direct path so the unreachable-service refetch fails fast with a
  // connection error rather than a 10s daemon-start timeout. This test is about
  // --force's clear-before-refetch behavior, not daemon routing.
  process.env.MCP2CLI_NO_DAEMON = "1";

  // A service that will fail to connect quickly (unreachable URL), so warm
  // exercises the clear-then-fetch path without a real daemon.
  await writeFile(
    testConfigPath,
    JSON.stringify({
      services: {
        "dead-svc": {
          backend: "http",
          url: "http://127.0.0.1:1/mcp",
        },
      },
    }),
  );
});

afterEach(async () => {
  if (origCacheDir !== undefined) process.env.MCP2CLI_CACHE_DIR = origCacheDir;
  else delete process.env.MCP2CLI_CACHE_DIR;
  if (origConfig !== undefined) process.env.MCP2CLI_CONFIG = origConfig;
  else delete process.env.MCP2CLI_CONFIG;
  if (origNoDaemon !== undefined) process.env.MCP2CLI_NO_DAEMON = origNoDaemon;
  else delete process.env.MCP2CLI_NO_DAEMON;
  await rm(testCacheDir, { recursive: true, force: true });
});

describe("cache warm --force", () => {
  test("clears the existing stale entry before refetching", async () => {
    // Seed a stale cache entry.
    await writeCache(
      "dead-svc",
      [
        {
          name: "old_tool",
          description: "stale",
          inputSchema: {},
          hash: "deadbeef",
        },
      ],
      60_000,
    );
    const cachePath = getCacheFilePath("dead-svc");
    expect(await Bun.file(cachePath).exists()).toBe(true);

    // warm --force: the refetch will fail (unreachable), but --force must have
    // already cleared the stale entry so the old schema can't be served.
    await handleCache(["warm", "dead-svc", "--force"]);

    expect(await Bun.file(cachePath).exists()).toBe(false);
  }, 40_000);

  test("without --force a failed refetch leaves the stale entry intact", async () => {
    await writeCache(
      "dead-svc",
      [
        {
          name: "old_tool",
          description: "stale",
          inputSchema: {},
          hash: "deadbeef",
        },
      ],
      60_000,
    );
    const cachePath = getCacheFilePath("dead-svc");

    await handleCache(["warm", "dead-svc"]);

    // No --force: the failed connect must not have touched the existing entry.
    expect(await Bun.file(cachePath).exists()).toBe(true);
  }, 40_000);

  test("--force flag is not treated as the service name", async () => {
    // `warm --force` (no positional service) should warm all configured
    // services, not error with `Unknown service: "--force"`.
    await handleCache(["warm", "--force"]);
    // dead-svc fails to connect, but the run completes without a validation
    // error about an unknown "--force" service.
    expect(process.exitCode).not.toBe(1); // EXIT_CODES.VALIDATION
  }, 40_000);
});
