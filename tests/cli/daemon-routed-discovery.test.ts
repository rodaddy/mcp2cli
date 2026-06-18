import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { join } from "node:path";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { readCacheRaw } from "../../src/cache/index.ts";

const listToolsViaDaemon = mock(async () => ({
  success: true,
  result: [
    { name: "search_all", description: "Search Open Brain memory." },
    { name: "append_session_event", description: "Append a process event." },
  ],
}));

const getSchemaViaDaemon = mock(async ({ tool }: { service: string; tool: string }) => ({
  success: true,
  result: {
    tool,
    description: `${tool} full description`,
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
      },
    },
    usage: `mcp2cli open-brain ${tool}`,
  },
}));

mock.module("../../src/cli/commands/daemon-schema-client.ts", () => ({
  listToolsViaDaemon,
  getSchemaViaDaemon,
}));

mock.module("../../src/connection/http-transport.ts", () => ({
  connectToHttpService: mock(async () => {
    throw new Error("direct HTTP transport should not be used");
  }),
}));

mock.module("../../src/connection/websocket-transport.ts", () => ({
  connectToWebSocketService: mock(async () => {
    throw new Error("direct websocket transport should not be used");
  }),
}));

mock.module("../../src/connection/client.ts", () => ({
  connectToService: mock(async () => {
    throw new Error("direct stdio transport should not be used");
  }),
}));

describe("daemon-routed schema discovery commands", () => {
  let testDir: string;
  let originalConfig: string | undefined;
  let originalCacheDir: string | undefined;
  let originalSkillsDir: string | undefined;
  let originalNoDaemon: string | undefined;

  beforeEach(async () => {
    listToolsViaDaemon.mockClear();
    getSchemaViaDaemon.mockClear();

    testDir = await mkdtemp(join(tmpdir(), "mcp2cli-daemon-discovery-test-"));
    await mkdir(join(testDir, "skills"), { recursive: true });
    const configPath = join(testDir, "services.json");
    await Bun.write(configPath, JSON.stringify({
      services: {
        "open-brain": {
          backend: "http",
          url: "http://10.71.1.21:3100/mcp",
          description: "Open Brain",
        },
      },
    }));

    originalConfig = process.env.MCP2CLI_CONFIG;
    originalCacheDir = process.env.MCP2CLI_CACHE_DIR;
    originalSkillsDir = process.env.PAI_SKILLS_DIR;
    originalNoDaemon = process.env.MCP2CLI_NO_DAEMON;
    process.env.MCP2CLI_CONFIG = configPath;
    process.env.MCP2CLI_CACHE_DIR = join(testDir, "cache");
    process.env.PAI_SKILLS_DIR = join(testDir, "skills");
    delete process.env.MCP2CLI_NO_DAEMON;
    process.exitCode = 0;
  });

  afterEach(async () => {
    restoreEnv("MCP2CLI_CONFIG", originalConfig);
    restoreEnv("MCP2CLI_CACHE_DIR", originalCacheDir);
    restoreEnv("PAI_SKILLS_DIR", originalSkillsDir);
    restoreEnv("MCP2CLI_NO_DAEMON", originalNoDaemon);
    process.exitCode = 0;
    await rm(testDir, { recursive: true, force: true });
  });

  test("cache warm uses daemon-routed discovery and writes cache", async () => {
    const { handleCache } = await import("../../src/cli/commands/cache.ts");
    const output = await captureOutput(() => handleCache(["warm", "open-brain"]));

    expect(output.stderr).not.toContain("direct HTTP transport should not be used");
    expect(output.stdout).toContain("open-brain: 2 tools cached");
    expect(listToolsViaDaemon).toHaveBeenCalledWith({ service: "open-brain" });
    expect(getSchemaViaDaemon).toHaveBeenCalledTimes(2);

    const cached = await readCacheRaw("open-brain");
    expect(cached?.tools.map((tool) => tool.name).sort()).toEqual([
      "append_session_event",
      "search_all",
    ]);
  });

  test("cache diff refreshes live schemas through daemon-routed discovery", async () => {
    const { writeCache } = await import("../../src/cache/index.ts");
    await writeCache("open-brain", [{
      name: "search_all",
      description: "old",
      inputSchema: { type: "object" },
      hash: "old-hash",
    }]);

    const { handleCache } = await import("../../src/cli/commands/cache.ts");
    const output = await captureOutput(() => handleCache(["diff", "open-brain"]));

    expect(output.stdout).toContain('Schema drift detected for "open-brain"');
    expect(listToolsViaDaemon).toHaveBeenCalledWith({ service: "open-brain" });
    expect(getSchemaViaDaemon).toHaveBeenCalledTimes(2);
  });

  test("generate-skills dry run uses daemon-routed discovery", async () => {
    const { handleGenerateSkills } = await import("../../src/cli/commands/generate-skills.ts");
    const output = await captureOutput(() => handleGenerateSkills(["open-brain", "--dry-run"]));

    expect(output.stderr).not.toContain("direct HTTP transport should not be used");
    expect(listToolsViaDaemon).toHaveBeenCalledWith({ service: "open-brain" });
    expect(getSchemaViaDaemon).toHaveBeenCalledTimes(2);
    expect(JSON.parse(output.stdout)).toMatchObject({
      dryRun: true,
      service: "open-brain",
    });
  });
});

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

async function captureOutput(fn: () => Promise<void>): Promise<{ stdout: string; stderr: string }> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (...args: unknown[]) => stdout.push(args.map(String).join(" "));
  console.error = (...args: unknown[]) => stderr.push(args.map(String).join(" "));
  try {
    await fn();
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
  return {
    stdout: stdout.join("\n"),
    stderr: stderr.join("\n"),
  };
}
