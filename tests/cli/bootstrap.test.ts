import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Will be created in Task 1 implementation
import {
  readClaudeConfig,
  extractMcpServers,
  convertEntry,
  mergeEntries,
  handleBootstrap,
} from "../../src/cli/commands/bootstrap.ts";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "mcp2cli-bootstrap-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("readClaudeConfig", () => {
  test("returns null when file doesn't exist", async () => {
    const result = await readClaudeConfig(tempDir);
    expect(result).toBeNull();
  });

  test("returns parsed JSON for valid file", async () => {
    const config = { mcpServers: { test: { command: "echo" } } };
    await Bun.write(join(tempDir, ".claude.json"), JSON.stringify(config));
    const result = await readClaudeConfig(tempDir);
    expect(result).toEqual(config);
  });
});

describe("extractMcpServers", () => {
  test("extracts root-level entries", () => {
    const config = {
      mcpServers: {
        svc1: { command: "cmd1", args: [] },
        svc2: { command: "cmd2", args: ["--flag"] },
      },
    };
    const result = extractMcpServers(config);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ name: "svc1", entry: { command: "cmd1", args: [] } });
    expect(result[1]).toEqual({ name: "svc2", entry: { command: "cmd2", args: ["--flag"] } });
  });

  test("returns empty array when no mcpServers key", () => {
    const result = extractMcpServers({ someOtherKey: {} });
    expect(result).toEqual([]);
  });
});

describe("convertEntry", () => {
  test("converts stdio entry correctly", () => {
    const entry = { command: "node", args: ["server.js"], env: { PORT: "3000" } };
    const result = convertEntry("my-svc", entry);
    expect(result.name).toBe("my-svc");
    expect(result.config).toEqual({
      backend: "stdio",
      command: "node",
      args: ["server.js"],
      env: { PORT: "3000" },
    });
    expect(result.warning).toBeUndefined();
  });

  test("warns on HTTP entry", () => {
    const entry = { type: "http", url: "http://localhost:3000" };
    const result = convertEntry("http-svc", entry);
    expect(result.config).toBeUndefined();
    expect(result.warning).toContain("HTTP/SSE");
  });

  test("warns on SSE entry", () => {
    const entry = { type: "sse", url: "http://localhost:3000/sse" };
    const result = convertEntry("sse-svc", entry);
    expect(result.config).toBeUndefined();
    expect(result.warning).toContain("HTTP/SSE");
  });

  test("warns on entry with url field (no type)", () => {
    const entry = { url: "http://localhost:3000" };
    const result = convertEntry("url-svc", entry);
    expect(result.config).toBeUndefined();
    expect(result.warning).toContain("HTTP/SSE");
  });

  test("warns on missing command", () => {
    const entry = { args: ["--flag"] };
    const result = convertEntry("no-cmd", entry);
    expect(result.config).toBeUndefined();
    expect(result.warning).toContain("no command field");
  });

  test("warns on env interpolation syntax", () => {
    const entry = { command: "node", args: [], env: { TOKEN: "${secrets.token}" } };
    const result = convertEntry("interp-svc", entry);
    expect(result.config).toBeDefined();
    expect(result.warning).toContain("interpolation");
  });
});

describe("mergeEntries", () => {
  test("skips duplicates", () => {
    const converted = [
      { name: "existing", config: { backend: "stdio" as const, command: "cmd" } },
    ];
    const existingConfig = {
      services: {
        existing: { backend: "stdio" as const, command: "old-cmd", args: [], env: {} },
      },
    };
    const result = mergeEntries(converted, existingConfig);
    expect(result.skipped).toEqual(["existing"]);
    expect(result.added).toEqual([]);
  });

  test("adds new entries", () => {
    const converted = [
      { name: "new-svc", config: { backend: "stdio" as const, command: "cmd", args: [], env: {} } },
    ];
    const existingConfig = { services: {} };
    const result = mergeEntries(converted, existingConfig);
    expect(result.added).toEqual(["new-svc"]);
    expect(result.skipped).toEqual([]);
    expect(result.merged.services["new-svc"]).toBeDefined();
  });

  test("collects warnings", () => {
    const converted = [
      { name: "warn-svc", warning: "warn-svc: uses HTTP/SSE transport (not supported in v1)" },
      { name: "ok-svc", config: { backend: "stdio" as const, command: "cmd", args: [], env: {} } },
    ];
    const existingConfig = { services: {} };
    const result = mergeEntries(converted, existingConfig);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("warn-svc");
  });
});

describe("handleBootstrap", () => {
  test("--dry-run does not write file", async () => {
    // Create claude.json with a stdio entry
    const claudeConfig = {
      mcpServers: {
        "test-svc": { command: "echo", args: ["hello"] },
      },
    };
    await Bun.write(join(tempDir, ".claude.json"), JSON.stringify(claudeConfig));

    const configPath = join(tempDir, "services.json");
    const origEnv = { ...process.env };
    process.env.HOME = tempDir;
    process.env.MCP2CLI_CONFIG = configPath;
    process.exitCode = 99;

    // Capture stdout
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (msg: string) => logs.push(msg);

    try {
      await handleBootstrap(["--dry-run"]);
      expect(process.exitCode as number).toBe(0);
      const output = JSON.parse(logs[logs.length - 1]);
      expect(output.dryRun).toBe(true);
      expect(output.added).toContain("test-svc");
      // File should NOT be written
      const exists = await Bun.file(configPath).exists();
      expect(exists).toBe(false);
    } finally {
      console.log = origLog;
      Object.assign(process.env, origEnv);
    }
  });

  test("writes merged config when not --dry-run", async () => {
    const claudeConfig = {
      mcpServers: {
        "new-svc": { command: "node", args: ["server.js"] },
      },
    };
    await Bun.write(join(tempDir, ".claude.json"), JSON.stringify(claudeConfig));

    const configPath = join(tempDir, "services.json");
    const origEnv = { ...process.env };
    process.env.HOME = tempDir;
    process.env.MCP2CLI_CONFIG = configPath;
    process.exitCode = 99;

    const logs: string[] = [];
    const origLog = console.log;
    console.log = (msg: string) => logs.push(msg);

    try {
      await handleBootstrap([]);
      expect(process.exitCode as number).toBe(0);
      // File should be written
      const exists = await Bun.file(configPath).exists();
      expect(exists).toBe(true);
      const written = await Bun.file(configPath).json();
      expect(written.services["new-svc"]).toBeDefined();
      expect(written.services["new-svc"].command).toBe("node");
    } finally {
      console.log = origLog;
      Object.assign(process.env, origEnv);
    }
  });

  test("exits 1 when claude.json missing", async () => {
    const origEnv = { ...process.env };
    process.env.HOME = tempDir;
    process.env.MCP2CLI_CONFIG = join(tempDir, "services.json");
    process.exitCode = 99;

    const logs: string[] = [];
    const origLog = console.log;
    console.log = (msg: string) => logs.push(msg);

    try {
      await handleBootstrap([]);
      expect(process.exitCode as number).toBe(1);
      const output = JSON.parse(logs[logs.length - 1]);
      expect(output.error).toBe(true);
      expect(output.code).toBe("CONFIG_NOT_FOUND");
    } finally {
      console.log = origLog;
      Object.assign(process.env, origEnv);
    }
  });

  test("with all HTTP entries: outputs summary with empty added array, does NOT write services.json", async () => {
    const claudeConfig = {
      mcpServers: {
        "http-svc": { type: "http", url: "http://localhost:3000" },
        "sse-svc": { type: "sse", url: "http://localhost:4000/sse" },
      },
    };
    await Bun.write(join(tempDir, ".claude.json"), JSON.stringify(claudeConfig));

    const configPath = join(tempDir, "services.json");
    const origEnv = { ...process.env };
    process.env.HOME = tempDir;
    process.env.MCP2CLI_CONFIG = configPath;
    process.exitCode = 99;

    const logs: string[] = [];
    const origLog = console.log;
    console.log = (msg: string) => logs.push(msg);

    try {
      await handleBootstrap([]);
      expect(process.exitCode as number).toBe(0);
      const output = JSON.parse(logs[logs.length - 1]);
      expect(output.added).toEqual([]);
      expect(output.warnings.length).toBeGreaterThan(0);
      // File should NOT be written
      const exists = await Bun.file(configPath).exists();
      expect(exists).toBe(false);
    } finally {
      console.log = origLog;
      Object.assign(process.env, origEnv);
    }
  });

  test("creates parent directories if they don't exist", async () => {
    const claudeConfig = {
      mcpServers: {
        "test-svc": { command: "echo", args: [] },
      },
    };
    await Bun.write(join(tempDir, ".claude.json"), JSON.stringify(claudeConfig));

    // Point to a deeply nested path that doesn't exist
    const configPath = join(tempDir, "deep", "nested", "dir", "services.json");
    const origEnv = { ...process.env };
    process.env.HOME = tempDir;
    process.env.MCP2CLI_CONFIG = configPath;
    process.exitCode = 99;

    const logs: string[] = [];
    const origLog = console.log;
    console.log = (msg: string) => logs.push(msg);

    try {
      await handleBootstrap([]);
      expect(process.exitCode as number).toBe(0);
      const exists = await Bun.file(configPath).exists();
      expect(exists).toBe(true);
    } finally {
      console.log = origLog;
      Object.assign(process.env, origEnv);
    }
  });
});
