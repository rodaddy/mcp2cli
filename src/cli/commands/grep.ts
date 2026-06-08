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

export const handleGrep: CommandHandler = async (args: string[]) => {
  const jsonMode = args.includes("--json");
  const positionalArgs = args.filter((a) => a !== "--json");
  const pattern = positionalArgs[0];

  if (!pattern) {
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
      const nameMatch = tool.name.toLowerCase().includes(lowerPattern);
      const descMatch = tool.description.toLowerCase().includes(lowerPattern);

      if (nameMatch || descMatch) {
        matches.push({
          service,
          tool: tool.name,
          description: tool.description,
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
