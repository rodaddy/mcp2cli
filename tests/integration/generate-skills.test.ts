import { describe, test, expect, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runCli } from "../test-helpers/run-cli.ts";

const MOCK_SERVER = resolve(import.meta.dir, "../fixtures/mock-mcp-server.ts");

let tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "mcp2cli-genskill-int-"));
  tempDirs.push(dir);
  return dir;
}

/**
 * Create a temp services.json pointing to the mock MCP server,
 * and return the config path + a unique output dir.
 */
async function setupTestEnv(): Promise<{
  configPath: string;
  outputDir: string;
  env: Record<string, string>;
}> {
  const configDir = await makeTempDir();
  const outputDir = await makeTempDir();
  const configPath = join(configDir, "services.json");

  const config = {
    services: {
      "mock-server": {
        backend: "stdio",
        command: "bun",
        args: ["run", MOCK_SERVER],
        env: {},
      },
    },
  };
  await Bun.write(configPath, JSON.stringify(config));

  return {
    configPath,
    outputDir,
    env: {
      MCP2CLI_CONFIG: configPath,
      MCP2CLI_NO_DAEMON: "1",
    },
  };
}

afterEach(async () => {
  for (const dir of tempDirs) {
    await rm(dir, { recursive: true, force: true });
  }
  tempDirs = [];
});

describe("generate-skills integration", () => {
  test("happy path: generates SKILL.md and reference files", async () => {
    const { env, outputDir } = await setupTestEnv();

    const result = runCli(
      ["generate-skills", "mock-server", `--output=${outputDir}`],
      env,
    );

    expect(result.exitCode).toBe(0);
    const output = JSON.parse(result.stdout);
    expect(output.service).toBe("mock-server");
    expect(output.skillFile).toContain("SKILL.md");
    expect(output.referenceFiles.length).toBeGreaterThan(0);
    expect(output.tokenCount).toBeGreaterThan(0);

    // SKILL.md should exist
    const skillExists = await Bun.file(join(outputDir, "SKILL.md")).exists();
    expect(skillExists).toBe(true);

    // At least one reference file should exist
    expect(output.referenceFiles.length).toBeGreaterThanOrEqual(1);
  }, 30_000);

  test("SKILL.md has valid frontmatter, tool table, invoke pattern, markers", async () => {
    const { env, outputDir } = await setupTestEnv();

    runCli(
      ["generate-skills", "mock-server", `--output=${outputDir}`],
      env,
    );

    const skillContent = await Bun.file(join(outputDir, "SKILL.md")).text();

    // YAML frontmatter
    expect(skillContent).toMatch(/^---\n/);
    expect(skillContent).toContain("name: mock-server");
    expect(skillContent).toContain("description:");
    expect(skillContent).toContain("triggers:");

    // Tool table with all 3 mock tools
    expect(skillContent).toContain("json_tool");
    expect(skillContent).toContain("error_tool");
    expect(skillContent).toContain("create_item");
    expect(skillContent).toContain("| Tool | Description |");

    // Invoke pattern
    expect(skillContent).toContain("mcp2cli mock-server");

    // AUTO-GENERATED markers
    expect(skillContent).toContain("AUTO-GENERATED:START");
    expect(skillContent).toContain("AUTO-GENERATED:END");

    // Token budget: under 300
    const tokenEstimate = Math.ceil(skillContent.length / 4);
    expect(tokenEstimate).toBeLessThanOrEqual(300);
  }, 30_000);

  test("reference file has parameter tables and examples", async () => {
    const { env, outputDir } = await setupTestEnv();

    const result = runCli(
      ["generate-skills", "mock-server", `--output=${outputDir}`],
      env,
    );

    const output = JSON.parse(result.stdout);
    // Read the first reference file
    const firstRefPath = output.referenceFiles[0] as string;
    const refContent = await Bun.file(firstRefPath).text();

    // Should have AUTO-GENERATED markers
    expect(refContent).toContain("AUTO-GENERATED:START");
    expect(refContent).toContain("AUTO-GENERATED:END");

    // Should have parameter table headers (at least for tools with params)
    expect(refContent).toContain("| Name | Type | Required | Description |");

    // Should have example invocations
    expect(refContent).toContain("```bash");
    expect(refContent).toContain("mcp2cli mock-server");
  }, 30_000);

  test("dry-run mode outputs plan without writing files", async () => {
    const { env, outputDir } = await setupTestEnv();

    const result = runCli(
      ["generate-skills", "mock-server", "--dry-run", `--output=${outputDir}`],
      env,
    );

    expect(result.exitCode).toBe(10); // DRY_RUN exit code
    const output = JSON.parse(result.stdout);
    expect(output.dryRun).toBe(true);
    expect(output.service).toBe("mock-server");
    expect(output.files).toContain("SKILL.md");
    expect(output.tokenCount).toBeGreaterThan(0);

    // No files should have been written
    const skillExists = await Bun.file(join(outputDir, "SKILL.md")).exists();
    expect(skillExists).toBe(false);
  }, 30_000);

  test("conflict skip preserves existing files", async () => {
    const { env, outputDir } = await setupTestEnv();

    // First run: generate files
    runCli(
      ["generate-skills", "mock-server", `--output=${outputDir}`],
      env,
    );

    // Read original content
    const originalContent = await Bun.file(join(outputDir, "SKILL.md")).text();

    // Modify the file to detect if it gets overwritten
    const modifiedContent = originalContent + "\n<!-- user modification -->\n";
    await Bun.write(join(outputDir, "SKILL.md"), modifiedContent);

    // Second run with --conflict=skip
    const result = runCli(
      ["generate-skills", "mock-server", `--output=${outputDir}`, "--conflict=skip"],
      env,
    );

    expect(result.exitCode).toBe(0);

    // File should still have our modification (not overwritten)
    const afterContent = await Bun.file(join(outputDir, "SKILL.md")).text();
    expect(afterContent).toContain("<!-- user modification -->");
  }, 30_000);

  test("conflict force overwrites existing files", async () => {
    const { env, outputDir } = await setupTestEnv();

    // First run: generate files
    runCli(
      ["generate-skills", "mock-server", `--output=${outputDir}`],
      env,
    );

    // Modify the file
    const skillPath = join(outputDir, "SKILL.md");
    const original = await Bun.file(skillPath).text();
    await Bun.write(skillPath, original + "\n<!-- user modification -->\n");

    // Second run with --conflict=force
    const result = runCli(
      ["generate-skills", "mock-server", `--output=${outputDir}`, "--conflict=force"],
      env,
    );

    expect(result.exitCode).toBe(0);

    // File should NOT have our modification (overwritten with fresh)
    const afterContent = await Bun.file(skillPath).text();
    expect(afterContent).not.toContain("<!-- user modification -->");
  }, 30_000);

  test("conflict merge preserves user content outside markers", async () => {
    const { env, outputDir } = await setupTestEnv();

    // First run: generate files
    runCli(
      ["generate-skills", "mock-server", `--output=${outputDir}`],
      env,
    );

    // Add user content OUTSIDE auto-generated markers
    const skillPath = join(outputDir, "SKILL.md");
    const original = await Bun.file(skillPath).text();
    const withUserContent = original + "\n## My Custom Notes\n\nThis should be preserved.\n";
    await Bun.write(skillPath, withUserContent);

    // Second run with --conflict=merge
    const result = runCli(
      ["generate-skills", "mock-server", `--output=${outputDir}`, "--conflict=merge"],
      env,
    );

    expect(result.exitCode).toBe(0);

    // User content outside markers should be preserved
    const afterContent = await Bun.file(skillPath).text();
    expect(afterContent).toContain("My Custom Notes");
    expect(afterContent).toContain("This should be preserved.");

    // Auto-generated content should still be present (refreshed)
    expect(afterContent).toContain("AUTO-GENERATED:START");
    expect(afterContent).toContain("AUTO-GENERATED:END");
  }, 30_000);

  test("missing service arg returns structured validation error", async () => {
    const { env } = await setupTestEnv();

    const result = runCli(["generate-skills"], env);

    expect(result.exitCode).toBe(1);
    const output = JSON.parse(result.stdout);
    expect(output.error).toBe(true);
    expect(output.code).toBe("INPUT_VALIDATION_ERROR");
  }, 15_000);

  test("unknown service returns structured error", async () => {
    const { env } = await setupTestEnv();

    const result = runCli(["generate-skills", "nonexistent"], env);

    expect(result.exitCode).toBe(1);
    const output = JSON.parse(result.stdout);
    expect(output.error).toBe(true);
    expect(output.code).toBe("CONFIG_NOT_FOUND");
    expect(output.message).toContain("nonexistent");
  }, 15_000);
});
