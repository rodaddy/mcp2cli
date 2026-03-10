/**
 * Handle `mcp2cli grep "pattern"` -- search tool names and descriptions across cached services.
 * Cache-only operation -- never connects to MCP servers.
 */
import { listCachedServices, readCacheRaw } from "../../cache/index.ts";
import { EXIT_CODES } from "../../types/index.ts";
import type { CommandHandler } from "../../types/index.ts";

export const handleGrep: CommandHandler = async (args: string[]) => {
  const pattern = args[0];

  if (!pattern) {
    console.log(
      [
        "Usage: mcp2cli grep <pattern>",
        "",
        "Search tool names and descriptions across all cached services.",
        "Pattern matching is case-insensitive substring match.",
        "",
        "EXAMPLES:",
        '    mcp2cli grep "workflow"',
        '    mcp2cli grep "list"',
      ].join("\n"),
    );
    process.exitCode = EXIT_CODES.SUCCESS;
    return;
  }

  const services = await listCachedServices();

  if (services.length === 0) {
    console.log(
      "No cached schemas found. Run 'mcp2cli <service> --help' or 'mcp2cli schema <service>.<tool>' to populate the cache.",
    );
    process.exitCode = EXIT_CODES.SUCCESS;
    return;
  }

  const lowerPattern = pattern.toLowerCase();
  const matches: string[] = [];

  for (const service of services.sort()) {
    const entry = await readCacheRaw(service);
    if (!entry) continue;

    for (const tool of entry.tools) {
      const nameMatch = tool.name.toLowerCase().includes(lowerPattern);
      const descMatch = tool.description.toLowerCase().includes(lowerPattern);

      if (nameMatch || descMatch) {
        matches.push(`${service}.${tool.name} -- ${tool.description}`);
      }
    }
  }

  if (matches.length === 0) {
    console.log(`No tools matching "${pattern}" found in cached schemas.`);
  } else {
    console.log(matches.join("\n"));
  }

  process.exitCode = EXIT_CODES.SUCCESS;
};
