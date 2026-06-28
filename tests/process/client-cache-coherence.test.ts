import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { writeCache, readCacheRaw } from "../../src/cache/index.ts";
import { reconcileClientCache } from "../../src/process/client.ts";
import type { DaemonResponse } from "../../src/daemon/types.ts";

// #58: when a daemon response carries a schemaFingerprint that differs from the
// client's locally-cached fingerprint, the client must drop its stale cache so
// the next read refetches. These tests exercise reconcileClientCache directly,
// independent of daemon routing/transport.

let testCacheDir: string;
let origCacheDir: string | undefined;

const FRESH_FINGERPRINT = "f".repeat(64);

function tool(name: string, hash: string) {
  return { name, description: `d-${name}`, inputSchema: {}, hash };
}

function okResponse(schemaFingerprint?: string): DaemonResponse {
  return { success: true, result: [], schemaFingerprint };
}

beforeEach(async () => {
  testCacheDir = await mkdtemp(join(tmpdir(), "mcp2cli-coherence-"));
  origCacheDir = process.env.MCP2CLI_CACHE_DIR;
  process.env.MCP2CLI_CACHE_DIR = testCacheDir;
});

afterEach(async () => {
  if (origCacheDir !== undefined) process.env.MCP2CLI_CACHE_DIR = origCacheDir;
  else delete process.env.MCP2CLI_CACHE_DIR;
  await rm(testCacheDir, { recursive: true, force: true });
});

describe("reconcileClientCache (#58 piggyback)", () => {
  test("drops the stale local cache when the daemon fingerprint differs", async () => {
    await writeCache("open-brain", [tool("old", "h1")], 60_000, "stale-fp");
    await reconcileClientCache("open-brain", okResponse(FRESH_FINGERPRINT));
    expect(await readCacheRaw("open-brain")).toBeNull();
  });

  test("keeps the local cache when the fingerprint matches", async () => {
    await writeCache("open-brain", [tool("t", "h1")], 60_000, FRESH_FINGERPRINT);
    await reconcileClientCache("open-brain", okResponse(FRESH_FINGERPRINT));
    expect(await readCacheRaw("open-brain")).not.toBeNull();
  });

  test("does nothing when the response carries no fingerprint", async () => {
    await writeCache("open-brain", [tool("t", "h1")], 60_000, "local-fp");
    await reconcileClientCache("open-brain", okResponse(undefined));
    expect(await readCacheRaw("open-brain")).not.toBeNull();
  });

  test("does nothing on a cold cache (no local fingerprint to compare)", async () => {
    // No cache entry written -> nothing to invalidate, must not throw.
    await reconcileClientCache("open-brain", okResponse(FRESH_FINGERPRINT));
    expect(await readCacheRaw("open-brain")).toBeNull();
  });

  test("ignores error responses", async () => {
    await writeCache("open-brain", [tool("t", "h1")], 60_000, "local-fp");
    const errResponse: DaemonResponse = {
      success: false,
      error: { code: "CONNECTION_ERROR", message: "down" },
    };
    await reconcileClientCache("open-brain", errResponse);
    expect(await readCacheRaw("open-brain")).not.toBeNull();
  });
});
