import { describe, test, expect, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "../test-helpers/run-cli.ts";

let tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "mcp2cli-bootstrap-int-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  for (const dir of tempDirs) {
    await rm(dir, { recursive: true, force: true });
  }
  tempDirs = [];
});

describe("bootstrap integration", () => {
  test("bootstrap with valid claude.json generates services.json", async () => {
    const homeDir = await makeTempDir();
    const configDir = await makeTempDir();
    const configPath = join(configDir, "services.json");

    const claudeConfig = {
      mcpServers: {
        "my-server": { command: "node", args: ["server.js"], env: { PORT: "3000" } },
      },
    };
    await Bun.write(join(homeDir, ".claude.json"), JSON.stringify(claudeConfig));

    const result = runCli(["bootstrap"], {
      HOME: homeDir,
      MCP2CLI_CONFIG: configPath,
    });

    expect(result.exitCode).toBe(0);
    const output = JSON.parse(result.stdout);
    expect(output.added).toContain("my-server");
    expect(output.skipped).toEqual([]);
    expect(output.warnings).toEqual([]);

    // Verify file was written
    const written = await Bun.file(configPath).json();
    expect(written.services["my-server"].command).toBe("node");
    expect(written.services["my-server"].backend).toBe("stdio");
  }, 15_000);

  test("bootstrap --dry-run does not write file", async () => {
    const homeDir = await makeTempDir();
    const configDir = await makeTempDir();
    const configPath = join(configDir, "services.json");

    const claudeConfig = {
      mcpServers: {
        "dry-svc": { command: "echo", args: ["test"] },
      },
    };
    await Bun.write(join(homeDir, ".claude.json"), JSON.stringify(claudeConfig));

    const result = runCli(["bootstrap", "--dry-run"], {
      HOME: homeDir,
      MCP2CLI_CONFIG: configPath,
    });

    expect(result.exitCode).toBe(0);
    const output = JSON.parse(result.stdout);
    expect(output.dryRun).toBe(true);
    expect(output.added).toContain("dry-svc");

    // File should NOT exist
    const exists = await Bun.file(configPath).exists();
    expect(exists).toBe(false);
  }, 15_000);

  test("bootstrap with no claude.json returns structured error", async () => {
    const homeDir = await makeTempDir();
    const configDir = await makeTempDir();

    const result = runCli(["bootstrap"], {
      HOME: homeDir,
      MCP2CLI_CONFIG: join(configDir, "services.json"),
    });

    expect(result.exitCode).toBe(1);
    const output = JSON.parse(result.stdout);
    expect(output.error).toBe(true);
    expect(output.code).toBe("CONFIG_NOT_FOUND");
    expect(output.message).toContain(".claude.json");
  }, 15_000);

  test("bootstrap converts HTTP entries alongside stdio", async () => {
    const homeDir = await makeTempDir();
    const configDir = await makeTempDir();
    const configPath = join(configDir, "services.json");

    const claudeConfig = {
      mcpServers: {
        "http-svc": { type: "http", url: "http://localhost:3000" },
        "stdio-svc": { command: "node", args: [] },
      },
    };
    await Bun.write(join(homeDir, ".claude.json"), JSON.stringify(claudeConfig));

    const result = runCli(["bootstrap"], {
      HOME: homeDir,
      MCP2CLI_CONFIG: configPath,
    });

    expect(result.exitCode).toBe(0);
    const output = JSON.parse(result.stdout);
    expect(output.added).toContain("stdio-svc");
    expect(output.added).toContain("http-svc");

    const written = await Bun.file(configPath).json();
    expect(written.services["http-svc"].backend).toBe("http");
    expect(written.services["http-svc"].url).toBe("http://localhost:3000");
    expect(written.services["stdio-svc"].backend).toBe("stdio");
  }, 15_000);

  test("bootstrap merges with existing services.json", async () => {
    const homeDir = await makeTempDir();
    const configDir = await makeTempDir();
    const configPath = join(configDir, "services.json");

    // Create existing services.json
    const existingConfig = {
      services: {
        "existing-svc": { backend: "stdio", command: "existing-cmd", args: [], env: {} },
      },
    };
    await Bun.write(configPath, JSON.stringify(existingConfig));

    // Create claude.json with new service
    const claudeConfig = {
      mcpServers: {
        "new-svc": { command: "new-cmd", args: ["--flag"] },
      },
    };
    await Bun.write(join(homeDir, ".claude.json"), JSON.stringify(claudeConfig));

    const result = runCli(["bootstrap"], {
      HOME: homeDir,
      MCP2CLI_CONFIG: configPath,
    });

    expect(result.exitCode).toBe(0);
    const output = JSON.parse(result.stdout);
    expect(output.added).toContain("new-svc");

    // Verify both services exist in written file
    const written = await Bun.file(configPath).json();
    expect(written.services["existing-svc"].command).toBe("existing-cmd");
    expect(written.services["new-svc"].command).toBe("new-cmd");
  }, 15_000);

  test("bootstrap skips duplicates", async () => {
    const homeDir = await makeTempDir();
    const configDir = await makeTempDir();
    const configPath = join(configDir, "services.json");

    // Create existing services.json with "n8n"
    const existingConfig = {
      services: {
        n8n: { backend: "stdio", command: "original-n8n", args: [], env: {} },
      },
    };
    await Bun.write(configPath, JSON.stringify(existingConfig));

    // Create claude.json also with "n8n"
    const claudeConfig = {
      mcpServers: {
        n8n: { command: "new-n8n", args: [] },
      },
    };
    await Bun.write(join(homeDir, ".claude.json"), JSON.stringify(claudeConfig));

    const result = runCli(["bootstrap"], {
      HOME: homeDir,
      MCP2CLI_CONFIG: configPath,
    });

    // Zero new entries added, so no write happens -- exit 0 with empty added
    expect(result.exitCode).toBe(0);
    const output = JSON.parse(result.stdout);
    expect(output.skipped).toContain("n8n");
    expect(output.added).toEqual([]);

    // Existing config should be unchanged
    const written = await Bun.file(configPath).json();
    expect(written.services.n8n.command).toBe("original-n8n");
  }, 15_000);

  test("bootstrap with only HTTP entries: converts and writes file", async () => {
    const homeDir = await makeTempDir();
    const configDir = await makeTempDir();
    const configPath = join(configDir, "services.json");

    const claudeConfig = {
      mcpServers: {
        "http-only": { type: "http", url: "http://localhost:3000" },
        "sse-only": { type: "sse", url: "http://localhost:4000/sse" },
      },
    };
    await Bun.write(join(homeDir, ".claude.json"), JSON.stringify(claudeConfig));

    const result = runCli(["bootstrap"], {
      HOME: homeDir,
      MCP2CLI_CONFIG: configPath,
    });

    expect(result.exitCode).toBe(0);
    const output = JSON.parse(result.stdout);
    expect(output.added).toContain("http-only");
    expect(output.added).toContain("sse-only");

    // File SHOULD be created with http backends
    const exists = await Bun.file(configPath).exists();
    expect(exists).toBe(true);
    const written = await Bun.file(configPath).json();
    expect(written.services["http-only"].backend).toBe("http");
    expect(written.services["sse-only"].backend).toBe("http");
  }, 15_000);

  test("bootstrap creates parent directory if needed", async () => {
    const homeDir = await makeTempDir();
    const configDir = await makeTempDir();
    // Point to nested non-existent directory
    const configPath = join(configDir, "deep", "nested", "services.json");

    const claudeConfig = {
      mcpServers: {
        "test-svc": { command: "echo", args: ["hello"] },
      },
    };
    await Bun.write(join(homeDir, ".claude.json"), JSON.stringify(claudeConfig));

    const result = runCli(["bootstrap"], {
      HOME: homeDir,
      MCP2CLI_CONFIG: configPath,
    });

    expect(result.exitCode).toBe(0);
    const output = JSON.parse(result.stdout);
    expect(output.added).toContain("test-svc");

    // File should exist in nested directory
    const exists = await Bun.file(configPath).exists();
    expect(exists).toBe(true);
  }, 15_000);
});
