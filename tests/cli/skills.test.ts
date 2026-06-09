import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { writeCache } from "../../src/cache/index.ts";
import type { CachedToolSchema } from "../../src/cache/index.ts";

let testDir: string;
let skillsDir: string;
let origCacheDir: string | undefined;
let origSkillsDir: string | undefined;

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), "mcp2cli-skills-test-"));
  skillsDir = join(testDir, "skills");
  await mkdir(skillsDir, { recursive: true });
  origCacheDir = process.env.MCP2CLI_CACHE_DIR;
  origSkillsDir = process.env.PAI_SKILLS_DIR;
  process.env.MCP2CLI_CACHE_DIR = join(testDir, "cache");
  process.env.PAI_SKILLS_DIR = skillsDir;
});

afterEach(async () => {
  if (origCacheDir !== undefined) {
    process.env.MCP2CLI_CACHE_DIR = origCacheDir;
  } else {
    delete process.env.MCP2CLI_CACHE_DIR;
  }
  if (origSkillsDir !== undefined) {
    process.env.PAI_SKILLS_DIR = origSkillsDir;
  } else {
    delete process.env.PAI_SKILLS_DIR;
  }
  await rm(testDir, { recursive: true, force: true });
});

function makeTool(name: string, desc: string): CachedToolSchema {
  return {
    name,
    description: desc,
    inputSchema: { type: "object", properties: {} },
    hash: `hash_${name}`,
  };
}

async function writeSkillFile(service: string, content: string): Promise<void> {
  const dir = join(skillsDir, service);
  await mkdir(dir, { recursive: true });
  await Bun.write(join(dir, "SKILL.md"), content);
}

async function captureSkills(args: string[]): Promise<{ stdout: string; exitCode: number }> {
  const { handleSkills } = await import("../../src/cli/commands/skills.ts");
  const lines: string[] = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = (...logArgs: unknown[]) => {
    lines.push(logArgs.map(String).join(" "));
  };
  console.error = (...logArgs: unknown[]) => {
    lines.push(logArgs.map(String).join(" "));
  };
  process.exitCode = 0;
  try {
    await handleSkills(args);
  } finally {
    console.log = origLog;
    console.error = origErr;
  }
  return { stdout: lines.join("\n"), exitCode: process.exitCode ?? 0 };
}

describe("skills command", () => {
  test("shows usage when no subcommand", async () => {
    const { stdout } = await captureSkills([]);
    expect(stdout).toContain("Usage: mcp2cli skills");
    expect(stdout).toContain("list");
    expect(stdout).toContain("get");
    expect(stdout).toContain("install");
  });

  test("shows usage for unknown subcommand", async () => {
    const { stdout, exitCode } = await captureSkills(["foo"]);
    expect(stdout).toContain("Usage:");
    expect(exitCode).not.toBe(0);
  });
});

describe("skills get", () => {
  test("outputs SKILL.md content to stdout", async () => {
    await writeSkillFile("test-svc", "# test-svc\n\nMCP tools for test-svc\n");
    const { stdout } = await captureSkills(["get", "test-svc"]);
    expect(stdout).toContain("# test-svc");
    expect(stdout).toContain("MCP tools for test-svc");
  });

  test("errors when skill file missing", async () => {
    const { stdout, exitCode } = await captureSkills(["get", "nonexistent"]);
    expect(stdout).toContain("No skill file found");
    expect(exitCode).not.toBe(0);
  });

  test("errors when no service specified", async () => {
    const { stdout, exitCode } = await captureSkills(["get"]);
    expect(stdout).toContain("Usage:");
    expect(exitCode).not.toBe(0);
  });
});

describe("skills install", () => {
  test("copies skill bundle to target directory", async () => {
    await writeSkillFile("test-svc", "# test-svc skill content\n");
    const targetDir = join(testDir, "install-target");

    const { stdout } = await captureSkills(["install", "test-svc", "--target", targetDir]);
    expect(stdout).toContain("Installed test-svc");

    const installed = Bun.file(join(targetDir, "SKILL.md"));
    expect(await installed.exists()).toBe(true);
    expect(await installed.text()).toContain("# test-svc skill content");
  });

  test("errors when no target specified", async () => {
    const { exitCode } = await captureSkills(["install", "test-svc"]);
    expect(exitCode).not.toBe(0);
  });

  test("errors when skill file missing", async () => {
    const { stdout, exitCode } = await captureSkills(["install", "nonexistent", "--target", "/tmp/x"]);
    expect(stdout).toContain("No skill file found");
    expect(exitCode).not.toBe(0);
  });

  test("supports --target=path syntax", async () => {
    await writeSkillFile("test-svc", "# content\n");
    const targetDir = join(testDir, "install-eq");

    const { stdout } = await captureSkills(["install", "test-svc", `--target=${targetDir}`]);
    expect(stdout).toContain("Installed");

    const installed = Bun.file(join(targetDir, "SKILL.md"));
    expect(await installed.exists()).toBe(true);
  });
});

describe("skills list", () => {
  test("shows missing when no skill file exists", async () => {
    await writeCache("test-svc", [makeTool("tool_a", "Does A")]);
    // Set up a minimal config for the list command to find
    const origConfig = process.env.MCP2CLI_CONFIG;
    const configPath = join(testDir, "services.json");
    await Bun.write(configPath, JSON.stringify({
      services: { "test-svc": { backend: "stdio", command: "echo", args: [] } },
    }));
    process.env.MCP2CLI_CONFIG = configPath;

    try {
      const { stdout } = await captureSkills(["list"]);
      expect(stdout).toContain("test-svc");
      expect(stdout).toContain("missing");
    } finally {
      if (origConfig !== undefined) {
        process.env.MCP2CLI_CONFIG = origConfig;
      } else {
        delete process.env.MCP2CLI_CONFIG;
      }
    }
  });
});
