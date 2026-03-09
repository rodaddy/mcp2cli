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
const MARKER_START = "<!-- AUTO-GENERATED:START -->";
const MARKER_END = "<!-- AUTO-GENERATED:END -->";

/**
 * Generate a slim SKILL.md file with YAML frontmatter, tool table, and invoke pattern.
 * Stays under 300 tokens for typical services.
 */
export function generateSkillMd(input: SkillTemplateInput): string {
  const lines: string[] = [];

  // YAML frontmatter
  lines.push("---");
  lines.push(`name: ${input.serviceName}`);
  lines.push(`description: ${input.description}`);
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

  // Quick reference tool table
  lines.push("## Quick Reference");
  lines.push("");
  lines.push("| Tool | Description |");
  lines.push("|------|-------------|");
  for (const tool of input.tools) {
    lines.push(`| ${tool.name} | ${tool.description} |`);
  }
  lines.push("");

  // Invoke pattern
  lines.push("## Usage");
  lines.push("");
  lines.push("```bash");
  lines.push(`mcp2cli ${input.serviceName} <tool> --params '{...}'`);
  lines.push("```");
  lines.push("");

  // References pointer
  lines.push("See `references/` for detailed parameter docs per tool.");
  lines.push("");

  lines.push(MARKER_END);
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
    lines.push(tool.description);
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
        const desc = prop.description ?? "";
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
