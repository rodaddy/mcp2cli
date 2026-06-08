/**
 * Handle `mcp2cli cache <subcommand>` -- manage schema cache.
 * Supports: clear [service], status, diff <service>
 */
import { clearCache, listCachedServices, readCacheRaw, detectDrift, resolveTtlMs, writeCache, mapToolsToCachedSchemas } from "../../cache/index.ts";
import { loadConfig } from "../../config/index.ts";
import { connectToService, connectToHttpService } from "../../connection/index.ts";
import { connectToWebSocketService } from "../../connection/websocket-transport.ts";
import { listAllTools } from "../../schema/introspect.ts";
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
    case "diff":
      await handleCacheDiff(args.slice(1));
      break;
    case "warm":
      await handleCacheWarm(args.slice(1));
      break;
    default:
      console.log(
        [
          "Usage: mcp2cli cache <subcommand>",
          "",
          "SUBCOMMANDS:",
          "    clear [service]    Clear cached schemas (all or specific service)",
          "    status             Show cache status for all services",
          "    diff <service>     Compare cached vs live schemas for a service",
          "    warm [service]     Fetch and cache schemas (all or specific service)",
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

async function handleCacheDiff(args: string[]): Promise<void> {
  const serviceName = args[0];
  if (!serviceName) {
    console.error("Usage: mcp2cli cache diff <service>");
    process.exitCode = EXIT_CODES.VALIDATION;
    return;
  }

  const cached = await readCacheRaw(serviceName);
  if (!cached) {
    console.log(`No cached schemas for "${serviceName}". Run a command against this service first to populate the cache.`);
    process.exitCode = EXIT_CODES.SUCCESS;
    return;
  }

  const config = await loadConfig();
  const service = config.services[serviceName];
  if (!service) {
    console.error(`Unknown service: "${serviceName}"`);
    process.exitCode = EXIT_CODES.VALIDATION;
    return;
  }

  const connection = service.backend === "http"
    ? await connectToHttpService(service)
    : service.backend === "websocket"
      ? await connectToWebSocketService(service)
      : await connectToService(service);

  try {
    const rawTools = await listAllTools(connection.client);
    const liveSchemas = await mapToolsToCachedSchemas(rawTools);

    const drift = detectDrift(serviceName, cached.tools, liveSchemas, cached.metadata.cachedAt);

    if (!drift.hasDrift) {
      console.log(`No schema drift detected for "${serviceName}". Cache is current.`);
    } else {
      const lines = [`Schema drift detected for "${serviceName}":\n`];
      for (const change of drift.changes) {
        const detail = change.details ? ` (${change.details})` : "";
        const symbol = change.type === "added" ? "+" : change.type === "removed" ? "-" : "~";
        lines.push(`  ${symbol} ${change.tool}${detail}`);
      }
      lines.push(`\nCached at: ${drift.cachedAt}`);
      lines.push(`Detected at: ${drift.detectedAt}`);
      console.log(lines.join("\n"));
    }

    // Update cache with live data
    await writeCache(serviceName, liveSchemas, resolveTtlMs());
    process.exitCode = EXIT_CODES.SUCCESS;
  } finally {
    await connection.close();
  }
}

async function handleCacheWarm(args: string[]): Promise<void> {
  const targetService = args[0];
  const config = await loadConfig();
  const serviceNames = targetService
    ? [targetService]
    : Object.keys(config.services);

  if (targetService && !config.services[targetService]) {
    console.error(`Unknown service: "${targetService}"`);
    process.exitCode = EXIT_CODES.VALIDATION;
    return;
  }

  let warmed = 0;
  let failed = 0;

  const PER_SERVICE_TIMEOUT = 30_000;

  for (const serviceName of serviceNames) {
    const service = config.services[serviceName]!;
    console.log(`  warming ${serviceName}...`);
    try {
      const result = await Promise.race([
        (async () => {
          const connection = service.backend === "http"
            ? await connectToHttpService(service)
            : service.backend === "websocket"
              ? await connectToWebSocketService(service)
              : await connectToService(service);

          try {
            const rawTools = await listAllTools(connection.client);
            const schemas = await mapToolsToCachedSchemas(rawTools);
            await writeCache(serviceName, schemas, resolveTtlMs());
            return schemas.length;
          } finally {
            await connection.close();
          }
        })(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`timed out after ${PER_SERVICE_TIMEOUT}ms`)), PER_SERVICE_TIMEOUT),
        ),
      ]);
      console.log(`  ${serviceName}: ${result} tools cached`);
      warmed++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`  ${serviceName}: failed (${message})`);
      failed++;
    }
  }

  console.log(`\nWarmed ${warmed} service${warmed === 1 ? "" : "s"}${failed > 0 ? `, ${failed} failed` : ""}`);
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
