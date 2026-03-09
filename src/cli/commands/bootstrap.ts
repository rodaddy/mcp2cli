import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { printError } from "../errors.ts";
import { loadConfig, getConfigPath } from "../../config/index.ts";
import { ConfigError } from "../../config/errors.ts";
import { EXIT_CODES } from "../../types/index.ts";
import type { ServicesConfig } from "../../config/schema.ts";

/**
 * Result of converting a single claude.json mcpServer entry.
 */
interface ConvertResult {
  name: string;
  config?: {
    backend: "stdio";
    command: string;
    args?: string[];
    env?: Record<string, string>;
  } | {
    backend: "http";
    url: string;
    headers?: Record<string, string>;
  };
  warning?: string;
}

/**
 * Result of merging converted entries with existing config.
 */
interface MergeResult {
  added: string[];
  skipped: string[];
  warnings: string[];
  merged: { services: Record<string, unknown> };
}

/**
 * Read and parse ~/.claude.json from the given home directory.
 * Returns null if file doesn't exist (never throws for missing file).
 */
export async function readClaudeConfig(
  homePath: string,
): Promise<unknown | null> {
  const filePath = `${homePath}/.claude.json`;
  const file = Bun.file(filePath);
  const exists = await file.exists();
  if (!exists) return null;

  const text = await file.text();
  return JSON.parse(text);
}

/**
 * Extract mcpServers entries from root level of parsed claude.json.
 * Returns array of { name, entry } pairs. Empty array if key missing.
 */
export function extractMcpServers(
  config: unknown,
): Array<{ name: string; entry: Record<string, unknown> }> {
  if (
    typeof config !== "object" ||
    config === null ||
    !("mcpServers" in config)
  ) {
    return [];
  }

  const servers = (config as Record<string, unknown>).mcpServers;
  if (typeof servers !== "object" || servers === null) return [];

  return Object.entries(servers as Record<string, unknown>).map(
    ([name, entry]) => ({
      name,
      entry: entry as Record<string, unknown>,
    }),
  );
}

/**
 * Convert a single claude.json mcpServer entry to services.json format.
 * Returns config for stdio entries, warning for HTTP/SSE or invalid entries.
 */
export function convertEntry(
  name: string,
  entry: Record<string, unknown>,
): ConvertResult {
  // Convert HTTP/SSE transport entries
  const entryType = entry.type as string | undefined;
  if (
    entryType === "http" ||
    entryType === "sse" ||
    (entryType === undefined && "url" in entry && !("command" in entry))
  ) {
    const url = entry.url as string | undefined;
    if (!url) {
      return {
        name,
        warning: `${name}: HTTP/SSE entry missing url field`,
      };
    }
    const headers = (entry.headers as Record<string, string>) ?? {};
    return {
      name,
      config: { backend: "http", url, headers },
    };
  }

  // Check for missing command
  if (!("command" in entry) || !entry.command) {
    return {
      name,
      warning: `${name}: no command field`,
    };
  }

  const command = entry.command as string;
  const args = (entry.args as string[]) ?? [];
  const env = (entry.env as Record<string, string>) ?? {};

  const result: ConvertResult = {
    name,
    config: { backend: "stdio", command, args, env },
  };

  // Check for interpolation syntax in env values
  const interpKeys = Object.entries(env)
    .filter(([, v]) => v.includes("${"))
    .map(([k]) => k);

  if (interpKeys.length > 0) {
    result.warning = `${name}: env vars [${interpKeys.join(", ")}] use interpolation syntax -- needs manual replacement`;
  }

  return result;
}

/**
 * Merge converted entries with existing services config.
 * Skips entries where name already exists. Tracks added, skipped, warnings.
 */
export function mergeEntries(
  converted: ConvertResult[],
  existingConfig: { services: Record<string, unknown> },
): MergeResult {
  const added: string[] = [];
  const skipped: string[] = [];
  const warnings: string[] = [];
  const merged: { services: Record<string, unknown> } = {
    services: { ...existingConfig.services },
  };

  for (const item of converted) {
    if (item.warning) {
      warnings.push(item.warning);
    }

    if (!item.config) continue;

    if (item.name in existingConfig.services) {
      skipped.push(item.name);
    } else {
      added.push(item.name);
      merged.services[item.name] = item.config;
    }
  }

  return { added, skipped, warnings, merged };
}

/**
 * Bootstrap command handler. Reads ~/.claude.json mcpServers and generates
 * services.json entries. Uses printError + process.exitCode + return for
 * all error paths (never throws/propagates to main().catch()).
 */
export const handleBootstrap = async (args: string[]): Promise<void> => {
  const dryRun = args.includes("--dry-run");

  // Get HOME
  const home = process.env.HOME;
  if (!home) {
    printError({
      error: true,
      code: "CONFIG_NOT_FOUND",
      message: "HOME not set",
    });
    process.exitCode = EXIT_CODES.VALIDATION;
    return;
  }

  // Read claude.json
  const claudeConfig = await readClaudeConfig(home);
  if (claudeConfig === null) {
    printError({
      error: true,
      code: "CONFIG_NOT_FOUND",
      message: "~/.claude.json not found",
    });
    process.exitCode = EXIT_CODES.VALIDATION;
    return;
  }

  // Extract and convert entries
  const servers = extractMcpServers(claudeConfig);
  const converted = servers.map((s) => convertEntry(s.name, s.entry));

  // Load existing config (or start empty)
  let existingConfig: { services: Record<string, unknown> } = { services: {} };
  try {
    const loaded: ServicesConfig = await loadConfig(getConfigPath());
    existingConfig = { services: { ...loaded.services } };
  } catch (err) {
    if (err instanceof ConfigError && err.code === "CONFIG_NOT_FOUND") {
      // No existing config -- start fresh
      existingConfig = { services: {} };
    } else {
      throw err;
    }
  }

  // Merge entries
  const { added, skipped, warnings, merged } = mergeEntries(
    converted,
    existingConfig,
  );

  // Zero convertible entries -- skip file write entirely
  if (added.length === 0) {
    console.log(JSON.stringify({ added: [], skipped, warnings }));
    process.exitCode = EXIT_CODES.SUCCESS;
    return;
  }

  // Dry run -- preview without writing
  if (dryRun) {
    console.log(JSON.stringify({ dryRun: true, added, skipped, warnings }));
    process.exitCode = EXIT_CODES.SUCCESS;
    return;
  }

  // Write merged config
  const outputPath = getConfigPath();
  await mkdir(dirname(outputPath), { recursive: true });
  await Bun.write(outputPath, JSON.stringify(merged, null, 2));
  console.log(JSON.stringify({ added, skipped, warnings }));
  process.exitCode = EXIT_CODES.SUCCESS;
};
