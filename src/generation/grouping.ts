/**
 * Prefix-based tool grouping logic.
 * Clusters MCP tools by noun (object) for organized reference files.
 */
import type { SchemaOutput } from "../schema/types.ts";
import type { ToolGroup } from "./types.ts";

/**
 * Find and strip the longest common underscore-delimited prefix shared by ALL tool names.
 * If all tools share "n8n_", strips it. If no common prefix, returns empty prefix and originals.
 * Requires at least 2 tools to detect a prefix.
 */
export function stripServicePrefix(toolNames: string[]): {
  prefix: string;
  stripped: string[];
} {
  if (toolNames.length < 2) {
    return { prefix: "", stripped: [...toolNames] };
  }

  // Split each name into underscore segments
  const segmented = toolNames.map((n) => n.split("_"));

  // Find the longest common prefix segments shared by ALL tools
  const minSegments = Math.min(...segmented.map((s) => s.length));
  let commonCount = 0;

  for (let i = 0; i < minSegments - 1; i++) {
    const segment = segmented[0]![i]!;
    const allMatch = segmented.every((s) => s[i] === segment);
    if (allMatch) {
      commonCount = i + 1;
    } else {
      break;
    }
  }

  if (commonCount === 0) {
    return { prefix: "", stripped: [...toolNames] };
  }

  const prefix = segmented[0]!.slice(0, commonCount).join("_");
  const stripped = toolNames.map((n) => n.slice(prefix.length + 1)); // +1 for underscore

  return { prefix, stripped };
}

/**
 * Extract the noun (last meaningful underscore segment) from a tool name.
 * "list_workflows" -> "workflows", "get_workflow" -> "workflow"
 * Normalizes plurals: "workflows" and "workflow" map to same group key.
 */
function extractNoun(strippedName: string): string {
  const segments = strippedName.split("_");
  if (segments.length === 0) return "general";

  // Take the last segment as the noun
  const noun = segments[segments.length - 1]!;
  return noun;
}

/**
 * Normalize a noun for grouping -- strip trailing 's' for plural matching.
 * "workflows" -> "workflow", "executions" -> "execution"
 */
function normalizeNoun(noun: string): string {
  if (noun.length > 3 && noun.endsWith("s")) {
    return noun.slice(0, -1);
  }
  return noun;
}

/** Capitalize the first letter of a string */
function capitalize(s: string): string {
  if (s.length === 0) return s;
  return s[0]!.toUpperCase() + s.slice(1);
}

/**
 * Group tools by noun prefix. Groups with < 2 tools merge into "general".
 * If fewer than 2 distinct groups result, falls back to alphabetical chunking (~5-8 per file).
 */
export function detectPrefixGroups(
  tools: SchemaOutput[],
  serviceName: string,
): ToolGroup[] {
  if (tools.length === 0) return [];

  // Strip service prefix from tool names
  const toolNames = tools.map((t) => t.tool);
  const { stripped } = stripServicePrefix(toolNames);

  // Group by normalized noun
  const nounMap = new Map<string, SchemaOutput[]>();

  for (let i = 0; i < tools.length; i++) {
    const noun = extractNoun(stripped[i]!);
    const normalized = normalizeNoun(noun);
    const existing = nounMap.get(normalized) ?? [];
    existing.push(tools[i]!);
    nounMap.set(normalized, existing);
  }

  // Merge single-tool groups into "general"
  const generalTools: SchemaOutput[] = [];
  const validGroups = new Map<string, SchemaOutput[]>();

  for (const [noun, groupTools] of nounMap) {
    if (groupTools.length < 2) {
      generalTools.push(...groupTools);
    } else {
      validGroups.set(noun, groupTools);
    }
  }

  if (generalTools.length > 0) {
    const existing = validGroups.get("general") ?? [];
    existing.push(...generalTools);
    validGroups.set("general", existing);
  }

  // If fewer than 2 distinct groups, fall back to alphabetical chunking
  if (validGroups.size < 2) {
    return alphabeticalChunks(tools, serviceName);
  }

  // Build ToolGroup objects
  const groups: ToolGroup[] = [];
  for (const [noun, groupTools] of validGroups) {
    groups.push({
      prefix: noun,
      label: noun === "general" ? "General" : `${capitalize(noun)} Operations`,
      tools: groupTools,
      filename: `${noun}-ops.md`,
    });
  }

  // Sort groups alphabetically by prefix
  groups.sort((a, b) => a.prefix.localeCompare(b.prefix));

  return groups;
}

/**
 * Fallback: split tools into alphabetical chunks of ~5-8.
 */
function alphabeticalChunks(
  tools: SchemaOutput[],
  _serviceName: string,
): ToolGroup[] {
  const sorted = [...tools].sort((a, b) => a.tool.localeCompare(b.tool));
  const chunkSize = Math.min(8, Math.max(5, sorted.length));
  const groups: ToolGroup[] = [];

  for (let i = 0; i < sorted.length; i += chunkSize) {
    const chunk = sorted.slice(i, i + chunkSize);
    const idx = groups.length + 1;
    groups.push({
      prefix: `group-${idx}`,
      label: `Tools (Part ${idx})`,
      tools: chunk,
      filename: `tools-${idx}.md`,
    });
  }

  return groups;
}
