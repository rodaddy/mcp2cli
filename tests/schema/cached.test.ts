import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { writeCache } from "../../src/cache/storage.ts";
import type { CachedToolSchema } from "../../src/cache/types.ts";
import { listToolsCached, getToolSchemaCached, resolveToolNameCached } from "../../src/schema/cached.ts";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";

let testDir: string;
let origCacheDir: string | undefined;

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), "mcp2cli-cached-test-"));
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

function makeTool(name: string, desc = `Tool ${name}`): CachedToolSchema {
  return {
    name,
    description: desc,
    inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
    hash: `hash_${name}`,
  };
}

function makeMockClient(tools: { name: string; description?: string; inputSchema: object }[]): Client {
  return {
    listTools: async () => ({ tools }),
  } as unknown as Client;
}

describe("listToolsCached", () => {
  test("returns cached tools on cache hit, sorted alphabetically", async () => {
    await writeCache("test-svc", [makeTool("search"), makeTool("list")]);

    const mockClient = makeMockClient([]);
    const result = await listToolsCached(mockClient, "test-svc");

    expect(result).toHaveLength(2);
    expect(result[0]!.name).toBe("list");
    expect(result[1]!.name).toBe("search");
  });

  test("falls back to live client on cache miss", async () => {
    const liveTools = [
      { name: "live_tool", description: "From live", inputSchema: { type: "object", properties: {} } },
    ];
    const mockClient = makeMockClient(liveTools);

    const result = await listToolsCached(mockClient, "uncached-svc");

    expect(result).toHaveLength(1);
    expect(result[0]!.name).toBe("live_tool");
  });

  test("falls back to live on expired cache", async () => {
    await writeCache("expired-svc", [makeTool("old_tool")], 1);
    await new Promise((r) => setTimeout(r, 5));

    const liveTools = [
      { name: "new_tool", description: "Fresh", inputSchema: { type: "object", properties: {} } },
    ];
    const mockClient = makeMockClient(liveTools);

    const result = await listToolsCached(mockClient, "expired-svc");

    expect(result).toHaveLength(1);
    expect(result[0]!.name).toBe("new_tool");
  });
});

describe("getToolSchemaCached", () => {
  test("returns cached schema on hit", async () => {
    await writeCache("test-svc", [makeTool("search_brain", "Search the brain")]);

    const mockClient = makeMockClient([]);
    const result = await getToolSchemaCached(mockClient, "search_brain", "test-svc");

    expect(result).not.toBeNull();
    expect(result!.tool).toBe("search_brain");
    expect(result!.description).toBe("Search the brain");
    expect(result!.inputSchema).toEqual({
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    });
    expect(result!.usage).toContain("mcp2cli test-svc search_brain");
  });

  test("resolves prefixed tool names from cache", async () => {
    await writeCache("ob", [makeTool("ob_search_brain")]);

    const mockClient = makeMockClient([]);
    const result = await getToolSchemaCached(mockClient, "search_brain", "ob");

    expect(result).not.toBeNull();
    expect(result!.tool).toBe("ob_search_brain");
  });

  test("returns null for unknown tool even with cached service", async () => {
    await writeCache("test-svc", [makeTool("exists")]);

    const mockClient = makeMockClient([]);
    const result = await getToolSchemaCached(mockClient, "nonexistent", "test-svc");

    expect(result).toBeNull();
  });

  test("falls back to live on cache miss", async () => {
    const liveTools = [
      { name: "live_tool", description: "Live desc", inputSchema: { type: "object", properties: {} } },
    ];
    const mockClient = makeMockClient(liveTools);

    const result = await getToolSchemaCached(mockClient, "live_tool", "uncached-svc");

    expect(result).not.toBeNull();
    expect(result!.tool).toBe("live_tool");
  });
});

describe("resolveToolNameCached", () => {
  test("resolves exact match from cache", async () => {
    await writeCache("svc", [makeTool("do_thing")]);

    const mockClient = makeMockClient([]);
    const { resolvedName } = await resolveToolNameCached(mockClient, "do_thing", "svc");

    expect(resolvedName).toBe("do_thing");
  });

  test("resolves prefixed name from cache", async () => {
    await writeCache("n8n", [makeTool("n8n_list_workflows")]);

    const mockClient = makeMockClient([]);
    const { resolvedName } = await resolveToolNameCached(mockClient, "list_workflows", "n8n");

    expect(resolvedName).toBe("n8n_list_workflows");
  });

  test("returns original name when no match found", async () => {
    await writeCache("svc", [makeTool("other_tool")]);

    const mockClient = makeMockClient([]);
    const { resolvedName } = await resolveToolNameCached(mockClient, "unknown", "svc");

    expect(resolvedName).toBe("unknown");
  });

  test("falls back to live client on cache miss", async () => {
    const liveTools = [
      { name: "svc_real_tool", description: "Real", inputSchema: { type: "object", properties: {} } },
    ];
    const mockClient = makeMockClient(liveTools);

    const { resolvedName } = await resolveToolNameCached(mockClient, "real_tool", "svc");

    expect(resolvedName).toBe("svc_real_tool");
  });
});
