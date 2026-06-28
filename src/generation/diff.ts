/**
 * Skill file diff preview.
 * Compares existing skill file tool lists against newly generated tool lists
 * to produce a human-readable diff showing added, removed, and modified tools.
 */
import type { ToolSummary } from "../schema/types.ts";
import { MARKER_START, MARKER_END } from "./templates.ts";

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
 * Parse tool names from an existing SKILL.md front skill.
 *
 * The slim front skill lists tools two ways, both supported here:
 *  - a "Tool Groups" table whose middle column is a comma-separated tool list
 *    (`| Group | Tools | Reference |`), or
 *  - a flat fallback bullet list (`- tool_name`) when no grouping was available.
 *
 * Descriptions live in `references/*.md`, not the front skill, so they are not
 * recovered here -- name-level add/remove diffing plus the frontmatter
 * `schema_hash` are the drift signals for the front skill.
 *
 * The legacy `| Tool | Description |` quick-reference table is still parsed so
 * diffs against pre-existing generated skills keep working during migration.
 */
export function parseExistingTools(skillContent: string): ToolSummary[] {
  const tools: ToolSummary[] = [];

  // Only parse the auto-generated block. Outside it live YAML frontmatter
  // (whose `triggers:` bullets look like flat tool entries) and the manual
  // Notes section -- scanning those produced phantom tools and made every
  // `--diff` report spurious removals. If the markers are absent (e.g. a
  // pre-marker hand-authored file), fall back to scanning the whole content.
  const startIdx = skillContent.indexOf(MARKER_START);
  const endIdx = skillContent.indexOf(MARKER_END);
  const scoped =
    startIdx !== -1 && endIdx !== -1 && endIdx > startIdx
      ? skillContent.slice(startIdx + MARKER_START.length, endIdx)
      : skillContent;
  const lines = scoped.split("\n");

  // Mode: parsing rows of a markdown table we recognized via its header.
  type TableKind = "legacy" | "groups" | null;
  let tableKind: TableKind = null;
  let headerSeen = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // Legacy quick-reference table header: | Tool | Description |
    if (
      (trimmed.startsWith("| Tool |") || trimmed.startsWith("| tool |")) &&
      trimmed.includes("Description")
    ) {
      tableKind = "legacy";
      headerSeen = false;
      continue;
    }

    // New group-index table header: | Group | Tools | Reference |
    if (trimmed.startsWith("| Group |") && trimmed.includes("Tools")) {
      tableKind = "groups";
      headerSeen = false;
      continue;
    }

    // Skip separator row (|------|...)
    if (tableKind && !headerSeen && trimmed.startsWith("|---")) {
      headerSeen = true;
      continue;
    }

    // Parse data rows
    if (tableKind && headerSeen && trimmed.startsWith("|")) {
      const cells = trimmed
        .split("|")
        .map((c) => c.trim())
        .filter((c) => c.length > 0);

      if (tableKind === "legacy" && cells.length >= 2) {
        tools.push({ name: cells[0]!, description: cells[1]! });
      } else if (tableKind === "groups" && cells.length >= 2) {
        // Middle column is a comma-separated list of tool names.
        for (const name of cells[1]!.split(",").map((n) => n.trim())) {
          if (name.length > 0) tools.push({ name, description: "" });
        }
      }
      continue;
    }

    // End of table
    if (tableKind && headerSeen && !trimmed.startsWith("|")) {
      tableKind = null;
    }

    // Flat fallback list: "- tool_name" (no table, no spaces in the name).
    if (!tableKind && trimmed.startsWith("- ")) {
      const name = trimmed.slice(2).trim();
      if (name.length > 0 && !name.includes(" ")) {
        tools.push({ name, description: "" });
      }
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
    } else if (
      // The slim group-index front skill stores no per-tool descriptions, so a
      // parsed empty description means "unknown", not "changed to empty". Only
      // flag a real description change to avoid every tool showing as modified.
      existing.description !== "" &&
      existing.description !== newTool.description
    ) {
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
