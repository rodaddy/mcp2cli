/**
 * Handle `mcp2cli skills <subcommand>` -- manage service skill bundles.
 * Wraps the generation engine with user-friendly list/get/install/diff/generate subcommands.
 */
import { loadConfig } from "../../config/index.ts";
import { listCachedServices, readCacheRaw } from "../../cache/index.ts";
import { extractPolicy, filterTools } from "../../access/filter.ts";
import { resolveOutputDir } from "../../generation/file-manager.ts";
import { computeSchemaHash } from "../../generation/skill-hash.ts";
import { validateIdentifier } from "../../validation/pipelines.ts";
import { EXIT_CODES } from "../../types/index.ts";
import type { CommandHandler } from "../../types/index.ts";
import { join, resolve } from "node:path";
import { cp, mkdir } from "node:fs/promises";
import { homedir } from "node:os";

/** Lazy getter for generate-skills module (L12 -- deduplicate dynamic import) */
const getGenerateSkills = () => import("./generate-skills.ts");

/**
 * Resolve skill directory and check existence, with input validation (L13).
 * Throws on invalid service name (path traversal, control chars, etc.).
 */
async function resolveSkillDir(
  serviceName: string,
): Promise<{ skillDir: string; exists: boolean }> {
  const check = validateIdentifier(serviceName, "service");
  if (!check.valid) {
    throw new Error(check.message);
  }
  const skillDir = resolveOutputDir(serviceName);
  const exists = await Bun.file(join(skillDir, "SKILL.md")).exists();
  return { skillDir, exists };
}

export const handleSkills: CommandHandler = async (args: string[]) => {
  const subcommand = args[0];

  switch (subcommand) {
    case "list":
      await handleSkillsList(args.slice(1));
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
          "    install <service> --target [--force]  Install skill bundle to a directory",
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
  schemaHash?: string;
  path?: string;
}

async function handleSkillsList(args: string[]): Promise<void> {
  const config = await loadConfig();
  const serviceNames = Object.keys(config.services).sort();
  const cachedServices = await listCachedServices();

  // M6: Use args parameter instead of process.argv
  const jsonMode = args.includes("--json");
  const statuses: SkillStatus[] = [];

  for (const name of serviceNames) {
    const skillDir = resolveOutputDir(name);
    const skillPath = join(skillDir, "SKILL.md");
    const file = Bun.file(skillPath);
    const exists = await file.exists();

    if (!exists) {
      const cached = cachedServices.includes(name) ? await readCacheRaw(name) : null;
      const visibleCachedTools = cached
        ? filterTools(cached.tools, extractPolicy(config.services[name]!))
        : null;
      statuses.push({
        service: name,
        status: "missing",
        cachedToolCount: visibleCachedTools?.length,
      });
      continue;
    }

    const content = await file.text();

    // M4/M5: Use schema_hash from YAML frontmatter instead of brittle regex tool count
    const hashMatch = content.match(/^schema_hash:\s*(\S+)/m);
    const existingHash = hashMatch?.[1];

    const cached = cachedServices.includes(name) ? await readCacheRaw(name) : null;
    const visibleCachedTools = cached
      ? filterTools(cached.tools, extractPolicy(config.services[name]!))
      : null;
    let isStale = false;
    let toolCount: number | undefined;

    if (visibleCachedTools) {
      const cacheHash = await computeSchemaHash(visibleCachedTools);
      isStale = existingHash !== cacheHash;
    }

    // Extract tool_count from frontmatter as display value
    const toolCountMatch = content.match(/^tool_count:\s*(\d+)/m);
    toolCount = toolCountMatch ? parseInt(toolCountMatch[1]!, 10) : undefined;

    statuses.push({
      service: name,
      status: isStale ? "stale" : "generated",
      toolCount,
      cachedToolCount: visibleCachedTools?.length,
      schemaHash: existingHash,
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

  let resolved: { skillDir: string; exists: boolean };
  try {
    resolved = await resolveSkillDir(serviceName);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = EXIT_CODES.VALIDATION;
    return;
  }

  if (!resolved.exists) {
    console.error(
      `No skill file found for "${serviceName}". Run 'mcp2cli skills generate ${serviceName}' first.`,
    );
    process.exitCode = EXIT_CODES.VALIDATION;
    return;
  }

  const content = await Bun.file(join(resolved.skillDir, "SKILL.md")).text();
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
  const force = args.includes("--force");

  if (!serviceName || serviceName.startsWith("--") || !target) {
    console.error("Usage: mcp2cli skills install <service> --target <path> [--force]");
    process.exitCode = EXIT_CODES.VALIDATION;
    return;
  }

  let resolved: { skillDir: string; exists: boolean };
  try {
    resolved = await resolveSkillDir(serviceName);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = EXIT_CODES.VALIDATION;
    return;
  }

  if (!resolved.exists) {
    console.error(
      `No skill file found for "${serviceName}". Run 'mcp2cli skills generate ${serviceName}' first.`,
    );
    process.exitCode = EXIT_CODES.VALIDATION;
    return;
  }

  // H2: Resolve tilde BEFORE mkdir so the actual path is used for both operations
  const resolvedTarget = target.startsWith("~")
    ? join(process.env.HOME ?? "", target.slice(1))
    : target;

  // H2: Validate resolved target path
  const absoluteTarget = resolve(resolvedTarget);
  if (absoluteTarget.includes("..")) {
    console.error("Target path must not contain '..' segments.");
    process.exitCode = EXIT_CODES.VALIDATION;
    return;
  }
  const home = process.env.HOME ?? homedir();
  if (absoluteTarget === home) {
    console.error("Target path must not be the home directory root. Specify a subdirectory.");
    process.exitCode = EXIT_CODES.VALIDATION;
    return;
  }

  // M4: Refuse to overwrite without --force
  const existingSkill = Bun.file(join(resolvedTarget, "SKILL.md"));
  const existingTarget = await existingSkill.exists();
  if (existingTarget && !force) {
    console.error(`Skill bundle already exists at ${resolvedTarget}. Use --force to overwrite.`);
    process.exitCode = EXIT_CODES.VALIDATION;
    return;
  }
  if (existingTarget && force) {
    console.error(`Overwriting existing skill bundle at ${resolvedTarget}`);
  }

  await mkdir(resolvedTarget, { recursive: true });

  // L16: Dereference symlinks when copying
  await cp(resolved.skillDir, resolvedTarget, { recursive: true, dereference: true });

  // L15: Simplified install message without inaccurate file count
  console.log(`Installed ${serviceName} skill bundle to ${resolvedTarget}`);
  process.exitCode = EXIT_CODES.SUCCESS;
}

// M5/M9: Validate service name before delegating to generate-skills
async function handleSkillsDiff(args: string[]): Promise<void> {
  if (!args[0]) {
    console.error("Usage: mcp2cli skills diff <service>");
    process.exitCode = EXIT_CODES.VALIDATION;
    return;
  }
  const check = validateIdentifier(args[0], "service");
  if (!check.valid) {
    console.error(check.message);
    process.exitCode = EXIT_CODES.VALIDATION;
    return;
  }
  const { handleGenerateSkills } = await getGenerateSkills();
  await handleGenerateSkills([args[0], "--diff"]);
}

// M5/M9: Validate service name before delegating to generate-skills
async function handleSkillsGenerate(args: string[]): Promise<void> {
  if (!args[0] || args[0].startsWith("--")) {
    console.error("Usage: mcp2cli skills generate <service> [options]");
    process.exitCode = EXIT_CODES.VALIDATION;
    return;
  }
  const check = validateIdentifier(args[0], "service");
  if (!check.valid) {
    console.error(check.message);
    process.exitCode = EXIT_CODES.VALIDATION;
    return;
  }
  const { handleGenerateSkills } = await getGenerateSkills();
  await handleGenerateSkills(args);
}
