import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  writeCache,
  readCacheRaw,
  readCacheFingerprint,
  fingerprintSchemas,
  mapToolsToCachedSchemas,
} from "../../src/cache/index.ts";
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

// Real round-trip: the daemon (raw upstream tools, missing descriptions ->
// hashToolSchema's "" default) and the client warm path (descriptions defaulted
// to "(no description)") must derive the SAME fingerprint for the same tools.
// This is the regression guard for the swarm-found blockers (B1: key alignment,
// B2: description-default divergence) -- both manifested as "fingerprints never
// match -> reconcile clears on every call."
describe("daemon/client fingerprint convergence (#58 blocker regression)", () => {
  test("identical upstream tools -> identical fingerprint despite description defaulting + reconcile keeps cache", async () => {
    // Daemon side: raw MCP tools, one with NO description (undefined).
    const rawTools = [
      { name: "ob_search", description: "Search", inputSchema: {} },
      { name: "ob_no_desc", inputSchema: {} }, // missing description
    ];
    const daemonSchemas = await mapToolsToCachedSchemas(rawTools);
    // Daemon writes the BARE service key (what the drift-hook maintains and what
    // the daemon now stamps), letting writeCache derive the fingerprint.
    await writeCache("open-brain", daemonSchemas, 60_000);
    const daemonFingerprint = await readCacheFingerprint("open-brain");
    if (!daemonFingerprint) throw new Error("daemon fingerprint not written");

    // Client warm path: the same tools, but descriptions already defaulted to
    // "(no description)" (as getToolSchemaCached does) before hashing.
    const clientSchemas = await mapToolsToCachedSchemas([
      { name: "ob_search", description: "Search", inputSchema: {} },
      { name: "ob_no_desc", description: "(no description)", inputSchema: {} },
    ]);
    const clientFingerprint = (await fingerprintSchemas(clientSchemas));

    // The fix: both derive the SAME fingerprint for the same tools.
    expect(clientFingerprint).toBe(daemonFingerprint);

    // And therefore reconcile against the daemon's stamp must NOT clear.
    await writeCache("open-brain", clientSchemas, 60_000);
    await reconcileClientCache("open-brain", okResponse(daemonFingerprint));
    expect(await readCacheRaw("open-brain")).not.toBeNull();
  });
});
