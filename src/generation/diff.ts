/**
 * Skill file diff preview.
 * Compares existing skill file tool lists against newly generated tool lists
 * to produce a human-readable diff showing added, removed, and modified tools.
 */
import type { ToolSummary } from "../schema/types.ts";

/** Classification of a single tool change */
export interface ToolChange {
  tool: string;
  type: "added" | "removed" | "modified";
  /** For modified tools -- what changed */
  details?: string;
}

/** Complete diff result for a skill file */
export interface SkillDiffResult {
  service: string;
  hasChanges: boolean;
  added: ToolChange[];
  removed: ToolChange[];
  modified: ToolChange[];
  /** Total tool count in the new version */
  newToolCount: number;
  /** Total tool count in the existing version */
  existingToolCount: number;
}

/**
 * Parse tool names and descriptions from an existing SKILL.md file.
 * Extracts from the quick reference table (| Tool | Description |).
 */
export function parseExistingTools(skillContent: string): ToolSummary[] {
  const tools: ToolSummary[] = [];
  const lines = skillContent.split("\n");

  let inTable = false;
  let headerSeen = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // Detect table start by header row (exact match on "| Tool |" pattern)
    if (
      (trimmed.startsWith("| Tool |") || trimmed.startsWith("| tool |")) &&
      trimmed.includes("Description")
    ) {
      inTable = true;
      headerSeen = false;
      continue;
    }

    // Skip separator row (|------|...)
    if (inTable && !headerSeen && trimmed.startsWith("|---")) {
      headerSeen = true;
      continue;
    }

    // Parse data rows
    if (inTable && headerSeen && trimmed.startsWith("|")) {
      const cells = trimmed
        .split("|")
        .map((c) => c.trim())
        .filter((c) => c.length > 0);

      if (cells.length >= 2) {
        tools.push({
          name: cells[0]!,
          description: cells[1]!,
        });
      }
      continue;
    }

    // End of table
    if (inTable && headerSeen && !trimmed.startsWith("|")) {
      inTable = false;
    }
  }

  return tools;
}

/**
 * Compute the diff between existing and new tool lists.
 * Identifies added, removed, and modified (description changed) tools.
 */
export function computeSkillDiff(
  service: string,
  existingTools: ToolSummary[],
  newTools: ToolSummary[],
): SkillDiffResult {
  const existingMap = new Map(existingTools.map((t) => [t.name, t]));
  const newMap = new Map(newTools.map((t) => [t.name, t]));

  const added: ToolChange[] = [];
  const removed: ToolChange[] = [];
  const modified: ToolChange[] = [];

  // Find removed tools
  for (const [name] of existingMap) {
    if (!newMap.has(name)) {
      removed.push({ tool: name, type: "removed" });
    }
  }

  // Find added and modified tools
  for (const [name, newTool] of newMap) {
    const existing = existingMap.get(name);
    if (!existing) {
      added.push({ tool: name, type: "added" });
    } else if (existing.description !== newTool.description) {
      modified.push({
        tool: name,
        type: "modified",
        details: `description: "${truncate(existing.description, 40)}" -> "${truncate(newTool.description, 40)}"`,
      });
    }
  }

  // Sort each list for deterministic output
  added.sort((a, b) => a.tool.localeCompare(b.tool));
  removed.sort((a, b) => a.tool.localeCompare(b.tool));
  modified.sort((a, b) => a.tool.localeCompare(b.tool));

  return {
    service,
    hasChanges: added.length > 0 || removed.length > 0 || modified.length > 0,
    added,
    removed,
    modified,
    newToolCount: newTools.length,
    existingToolCount: existingTools.length,
  };
}

/** Truncate a string with ellipsis */
function truncate(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen - 3) + "...";
}

/**
 * Format a diff result as human-readable text for terminal output.
 * Uses +/- /~ prefixes like a simplified diff.
 */
export function formatDiffPreview(diff: SkillDiffResult): string {
  const lines: string[] = [];

  lines.push(`Skill diff for "${diff.service}":`);
  lines.push(
    `  Existing: ${diff.existingToolCount} tools -> New: ${diff.newToolCount} tools`,
  );
  lines.push("");

  if (!diff.hasChanges) {
    lines.push("  No changes detected.");
    return lines.join("\n");
  }

  if (diff.added.length > 0) {
    lines.push(`  Added (${diff.added.length}):`);
    for (const change of diff.added) {
      lines.push(`    + ${change.tool}`);
    }
    lines.push("");
  }

  if (diff.removed.length > 0) {
    lines.push(`  Removed (${diff.removed.length}):`);
    for (const change of diff.removed) {
      lines.push(`    - ${change.tool}`);
    }
    lines.push("");
  }

  if (diff.modified.length > 0) {
    lines.push(`  Modified (${diff.modified.length}):`);
    for (const change of diff.modified) {
      const detail = change.details ? ` (${change.details})` : "";
      lines.push(`    ~ ${change.tool}${detail}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
