import { describe, test, expect, beforeAll } from "bun:test";
import { resolve } from "path";
import { runCli } from "../test-helpers/run-cli.ts";

const PROJECT_ROOT = resolve(import.meta.dir, "../..");

describe("CLI dispatch", () => {
  test("no args: exitCode 0, stdout contains help text", () => {
    const result = runCli([]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("mcp2cli");
    expect(result.stdout).toContain("USAGE");
  });

  test("--help flag: exitCode 0, stdout contains help text", () => {
    const result = runCli(["--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("mcp2cli");
    expect(result.stdout).toContain("COMMANDS");
  });

  test("-h flag: exitCode 0, stdout contains help text", () => {
    const result = runCli(["-h"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("mcp2cli");
  });

  test("--version flag: exitCode 0, stdout matches version pattern", () => {
    const result = runCli(["--version"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/^\d+\.\d+\.\d+$/);
  });

  test("unknown command without tool: exitCode 1, JSON error with UNKNOWN_COMMAND", () => {
    // Single unknown arg is treated as a service name missing a tool name
    const result = runCli(["unknown-command"]);
    expect(result.exitCode).toBe(1);
    const error = JSON.parse(result.stdout);
    expect(error.error).toBe(true);
    expect(error.code).toBe("UNKNOWN_COMMAND");
    expect(error.message).toContain("Missing tool name");
  });

  test("services command: exitCode 0, JSON with services array", () => {
    const configPath = resolve(
      PROJECT_ROOT,
      "tests/fixtures/valid-config.json",
    );
    const result = runCli(["services"], { MCP2CLI_CONFIG: configPath });
    expect(result.exitCode).toBe(0);
    const data = JSON.parse(result.stdout);
    expect(data).toHaveProperty("services");
    expect(Array.isArray(data.services)).toBe(true);
    expect(data.services.length).toBeGreaterThanOrEqual(1);
  });
});

describe("services command - config integration", () => {
  test("valid config lists services with real data", () => {
    const configPath = resolve(
      PROJECT_ROOT,
      "tests/fixtures/valid-config.json",
    );
    const result = runCli(["services"], { MCP2CLI_CONFIG: configPath });
    expect(result.exitCode).toBe(0);
    const data = JSON.parse(result.stdout);
    expect(data.services).toBeArrayOfSize(1);
    expect(data.services[0].name).toBe("n8n");
    expect(data.services[0].backend).toBe("stdio");
    expect(data.services[0].status).toBe("configured");
  });

  test("valid multi-service config lists all services", () => {
    const configPath = resolve(
      PROJECT_ROOT,
      "tests/fixtures/valid-multi-service.json",
    );
    const result = runCli(["services"], { MCP2CLI_CONFIG: configPath });
    expect(result.exitCode).toBe(0);
    const data = JSON.parse(result.stdout);
    expect(data.services).toBeArrayOfSize(2);
    const names = data.services.map((s: { name: string }) => s.name);
    expect(names).toContain("n8n");
    expect(names).toContain("vault");
  });

  test("missing config exits 1 with CONFIG_NOT_FOUND", () => {
    const result = runCli(["services"], {
      MCP2CLI_CONFIG: "/tmp/nonexistent-mcp2cli-config.json",
    });
    expect(result.exitCode).toBe(1);
    const error = JSON.parse(result.stdout);
    expect(error.error).toBe(true);
    expect(error.code).toBe("CONFIG_NOT_FOUND");
  });

  test("invalid config exits 1 with CONFIG_VALIDATION_ERROR", () => {
    const configPath = resolve(
      PROJECT_ROOT,
      "tests/fixtures/invalid-empty-services.json",
    );
    const result = runCli(["services"], { MCP2CLI_CONFIG: configPath });
    expect(result.exitCode).toBe(1);
    const error = JSON.parse(result.stdout);
    expect(error.error).toBe(true);
    expect(error.code).toBe("CONFIG_VALIDATION_ERROR");
  });

  test("malformed JSON exits 1 with CONFIG_PARSE_ERROR", () => {
    const configPath = resolve(
      PROJECT_ROOT,
      "tests/fixtures/invalid-not-json.txt",
    );
    const result = runCli(["services"], { MCP2CLI_CONFIG: configPath });
    expect(result.exitCode).toBe(1);
    const error = JSON.parse(result.stdout);
    expect(error.error).toBe(true);
    expect(error.code).toBe("CONFIG_PARSE_ERROR");
  });
});

describe("help modes", () => {
  test("default help is human-readable text", () => {
    const result = runCli([]);
    expect(result.exitCode).toBe(0);
    // Human mode: contains text formatting, not JSON
    expect(result.stdout).toContain("USAGE:");
    expect(result.stdout).toContain("COMMANDS:");
    // Should NOT be valid JSON (it's human text)
    expect(() => JSON.parse(result.stdout)).toThrow();
  });

  test("MCP2CLI_HELP_MODE=ai outputs JSON help", () => {
    const result = runCli([], { MCP2CLI_HELP_MODE: "ai" });
    expect(result.exitCode).toBe(0);
    const data = JSON.parse(result.stdout);
    expect(data).toHaveProperty("name", "mcp2cli");
    expect(data).toHaveProperty("commands");
    expect(Array.isArray(data.commands)).toBe(true);
  });

  test("--help-format=ai flag outputs JSON help", () => {
    const result = runCli(["--help-format=ai"]);
    expect(result.exitCode).toBe(0);
    const data = JSON.parse(result.stdout);
    expect(data).toHaveProperty("name", "mcp2cli");
    expect(data).toHaveProperty("version");
  });
});

describe("build", () => {
  const binaryPath = resolve(PROJECT_ROOT, "dist/mcp2cli");

  beforeAll(() => {
    // Build the compiled binary once for all build tests
    const buildResult = Bun.spawnSync(
      [
        "bun",
        "build",
        "--compile",
        "src/cli/index.ts",
        "--outfile",
        "dist/mcp2cli",
      ],
      {
        cwd: PROJECT_ROOT,
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    if (buildResult.exitCode !== 0) {
      throw new Error(`Build failed: ${buildResult.stderr.toString()}`);
    }
  });

  test("compiled binary exists", async () => {
    const file = Bun.file(binaryPath);
    expect(await file.exists()).toBe(true);
  });

  test("binary --version outputs version string", () => {
    const proc = Bun.spawnSync([binaryPath, "--version"], {
      cwd: PROJECT_ROOT,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(proc.exitCode).toBe(0);
    expect(proc.stdout.toString().trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  test("binary with no args prints help", () => {
    const proc = Bun.spawnSync([binaryPath], {
      cwd: PROJECT_ROOT,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(proc.exitCode).toBe(0);
    expect(proc.stdout.toString()).toContain("mcp2cli");
  });
});
