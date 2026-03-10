import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  readCache,
  readCacheRaw,
  writeCache,
  clearCache,
  listCachedServices,
  isCacheExpired,
  getCacheDir,
  getCacheFilePath,
} from "../../src/cache/storage.ts";
import type { CacheMetadata, CachedToolSchema } from "../../src/cache/types.ts";

// -- Test setup --

let testDir: string;
let origCacheDir: string | undefined;

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), "mcp2cli-cache-test-"));
  origCacheDir = process.env.MCP2CLI_CACHE_DIR;
  process.env.MCP2CLI_CACHE_DIR = testDir;
});

afterEach(async () => {
  if (origCacheDir !== undefined) {
    process.env.MCP2CLI_CACHE_DIR = origCacheDir;
  } else {
    delete process.env.MCP2CLI_CACHE_DIR;
  }
  await rm(testDir, { recursive: true, force: true });
});

function makeTool(name: string, hash: string = "abc123"): CachedToolSchema {
  return {
    name,
    description: `Test tool ${name}`,
    inputSchema: { type: "object", properties: {} },
    hash,
  };
}

// -- getCacheDir / getCacheFilePath --

describe("getCacheDir", () => {
  test("uses MCP2CLI_CACHE_DIR when set", () => {
    process.env.MCP2CLI_CACHE_DIR = "/custom/cache/dir";
    expect(getCacheDir()).toBe("/custom/cache/dir");
    process.env.MCP2CLI_CACHE_DIR = testDir; // restore for cleanup
  });

  test("falls back to HOME-based path", () => {
    delete process.env.MCP2CLI_CACHE_DIR;
    const home = process.env.HOME;
    expect(getCacheDir()).toBe(join(home!, ".cache", "mcp2cli", "schemas"));
    process.env.MCP2CLI_CACHE_DIR = testDir; // restore for cleanup
  });
});

describe("getCacheFilePath", () => {
  test("returns path with service name and .json extension", () => {
    const path = getCacheFilePath("n8n");
    expect(path).toBe(join(testDir, "n8n.json"));
  });
});

// -- writeCache / readCache --

describe("writeCache + readCache", () => {
  test("round-trips tools through cache", async () => {
    const tools = [makeTool("tool_a"), makeTool("tool_b")];
    await writeCache("test-svc", tools);

    const cached = await readCache("test-svc");
    expect(cached).not.toBeNull();
    expect(cached!.tools).toHaveLength(2);
    expect(cached!.tools[0]!.name).toBe("tool_a");
    expect(cached!.tools[1]!.name).toBe("tool_b");
  });

  test("metadata includes service name and timestamp", async () => {
    await writeCache("my-svc", [makeTool("t1")]);
    const cached = await readCache("my-svc");
    expect(cached!.metadata.service).toBe("my-svc");
    expect(cached!.metadata.toolCount).toBe(1);
    expect(cached!.metadata.cachedAt).toBeTruthy();
  });

  test("uses custom TTL when provided", async () => {
    const customTtl = 60_000; // 1 minute
    await writeCache("svc", [makeTool("t")], customTtl);
    const cached = await readCache("svc");
    expect(cached!.metadata.ttlMs).toBe(customTtl);
  });

  test("returns null for nonexistent service", async () => {
    const result = await readCache("nonexistent");
    expect(result).toBeNull();
  });

  test("returns null for expired cache", async () => {
    // Write with 1ms TTL -- will be expired immediately
    await writeCache("expiring", [makeTool("t")], 1);
    // Wait a tiny bit to ensure expiry
    await new Promise((r) => setTimeout(r, 5));
    const result = await readCache("expiring");
    expect(result).toBeNull();
  });

  test("readCacheRaw returns even expired entries", async () => {
    await writeCache("expired-svc", [makeTool("t")], 1);
    await new Promise((r) => setTimeout(r, 5));

    // readCache should return null (expired)
    expect(await readCache("expired-svc")).toBeNull();

    // readCacheRaw should still return the entry
    const raw = await readCacheRaw("expired-svc");
    expect(raw).not.toBeNull();
    expect(raw!.tools[0]!.name).toBe("t");
  });
});

// -- isCacheExpired --

describe("isCacheExpired", () => {
  test("returns false for fresh cache", () => {
    const meta: CacheMetadata = {
      service: "test",
      cachedAt: new Date().toISOString(),
      ttlMs: 24 * 60 * 60 * 1000,
      toolCount: 1,
    };
    expect(isCacheExpired(meta)).toBe(false);
  });

  test("returns true for old cache", () => {
    const staleTime = new Date(Date.now() - 25 * 60 * 60 * 1000); // 25 hours ago
    const meta: CacheMetadata = {
      service: "test",
      cachedAt: staleTime.toISOString(),
      ttlMs: 24 * 60 * 60 * 1000,
      toolCount: 1,
    };
    expect(isCacheExpired(meta)).toBe(true);
  });

  test("respects custom TTL", () => {
    const recentTime = new Date(Date.now() - 500); // 500ms ago
    const meta: CacheMetadata = {
      service: "test",
      cachedAt: recentTime.toISOString(),
      ttlMs: 1000, // 1 second TTL
      toolCount: 1,
    };
    expect(isCacheExpired(meta)).toBe(false);
  });
});

// -- clearCache --

describe("clearCache", () => {
  test("clears specific service cache", async () => {
    await writeCache("svc-a", [makeTool("t1")]);
    await writeCache("svc-b", [makeTool("t2")]);

    const cleared = await clearCache("svc-a");
    expect(cleared).toBe(1);

    // svc-a should be gone
    expect(await readCache("svc-a")).toBeNull();
    // svc-b should remain
    expect(await readCache("svc-b")).not.toBeNull();
  });

  test("clears all caches when no service specified", async () => {
    await writeCache("svc-1", [makeTool("t1")]);
    await writeCache("svc-2", [makeTool("t2")]);
    await writeCache("svc-3", [makeTool("t3")]);

    const cleared = await clearCache();
    expect(cleared).toBe(3);

    expect(await readCache("svc-1")).toBeNull();
    expect(await readCache("svc-2")).toBeNull();
    expect(await readCache("svc-3")).toBeNull();
  });

  test("returns 0 when clearing nonexistent service", async () => {
    const cleared = await clearCache("nonexistent");
    expect(cleared).toBe(0);
  });

  test("returns 0 when cache directory does not exist", async () => {
    process.env.MCP2CLI_CACHE_DIR = join(testDir, "nonexistent-subdir");
    const cleared = await clearCache();
    expect(cleared).toBe(0);
  });
});

// -- listCachedServices --

describe("listCachedServices", () => {
  test("returns empty array when no caches exist", async () => {
    const services = await listCachedServices();
    expect(services).toHaveLength(0);
  });

  test("returns service names from cache files", async () => {
    await writeCache("alpha", [makeTool("t")]);
    await writeCache("beta", [makeTool("t")]);

    const services = await listCachedServices();
    expect(services.sort()).toEqual(["alpha", "beta"]);
  });
});
