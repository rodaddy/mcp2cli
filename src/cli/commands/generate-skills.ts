import { printError } from "../errors.ts";
import { loadConfig, getConfigPath } from "../../config/index.ts";
import { ConfigError } from "../../config/errors.ts";
import { connectToService } from "../../connection/client.ts";
import { connectToHttpService } from "../../connection/http-transport.ts";
import { listToolsForService, getToolSchema } from "../../schema/introspect.ts";
import {
  detectPrefixGroups,
  generateSkillMd,
  generateReferenceMd,
  estimateTokens,
  resolveOutputDir,
  planFileWrites,
  executeFileWrites,
} from "../../generation/index.ts";
import { EXIT_CODES } from "../../types/index.ts";
import type { ConflictMode, SkillTemplateInput } from "../../generation/types.ts";
import type { SchemaOutput } from "../../schema/types.ts";

/**
 * Extract trigger keywords from tool descriptions.
 * Splits descriptions into words, filters to meaningful nouns/verbs > 3 chars,
 * deduplicates, and returns top 5-8 most common. Always includes the service name.
 */
function extractTriggerKeywords(
  serviceName: string,
  descriptions: string[],
): string[] {
  const wordCounts = new Map<string, number>();

  // Common stop words to exclude
  const stopWords = new Set([
    "the", "and", "for", "with", "from", "that", "this", "will", "have",
    "been", "were", "they", "their", "into", "when", "which", "more",
    "some", "than", "them", "each", "also", "about", "over", "such",
    "after", "most", "only", "other", "given", "returns", "object",
    "type", "string", "number", "boolean", "array", "optional", "required",
  ]);

  for (const desc of descriptions) {
    const words = desc
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 3 && !stopWords.has(w));

    for (const word of words) {
      wordCounts.set(word, (wordCounts.get(word) ?? 0) + 1);
    }
  }

  // Sort by frequency, take top keywords
  const sorted = [...wordCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 7)
    .map(([word]) => word);

  // Always include service name first
  const keywords = [serviceName, ...sorted.filter((w) => w !== serviceName)];
  return keywords.slice(0, 8);
}

/**
 * Parse --conflict=<mode> from args.
 * Returns the parsed mode or undefined if not specified.
 */
function parseConflictMode(args: string[]): ConflictMode | undefined {
  const conflictArg = args.find((a) => a.startsWith("--conflict="));
  if (!conflictArg) return undefined;

  const mode = conflictArg.split("=")[1] as string;
  if (mode === "skip" || mode === "force" || mode === "merge") {
    return mode;
  }
  return undefined;
}

/**
 * Parse --output=<path> from args.
 */
function parseOutputFlag(args: string[]): string | undefined {
  const outputArg = args.find((a) => a.startsWith("--output="));
  if (!outputArg) return undefined;
  return outputArg.split("=").slice(1).join("="); // rejoin in case path has =
}

/**
 * Generate skill files from MCP service schemas.
 *
 * Usage: mcp2cli generate-skills <service> [--dry-run] [--conflict=skip|force|merge] [--output=<path>]
 *
 * Connects to the MCP server, introspects all tools, groups them by noun prefix,
 * generates a slim SKILL.md and per-group reference files.
 *
 * Pre-connection errors use printError + exitCode + return (never throw).
 * Post-connection errors propagate to main().catch().
 */
export const handleGenerateSkills = async (args: string[]): Promise<void> => {
  // Parse service name (first non-flag arg)
  const serviceName = args[0];
  if (!serviceName || serviceName.startsWith("--")) {
    printError({
      error: true,
      code: "INPUT_VALIDATION_ERROR",
      message: "Missing required argument: <service>. Usage: mcp2cli generate-skills <service>",
    });
    process.exitCode = EXIT_CODES.VALIDATION;
    return;
  }

  // Parse flags
  const dryRun = args.includes("--dry-run");
  let conflictMode = parseConflictMode(args);
  const outputFlag = parseOutputFlag(args);

  // Non-TTY without explicit --conflict defaults to "skip" with warning
  if (!conflictMode) {
    if (!process.stdin.isTTY) {
      conflictMode = "skip";
      console.error("Warning: non-interactive mode, defaulting to --conflict=skip");
    } else {
      conflictMode = "skip"; // safe default even for TTY
    }
  }

  // Load config and validate service exists
  let config;
  try {
    config = await loadConfig(getConfigPath());
  } catch (err) {
    if (err instanceof ConfigError && err.code === "CONFIG_NOT_FOUND") {
      printError({
        error: true,
        code: "CONFIG_NOT_FOUND",
        message: "No services.json found. Run 'mcp2cli bootstrap' first.",
      });
      process.exitCode = EXIT_CODES.VALIDATION;
      return;
    }
    throw err;
  }

  const service = config.services[serviceName];
  if (!service) {
    printError({
      error: true,
      code: "CONFIG_NOT_FOUND",
      message: `Unknown service: "${serviceName}". Run 'mcp2cli services' to list available services.`,
    });
    process.exitCode = EXIT_CODES.VALIDATION;
    return;
  }

  // Connect to MCP server (stdio or http)
  const connection = service.backend === "http"
    ? await connectToHttpService(service)
    : await connectToService(service);

  try {
    // List all tools
    const tools = await listToolsForService(connection.client);

    if (tools.length === 0) {
      printError({
        error: true,
        code: "INPUT_VALIDATION_ERROR",
        message: "Service has no tools to document",
      });
      process.exitCode = EXIT_CODES.VALIDATION;
      return;
    }

    // Get full schemas for each tool
    const schemas: SchemaOutput[] = [];
    for (const tool of tools) {
      const schema = await getToolSchema(connection.client, tool.name, serviceName);
      if (schema) {
        schemas.push(schema);
      }
    }

    // Group tools by prefix
    const groups = detectPrefixGroups(schemas, serviceName);

    // Build SkillTemplateInput
    const descriptions = tools.map((t) => t.description);
    const triggerKeywords = extractTriggerKeywords(serviceName, descriptions);

    const input: SkillTemplateInput = {
      serviceName,
      description: `MCP tools for ${serviceName}`,
      tools,
      triggerKeywords,
    };

    // Generate SKILL.md
    const skillMd = generateSkillMd(input);

    // Token budget check
    const tokenCount = estimateTokens(skillMd);
    if (tokenCount > 300) {
      console.error(`Warning: SKILL.md estimated at ${tokenCount} tokens (target: <300)`);
    }

    // Generate reference files
    const generated = new Map<string, string>();
    generated.set("SKILL.md", skillMd);

    const referenceFiles: string[] = [];
    for (const group of groups) {
      const refMd = generateReferenceMd(group, serviceName);
      const refPath = `references/${group.filename}`;
      generated.set(refPath, refMd);
      referenceFiles.push(refPath);
    }

    // Resolve output directory
    const outputDir = resolveOutputDir(serviceName, outputFlag);

    // Dry-run: output plan without writing files
    if (dryRun) {
      console.log(JSON.stringify({
        dryRun: true,
        service: serviceName,
        outputDir,
        files: [...generated.keys()],
        tokenCount,
      }));
      process.exitCode = EXIT_CODES.DRY_RUN;
      return;
    }

    // Plan and execute file writes
    const plans = await planFileWrites(outputDir, generated, conflictMode);
    await executeFileWrites(plans);

    // Collect conflicts (skipped files)
    const conflicts = plans
      .filter((p) => p.action === "skip")
      .map((p) => p.path);

    // Output result
    const result = {
      service: serviceName,
      skillFile: `${outputDir}/SKILL.md`,
      referenceFiles: referenceFiles.map((f) => `${outputDir}/${f}`),
      tokenCount,
      conflicts,
    };
    console.log(JSON.stringify(result));
    process.exitCode = EXIT_CODES.SUCCESS;
  } finally {
    await connection.close();
  }
};
