import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  resolveOutputDir,
  mergeContent,
  planFileWrites,
  executeFileWrites,
} from "../../src/generation/file-manager.ts";

// -- resolveOutputDir --

describe("resolveOutputDir", () => {
  const originalEnv = process.env.PAI_SKILLS_DIR;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.PAI_SKILLS_DIR;
    } else {
      process.env.PAI_SKILLS_DIR = originalEnv;
    }
  });

  test("returns default path when no env or flag", () => {
    delete process.env.PAI_SKILLS_DIR;
    const result = resolveOutputDir("n8n");
    const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
    expect(result).toBe(join(home, ".config", "mcp2cli", "skills", "n8n"));
  });

  test("uses PAI_SKILLS_DIR when set", () => {
    process.env.PAI_SKILLS_DIR = "/tmp/skills";
    const result = resolveOutputDir("n8n");
    expect(result).toBe("/tmp/skills/n8n");
  });

  test("--output flag wins over everything", () => {
    process.env.PAI_SKILLS_DIR = "/tmp/skills";
    const result = resolveOutputDir("n8n", "/custom/path");
    expect(result).toBe("/custom/path");
  });
});

// -- mergeContent --

describe("mergeContent", () => {
  test("replaces content between markers", () => {
    const existing = [
      "# My Custom Header",
      "",
      "User notes here.",
      "",
      "<!-- AUTO-GENERATED:START -->",
      "Old auto content",
      "<!-- AUTO-GENERATED:END -->",
      "",
      "User footer.",
    ].join("\n");

    const generated = [
      "<!-- AUTO-GENERATED:START -->",
      "New auto content",
      "More new content",
      "<!-- AUTO-GENERATED:END -->",
    ].join("\n");

    const result = mergeContent(existing, generated);
    expect(result).toContain("# My Custom Header");
    expect(result).toContain("User notes here.");
    expect(result).toContain("New auto content");
    expect(result).toContain("More new content");
    expect(result).not.toContain("Old auto content");
    expect(result).toContain("User footer.");
  });

  test("appends generated content when no markers in existing", () => {
    const existing = "# My Custom File\n\nSome content.\n";
    const generated = [
      "<!-- AUTO-GENERATED:START -->",
      "Auto content",
      "<!-- AUTO-GENERATED:END -->",
    ].join("\n");

    const result = mergeContent(existing, generated);
    expect(result).toContain("# My Custom File");
    expect(result).toContain("Some content.");
    expect(result).toContain("<!-- AUTO-GENERATED:START -->");
    expect(result).toContain("Auto content");
    expect(result).toContain("<!-- AUTO-GENERATED:END -->");
  });

  test("preserves user content before and after markers", () => {
    const existing = [
      "BEFORE",
      "<!-- AUTO-GENERATED:START -->",
      "old stuff",
      "<!-- AUTO-GENERATED:END -->",
      "AFTER",
    ].join("\n");

    const generated = [
      "<!-- AUTO-GENERATED:START -->",
      "new stuff",
      "<!-- AUTO-GENERATED:END -->",
    ].join("\n");

    const result = mergeContent(existing, generated);
    expect(result).toMatch(/^BEFORE/);
    expect(result).toContain("new stuff");
    expect(result).toMatch(/AFTER$/);
    expect(result).not.toContain("old stuff");
  });

  test("handles tolerant marker whitespace", () => {
    const existing = [
      "Before",
      "<!--  AUTO-GENERATED:START  -->",
      "old",
      "<!--  AUTO-GENERATED:END  -->",
      "After",
    ].join("\n");

    const generated = [
      "<!-- AUTO-GENERATED:START -->",
      "new",
      "<!-- AUTO-GENERATED:END -->",
    ].join("\n");

    const result = mergeContent(existing, generated);
    expect(result).toContain("new");
    expect(result).not.toContain("old");
    expect(result).toContain("Before");
    expect(result).toContain("After");
  });
});

// -- planFileWrites --

describe("planFileWrites", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "mcp2cli-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  test("new file gets action 'create'", async () => {
    const generated = new Map([["SKILL.md", "# Skill content"]]);
    const plans = await planFileWrites(tmpDir, generated, "skip");
    expect(plans).toHaveLength(1);
    expect(plans[0]!.action).toBe("create");
    expect(plans[0]!.path).toBe(join(tmpDir, "SKILL.md"));
    expect(plans[0]!.content).toBe("# Skill content");
  });

  test("existing file + conflict 'force' -> action 'overwrite'", async () => {
    await Bun.write(join(tmpDir, "SKILL.md"), "old content");
    const generated = new Map([["SKILL.md", "new content"]]);
    const plans = await planFileWrites(tmpDir, generated, "force");
    expect(plans).toHaveLength(1);
    expect(plans[0]!.action).toBe("overwrite");
    expect(plans[0]!.content).toBe("new content");
  });

  test("existing file + conflict 'skip' -> action 'skip'", async () => {
    await Bun.write(join(tmpDir, "SKILL.md"), "old content");
    const generated = new Map([["SKILL.md", "new content"]]);
    const plans = await planFileWrites(tmpDir, generated, "skip");
    expect(plans).toHaveLength(1);
    expect(plans[0]!.action).toBe("skip");
  });

  test("existing file + conflict 'merge' -> action 'merge' with merged content", async () => {
    const existing = [
      "# Custom header",
      "",
      "<!-- AUTO-GENERATED:START -->",
      "old auto content",
      "<!-- AUTO-GENERATED:END -->",
      "",
      "Custom footer",
    ].join("\n");
    await Bun.write(join(tmpDir, "SKILL.md"), existing);

    const newContent = [
      "<!-- AUTO-GENERATED:START -->",
      "new auto content",
      "<!-- AUTO-GENERATED:END -->",
    ].join("\n");

    const generated = new Map([["SKILL.md", newContent]]);
    const plans = await planFileWrites(tmpDir, generated, "merge");
    expect(plans).toHaveLength(1);
    expect(plans[0]!.action).toBe("merge");
    expect(plans[0]!.content).toContain("# Custom header");
    expect(plans[0]!.content).toContain("new auto content");
    expect(plans[0]!.content).toContain("Custom footer");
    expect(plans[0]!.content).not.toContain("old auto content");
  });

  test("handles multiple files", async () => {
    const generated = new Map([
      ["SKILL.md", "skill content"],
      ["references/ops.md", "ops content"],
    ]);
    const plans = await planFileWrites(tmpDir, generated, "skip");
    expect(plans).toHaveLength(2);
  });
});

// -- executeFileWrites --

describe("executeFileWrites", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "mcp2cli-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  test("creates files and parent directories", async () => {
    const plans = [
      {
        path: join(tmpDir, "references", "ops.md"),
        content: "# Ops",
        action: "create" as const,
      },
    ];
    const written = await executeFileWrites(plans);
    expect(written).toHaveLength(1);

    const content = await Bun.file(join(tmpDir, "references", "ops.md")).text();
    expect(content).toBe("# Ops");
  });

  test("skips plans with action 'skip'", async () => {
    const plans = [
      {
        path: join(tmpDir, "SKILL.md"),
        content: "should not write",
        action: "skip" as const,
      },
    ];
    const written = await executeFileWrites(plans);
    expect(written).toHaveLength(0);

    const exists = await Bun.file(join(tmpDir, "SKILL.md")).exists();
    expect(exists).toBe(false);
  });

  test("overwrites existing files", async () => {
    await Bun.write(join(tmpDir, "SKILL.md"), "old");
    const plans = [
      {
        path: join(tmpDir, "SKILL.md"),
        content: "new",
        action: "overwrite" as const,
      },
    ];
    const written = await executeFileWrites(plans);
    expect(written).toHaveLength(1);

    const content = await Bun.file(join(tmpDir, "SKILL.md")).text();
    expect(content).toBe("new");
  });

  test("writes merged content", async () => {
    const plans = [
      {
        path: join(tmpDir, "SKILL.md"),
        content: "merged content",
        action: "merge" as const,
      },
    ];
    const written = await executeFileWrites(plans);
    expect(written).toHaveLength(1);

    const content = await Bun.file(join(tmpDir, "SKILL.md")).text();
    expect(content).toBe("merged content");
  });
});
