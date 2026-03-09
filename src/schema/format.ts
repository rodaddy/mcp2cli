/**
 * Output formatters for tool listings and schema details.
 * Supports both human-readable and AI JSON modes.
 */
import type { SchemaOutput, ToolListing } from "./types.ts";

/**
 * Truncate a description to first sentence or 80 chars.
 * Handles empty/undefined input gracefully.
 */
export function truncateDescription(desc: string): string {
  if (!desc) return "(no description)";

  // Try to extract first sentence (split on ". " or ".\n" or terminal ".")
  const sentenceMatch = desc.match(/^[^.]*\./);
  if (sentenceMatch && sentenceMatch[0]!.length <= 80) {
    return sentenceMatch[0]!;
  }

  // Truncate at 80 chars if too long
  if (desc.length > 80) {
    return desc.slice(0, 80) + "...";
  }

  return desc;
}

/**
 * Format a tool listing for human or AI consumption.
 * Human mode: structured text with TOOLS/USAGE/EXAMPLES sections.
 * AI mode: flat JSON structure.
 */
export function formatToolListing(
  listing: ToolListing,
  aiMode: boolean,
): string {
  if (aiMode) {
    return JSON.stringify({
      service: listing.service,
      description: listing.description,
      tools: listing.tools,
      usage: listing.usage,
    });
  }

  // Human-readable format
  const lines: string[] = [];

  // Header
  lines.push(`${listing.service} -- ${listing.description}`);
  lines.push("");

  // Tools section
  lines.push("TOOLS:");

  // Calculate max name length for alignment
  const maxNameLen = Math.max(...listing.tools.map((t) => t.name.length));

  for (const tool of listing.tools) {
    const padding = " ".repeat(maxNameLen - tool.name.length + 4);
    lines.push(`    ${tool.name}${padding}${tool.description}`);
  }

  lines.push("");

  // Usage section
  lines.push("USAGE:");
  lines.push(`    ${listing.usage}`);
  lines.push(`    mcp2cli schema ${listing.service}.<tool>`);
  lines.push("");

  // Examples section (first 3 tools)
  lines.push("EXAMPLES:");
  const exampleTools = listing.tools.slice(0, 3);
  for (const tool of exampleTools) {
    lines.push(`    mcp2cli ${listing.service} ${tool.name}`);
  }

  return lines.join("\n");
}

/**
 * Format schema output as pretty-printed JSON.
 * Always JSON -- both human and AI consumers want the raw schema.
 */
export function formatSchemaOutput(output: SchemaOutput): string {
  // Build output object, omitting undefined annotations
  const result: Record<string, unknown> = {
    tool: output.tool,
    description: output.description,
    inputSchema: output.inputSchema,
  };

  if (output.annotations !== undefined) {
    result.annotations = output.annotations;
  }

  result.usage = output.usage;

  return JSON.stringify(result, null, 2);
}
