/**
 * Handle `mcp2cli cache <subcommand>` -- manage schema cache.
 * Supports: clear [service], status
 */
import { clearCache, listCachedServices, readCacheRaw } from "../../cache/index.ts";
import { EXIT_CODES } from "../../types/index.ts";
import type { CommandHandler } from "../../types/index.ts";

export const handleCache: CommandHandler = async (args: string[]) => {
  const subcommand = args[0];

  switch (subcommand) {
    case "clear":
      await handleCacheClear(args.slice(1));
      break;
    case "status":
      await handleCacheStatus();
      break;
    default:
      console.log(
        [
          "Usage: mcp2cli cache <subcommand>",
          "",
          "SUBCOMMANDS:",
          "    clear [service]    Clear cached schemas (all or specific service)",
          "    status             Show cache status for all services",
        ].join("\n"),
      );
      process.exitCode = subcommand ? EXIT_CODES.VALIDATION : EXIT_CODES.SUCCESS;
      break;
  }
};

async function handleCacheClear(args: string[]): Promise<void> {
  const service = args[0];
  const cleared = await clearCache(service);

  if (service) {
    if (cleared > 0) {
      console.log(`Cleared cache for service: ${service}`);
    } else {
      console.log(`No cache found for service: ${service}`);
    }
  } else {
    console.log(`Cleared ${cleared} cached schema${cleared === 1 ? "" : "s"}`);
  }

  process.exitCode = EXIT_CODES.SUCCESS;
}

async function handleCacheStatus(): Promise<void> {
  const services = await listCachedServices();

  if (services.length === 0) {
    console.log("No cached schemas found.");
    process.exitCode = EXIT_CODES.SUCCESS;
    return;
  }

  const lines: string[] = ["Cached schemas:", ""];

  for (const service of services.sort()) {
    const entry = await readCacheRaw(service);
    if (entry) {
      const age = Date.now() - new Date(entry.metadata.cachedAt).getTime();
      const ageHours = Math.round(age / (1000 * 60 * 60) * 10) / 10;
      const ttlHours = Math.round(entry.metadata.ttlMs / (1000 * 60 * 60) * 10) / 10;
      const expired = age > entry.metadata.ttlMs;
      const status = expired ? " (expired)" : "";
      lines.push(
        `    ${service}: ${entry.metadata.toolCount} tools, ${ageHours}h old (TTL: ${ttlHours}h)${status}`,
      );
    }
  }

  console.log(lines.join("\n"));
  process.exitCode = EXIT_CODES.SUCCESS;
}
