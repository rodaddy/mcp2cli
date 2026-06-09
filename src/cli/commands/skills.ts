/**
 * Handle `mcp2cli skills <subcommand>` — manage service skill bundles.
 * Wraps the generation engine with user-friendly list/get/install/diff/generate subcommands.
 */
import { loadConfig } from "../../config/index.ts";
import { listCachedServices, readCacheRaw } from "../../cache/index.ts";
import { resolveOutputDir } from "../../generation/file-manager.ts";
import { EXIT_CODES } from "../../types/index.ts";
import type { CommandHandler } from "../../types/index.ts";
import { join } from "node:path";
import { readdir, cp, mkdir } from "node:fs/promises";

export const handleSkills: CommandHandler = async (args: string[]) => {
  const subcommand = args[0];

  switch (subcommand) {
    case "list":
      await handleSkillsList();
      break;
    case "get":
      await handleSkillsGet(args.slice(1));
      break;
    case "install":
      await handleSkillsInstall(args.slice(1));
      break;
    case "diff":
      await handleSkillsDiff(args.slice(1));
      break;
    case "generate":
      await handleSkillsGenerate(args.slice(1));
      break;
    default:
      console.log(
        [
          "Usage: mcp2cli skills <subcommand>",
          "",
          "SUBCOMMANDS:",
          "    list                          List all services with skill status",
          "    get <service>                 Output SKILL.md content to stdout",
          "    install <service> --target    Install skill bundle to a directory",
          "    diff <service>                Preview what would change on regeneration",
          "    generate <service> [options]  Generate/regenerate skill files",
          "",
          "EXAMPLES:",
          '    mcp2cli skills list',
          '    mcp2cli skills get open-brain > SKILL.md',
          '    mcp2cli skills install open-brain --target ~/.hermes/skills/mcp/open-brain',
          '    mcp2cli skills diff n8n',
          '    mcp2cli skills generate n8n --conflict=merge',
        ].join("\n"),
      );
      process.exitCode = subcommand ? EXIT_CODES.VALIDATION : EXIT_CODES.SUCCESS;
      break;
  }
};

interface SkillStatus {
  service: string;
  status: "generated" | "stale" | "missing";
  toolCount?: number;
  cachedToolCount?: number;
  generatedAt?: string;
  path?: string;
}

async function handleSkillsList(): Promise<void> {
  const config = await loadConfig();
  const serviceNames = Object.keys(config.services).sort();
  const cachedServices = await listCachedServices();

  const jsonMode = process.argv.includes("--json");
  const statuses: SkillStatus[] = [];

  for (const name of serviceNames) {
    const skillDir = resolveOutputDir(name);
    const skillPath = join(skillDir, "SKILL.md");
    const file = Bun.file(skillPath);
    const exists = await file.exists();

    if (!exists) {
      const cached = cachedServices.includes(name) ? await readCacheRaw(name) : null;
      statuses.push({
        service: name,
        status: "missing",
        cachedToolCount: cached?.tools.length,
      });
      continue;
    }

    const content = await file.text();
    const toolCountMatch = content.match(/\| .+ \| .+ \|/g);
    const generatedToolCount = toolCountMatch ? toolCountMatch.length - 1 : 0; // subtract header row

    const cached = cachedServices.includes(name) ? await readCacheRaw(name) : null;
    const isStale = cached && cached.tools.length !== generatedToolCount;

    statuses.push({
      service: name,
      status: isStale ? "stale" : "generated",
      toolCount: generatedToolCount,
      cachedToolCount: cached?.tools.length,
      path: skillDir,
    });
  }

  if (jsonMode) {
    console.log(JSON.stringify({ services: statuses, total: statuses.length }));
  } else {
    if (statuses.length === 0) {
      console.log("No services configured.");
      process.exitCode = EXIT_CODES.SUCCESS;
      return;
    }

    const maxName = Math.max(...statuses.map((s) => s.service.length));

    for (const s of statuses) {
      const pad = " ".repeat(maxName - s.service.length + 2);
      const tools = s.toolCount !== undefined ? `${s.toolCount} tools` : "";
      const staleNote = s.status === "stale" && s.cachedToolCount !== undefined
        ? ` (cache has ${s.cachedToolCount})`
        : "";
      const statusTag = s.status === "generated" ? "ok"
        : s.status === "stale" ? "stale"
        : "missing";
      console.log(`  ${s.service}${pad}${statusTag}  ${tools}${staleNote}`);
    }
  }

  process.exitCode = EXIT_CODES.SUCCESS;
}

async function handleSkillsGet(args: string[]): Promise<void> {
  const serviceName = args[0];
  if (!serviceName) {
    console.error("Usage: mcp2cli skills get <service>");
    process.exitCode = EXIT_CODES.VALIDATION;
    return;
  }

  const skillDir = resolveOutputDir(serviceName);
  const skillPath = join(skillDir, "SKILL.md");
  const file = Bun.file(skillPath);

  if (!(await file.exists())) {
    console.error(
      `No skill file found for "${serviceName}". Run 'mcp2cli skills generate ${serviceName}' first.`,
    );
    process.exitCode = EXIT_CODES.VALIDATION;
    return;
  }

  const content = await file.text();
  console.log(content);
  process.exitCode = EXIT_CODES.SUCCESS;
}

async function handleSkillsInstall(args: string[]): Promise<void> {
  const serviceName = args[0];
  const targetArg = args.find((a) => a.startsWith("--target="));
  const targetIdx = args.indexOf("--target");
  const target = targetArg
    ? targetArg.split("=").slice(1).join("=")
    : targetIdx >= 0 ? args[targetIdx + 1] : undefined;

  if (!serviceName || !target) {
    console.error("Usage: mcp2cli skills install <service> --target <path>");
    process.exitCode = EXIT_CODES.VALIDATION;
    return;
  }

  const skillDir = resolveOutputDir(serviceName);
  const skillPath = join(skillDir, "SKILL.md");
  const file = Bun.file(skillPath);

  if (!(await file.exists())) {
    console.error(
      `No skill file found for "${serviceName}". Run 'mcp2cli skills generate ${serviceName}' first.`,
    );
    process.exitCode = EXIT_CODES.VALIDATION;
    return;
  }

  await mkdir(target, { recursive: true });

  // Copy SKILL.md
  const resolvedTarget = target.startsWith("~")
    ? join(process.env.HOME ?? "", target.slice(1))
    : target;

  await cp(skillDir, resolvedTarget, { recursive: true });

  // Count files copied
  let fileCount = 1; // SKILL.md
  try {
    const refs = await readdir(join(skillDir, "references"));
    fileCount += refs.length;
  } catch { /* no references dir */ }

  console.log(`Installed ${serviceName} skill bundle to ${resolvedTarget} (${fileCount} files)`);
  process.exitCode = EXIT_CODES.SUCCESS;
}

async function handleSkillsDiff(args: string[]): Promise<void> {
  const { handleGenerateSkills } = await import("./generate-skills.ts");
  await handleGenerateSkills([args[0] ?? "", "--diff"]);
}

async function handleSkillsGenerate(args: string[]): Promise<void> {
  const { handleGenerateSkills } = await import("./generate-skills.ts");
  await handleGenerateSkills(args);
}
