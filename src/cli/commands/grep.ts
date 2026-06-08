/**
 * Handle `mcp2cli grep "pattern"` / `mcp2cli search "pattern"`
 * Search tool names and descriptions across cached services.
 * Cache-only operation -- never connects to MCP servers.
 */
import { listCachedServices, readCacheRaw } from "../../cache/index.ts";
import { EXIT_CODES } from "../../types/index.ts";
import type { CommandHandler } from "../../types/index.ts";

interface SearchMatch {
  service: string;
  tool: string;
  description: string;
  match: "name" | "description" | "both";
}

const MAX_PATTERN_LENGTH = 1000;
const KNOWN_FLAGS = new Set(["--json"]);

export const handleGrep: CommandHandler = async (args: string[]) => {
  const jsonMode = args.includes("--json");
  const positionalArgs = args.filter((a) => !KNOWN_FLAGS.has(a));

  const unknownFlag = positionalArgs.find((a) => a.startsWith("--"));
  if (unknownFlag) {
    console.error(`Unknown flag: ${unknownFlag}. Use --json for structured output.`);
    process.exitCode = EXIT_CODES.VALIDATION;
    return;
  }

  const pattern = positionalArgs[0];

  if (!pattern || !pattern.trim()) {
    console.log(
      [
        "Usage: mcp2cli search <pattern> [--json]",
        "",
        "Search tool names and descriptions across all cached services.",
        "Pattern matching is case-insensitive substring match.",
        "",
        "OPTIONS:",
        "    --json    Output results as structured JSON",
        "",
        "EXAMPLES:",
        '    mcp2cli search "workflow"',
        '    mcp2cli search "list" --json',
        '    mcp2cli grep "session"',
      ].join("\n"),
    );
    process.exitCode = EXIT_CODES.SUCCESS;
    return;
  }

  if (pattern.length > MAX_PATTERN_LENGTH) {
    console.error(`Search pattern exceeds maximum length of ${MAX_PATTERN_LENGTH} characters.`);
    process.exitCode = EXIT_CODES.VALIDATION;
    return;
  }

  const services = await listCachedServices();

  if (services.length === 0) {
    if (jsonMode) {
      console.log(JSON.stringify({ query: pattern, matches: [], total: 0 }));
    } else {
      console.log(
        "No cached schemas found. Run 'mcp2cli cache warm' or 'mcp2cli <service> --help' to populate the cache.",
      );
    }
    process.exitCode = EXIT_CODES.SUCCESS;
    return;
  }

  const lowerPattern = pattern.toLowerCase();
  const matches: SearchMatch[] = [];

  for (const service of services.sort()) {
    const entry = await readCacheRaw(service);
    if (!entry) continue;

    for (const tool of entry.tools) {
      const desc = tool.description ?? "";
      const nameMatch = tool.name.toLowerCase().includes(lowerPattern);
      const descMatch = desc.toLowerCase().includes(lowerPattern);

      if (nameMatch || descMatch) {
        matches.push({
          service,
          tool: tool.name,
          description: desc,
          match: nameMatch && descMatch ? "both" : nameMatch ? "name" : "description",
        });
      }
    }
  }

  if (jsonMode) {
    console.log(JSON.stringify({ query: pattern, matches, total: matches.length }));
  } else if (matches.length === 0) {
    console.log(`No tools matching "${pattern}" found in cached schemas.`);
  } else {
    for (const m of matches) {
      console.log(`${m.service}.${m.tool} -- ${m.description}`);
    }
  }

  process.exitCode = EXIT_CODES.SUCCESS;
};
