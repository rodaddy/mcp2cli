/**
 * Markdown generation pure functions.
 * Produces SKILL.md and reference file content from structured inputs.
 */
import type { SkillTemplateInput, ToolGroup } from "./types.ts";
import { generateUsageExample } from "../schema/introspect.ts";

/** Estimate token count using simple character-based heuristic */
export function estimateTokens(text: string): number {
  if (text.length === 0) return 0;
  return Math.ceil(text.length / 4);
}

/** Auto-generated section markers */
export const MARKER_START = "<!-- AUTO-GENERATED:START -->";
export const MARKER_END = "<!-- AUTO-GENERATED:END -->";

/** Manual (user-editable) section markers */
const MANUAL_START = "<!-- MANUAL:START -->";
const MANUAL_END = "<!-- MANUAL:END -->";

/**
 * Generate a slim SKILL.md front skill: YAML frontmatter, a routing index of
 * tool *groups* (each linking to its reference file), and the invoke pattern.
 *
 * Progressive-disclosure shape (per PAI skill-creator standard): the front skill
 * carries only routing -- the per-tool detail lives in `references/*.md`. The flat
 * per-tool listing is intentionally NOT inlined here; it would blow the token
 * budget for large services (a 46-tool service was ~1100 tokens with the old
 * inline table). Falls back to a flat tool list only when no groups are supplied.
 */
export function generateSkillMd(input: SkillTemplateInput): string {
  const lines: string[] = [];

  // YAML frontmatter
  lines.push("---");
  lines.push(`name: ${input.serviceName}`);
  lines.push(`description: ${input.description}`);
  if (input.toolCount !== undefined) {
    lines.push(`tool_count: ${input.toolCount}`);
  }
  if (input.generatedAt) {
    lines.push(`generated_at: ${input.generatedAt}`);
  }
  if (input.schemaHash) {
    lines.push(`schema_hash: ${input.schemaHash}`);
  }
  lines.push("triggers:");
  for (const keyword of input.triggerKeywords) {
    lines.push(`  - ${keyword}`);
  }
  lines.push("---");
  lines.push("");

  // Title
  lines.push(`# ${input.serviceName}`);
  lines.push("");
  lines.push(input.description);
  lines.push("");

  // Auto-generated section
  lines.push(MARKER_START);
  lines.push("");

  const groups = input.groups ?? [];

  if (groups.length > 0) {
    // Routing index: one row per group, linking to its reference file.
    lines.push("## Tool Groups");
    lines.push("");
    lines.push("| Group | Tools | Reference |");
    lines.push("|-------|-------|-----------|");
    for (const group of groups) {
      const names = group.tools.map((t) => t.tool).join(", ");
      lines.push(
        `| ${group.label} | ${names.replace(/\|/g, "\\|")} | [${group.filename}](references/${group.filename}) |`,
      );
    }
    lines.push("");
  } else {
    // Fallback (no grouping available): flat tool name list, no descriptions.
    lines.push("## Tools");
    lines.push("");
    for (const tool of input.tools) {
      lines.push(`- ${tool.name}`);
    }
    lines.push("");
  }

  // Invoke pattern
  lines.push("## Usage");
  lines.push("");
  lines.push("```bash");
  lines.push(`mcp2cli ${input.serviceName} <tool> --params '{...}'`);
  lines.push("```");
  lines.push("");

  // References pointer
  lines.push("See `references/` for per-tool parameters, types, and examples.");
  lines.push("");

  lines.push(MARKER_END);
  lines.push("");

  // Manual section for user customizations (preserved across regeneration)
  lines.push("## Notes");
  lines.push("");
  lines.push(MANUAL_START);
  lines.push("<!-- Add your custom notes, examples, or overrides here -->");
  lines.push(MANUAL_END);
  lines.push("");

  return lines.join("\n");
}

/** Type for JSON Schema properties used in reference generation */
interface SchemaProperties {
  type?: string;
  properties?: Record<
    string,
    { type?: string; description?: string; required?: boolean }
  >;
  required?: string[];
}

/**
 * Generate a reference markdown file for a tool group.
 * Contains per-tool sections with description, parameter table, and example.
 */
export function generateReferenceMd(
  group: ToolGroup,
  serviceName: string,
): string {
  const lines: string[] = [];

  // Header
  lines.push(`# ${serviceName} -- ${group.label}`);
  lines.push("");
  lines.push(MARKER_START);
  lines.push("");

  for (const tool of group.tools) {
    // Tool section
    lines.push(`## ${tool.tool}`);
    lines.push("");
    lines.push(tool.description.replace(/\|/g, "\\|"));
    lines.push("");

    // Parameter table
    const schema = tool.inputSchema as SchemaProperties;
    const properties = schema.properties ?? {};
    const required = schema.required ?? [];
    const paramNames = Object.keys(properties);

    if (paramNames.length > 0) {
      lines.push("### Parameters");
      lines.push("");
      lines.push("| Name | Type | Required | Description |");
      lines.push("|------|------|----------|-------------|");

      for (const paramName of paramNames) {
        const prop = properties[paramName]!;
        const isRequired = required.includes(paramName) ? "Yes" : "No";
        const paramType = prop.type ?? "string";
        const desc = (prop.description ?? "").replace(/\|/g, "\\|");
        lines.push(`| ${paramName} | ${paramType} | ${isRequired} | ${desc} |`);
      }

      lines.push("");
    }

    // Example invocation
    lines.push("### Example");
    lines.push("");
    lines.push("```bash");
    lines.push(generateUsageExample(serviceName, tool.tool, tool.inputSchema));
    lines.push("```");
    lines.push("");
  }

  lines.push(MARKER_END);
  lines.push("");

  return lines.join("\n");
}
