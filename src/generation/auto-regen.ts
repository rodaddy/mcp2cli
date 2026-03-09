/**
 * Auto-regeneration of skill files triggered by schema drift.
 * Called from the drift hook when tool schemas change.
 * Preserves manual sections and respects access control.
 */
import type { ToolSummary } from "../schema/types.ts";
import type { AccessPolicy } from "../access/types.ts";
import type { SkillTemplateInput } from "./types.ts";
import { filterTools } from "../access/filter.ts";
import { generateSkillMd, generateReferenceMd, estimateTokens } from "./templates.ts";
import { detectPrefixGroups } from "./grouping.ts";
import { resolveOutputDir, planFileWrites, executeFileWrites } from "./file-manager.ts";
import { extractManualSections, injectManualSections } from "./preserve.ts";
import { createLogger } from "../logger/index.ts";
import { join } from "node:path";

const log = createLogger("auto-regen");

/** Result of an auto-regeneration attempt */
export interface AutoRegenResult {
  service: string;
  regenerated: boolean;
  filesWritten: string[];
  manualSectionsPreserved: number;
  toolCount: number;
  error?: string;
}

/**
 * Auto-regenerate skill files for a service after drift detection.
 * Non-blocking -- errors are logged but never propagated.
 *
 * @param serviceName - The service whose skills need regeneration
 * @param tools - Live tool list from the MCP server
 * @param policy - Access control policy to filter tools
 * @param outputDir - Optional override for output directory
 */
export async function autoRegenerateSkills(
  serviceName: string,
  tools: ToolSummary[],
  policy: AccessPolicy = {},
  outputDir?: string,
): Promise<AutoRegenResult> {
  const result: AutoRegenResult = {
    service: serviceName,
    regenerated: false,
    filesWritten: [],
    manualSectionsPreserved: 0,
    toolCount: 0,
  };

  try {
    // Apply access control
    const filteredTools = filterTools(tools, policy);
    result.toolCount = filteredTools.length;

    if (filteredTools.length === 0) {
      log.debug("auto_regen_skipped", {
        service: serviceName,
        reason: "no_tools_after_filtering",
      });
      return result;
    }

    // Build skill template input
    const input: SkillTemplateInput = {
      serviceName,
      description: `MCP tools for ${serviceName}`,
      tools: filteredTools,
      triggerKeywords: [serviceName],
    };

    // Resolve output directory
    const resolvedDir = outputDir ?? resolveOutputDir(serviceName);

    // Generate new SKILL.md
    let skillMd = generateSkillMd(input);

    // Preserve manual sections from existing file
    const existingSkillPath = join(resolvedDir, "SKILL.md");
    const existingFile = Bun.file(existingSkillPath);
    if (await existingFile.exists()) {
      const existingContent = await existingFile.text();
      const manualSections = extractManualSections(existingContent);
      if (manualSections.length > 0) {
        skillMd = injectManualSections(skillMd, manualSections);
        result.manualSectionsPreserved = manualSections.length;
      }
    }

    // Build schemas for reference file generation
    // Use minimal SchemaOutput objects from ToolSummary data
    const schemas = filteredTools.map((t) => ({
      tool: t.name,
      description: t.description,
      inputSchema: {} as object,
      usage: `mcp2cli ${serviceName} ${t.name}`,
    }));

    const groups = detectPrefixGroups(schemas, serviceName);

    // Collect generated files
    const generated = new Map<string, string>();
    generated.set("SKILL.md", skillMd);

    for (const group of groups) {
      const refMd = generateReferenceMd(group, serviceName);
      generated.set(`references/${group.filename}`, refMd);
    }

    // Write files using merge mode to preserve user content outside markers
    const plans = await planFileWrites(resolvedDir, generated, "merge");
    const written = await executeFileWrites(plans);

    result.regenerated = true;
    result.filesWritten = written;

    const tokenCount = estimateTokens(skillMd);
    log.info("auto_regen_complete", {
      service: serviceName,
      filesWritten: written.length,
      manualSectionsPreserved: result.manualSectionsPreserved,
      toolCount: filteredTools.length,
      tokenCount,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    result.error = message;
    log.warn("auto_regen_failed", { service: serviceName, error: message });
  }

  return result;
}
