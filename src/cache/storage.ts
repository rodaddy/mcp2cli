/**
 * File-based cache storage for schema data.
 * Reads/writes cache files at ~/.cache/mcp2cli/schemas/{service}.json.
 * Supports TTL checks, atomic writes, and selective/full cache clearing.
 */
import { mkdir, unlink, readdir, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createLogger } from "../logger/index.ts";
import type { CacheEntry, CacheMetadata, CachedToolSchema } from "./types.ts";

const log = createLogger("cache");

/** Validate service name to prevent path traversal attacks. */
function validateServiceName(service: string): string {
  if (service.includes('/') || service.includes('\\') || service.includes('..')) {
    throw new Error(`Invalid service name: "${service}"`);
  }
  return service;
}

/** Default TTL: 24 hours in milliseconds */
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Resolve the cache directory path.
 * MCP2CLI_CACHE_DIR env var overrides the default location.
 */
export function getCacheDir(): string {
  if (process.env.MCP2CLI_CACHE_DIR) {
    return process.env.MCP2CLI_CACHE_DIR;
  }
  const home = process.env.HOME;
  if (!home) {
    throw new Error("Cannot determine cache path: HOME environment variable is not set");
  }
  return join(home, ".cache", "mcp2cli", "schemas");
}

/** Get the cache file path for a given service */
export function getCacheFilePath(service: string): string {
  validateServiceName(service);
  return join(getCacheDir(), `${service}.json`);
}

/**
 * Read cached schema for a service.
 * Returns null if cache doesn't exist, is corrupted, or has expired.
 */
export async function readCache(service: string): Promise<CacheEntry | null> {
  const filePath = getCacheFilePath(service);
  const file = Bun.file(filePath);

  if (!(await file.exists())) {
    log.debug("cache_miss", { service, reason: "not_found" });
    return null;
  }

  let entry: CacheEntry;
  try {
    entry = (await file.json()) as CacheEntry;
  } catch {
    log.warn("cache_corrupted", { service, path: filePath });
    return null;
  }

  // Validate structure
  if (!entry.metadata || !Array.isArray(entry.tools)) {
    log.warn("cache_invalid_structure", { service });
    return null;
  }

  // Check TTL
  if (isCacheExpired(entry.metadata)) {
    log.debug("cache_expired", {
      service,
      cachedAt: entry.metadata.cachedAt,
      ttlMs: entry.metadata.ttlMs,
    });
    return null;
  }

  log.debug("cache_hit", { service, toolCount: entry.tools.length });
  return entry;
}

/** Check whether a cache entry has exceeded its TTL */
export function isCacheExpired(metadata: CacheMetadata): boolean {
  const cachedTime = new Date(metadata.cachedAt).getTime();
  const ttl = metadata.ttlMs || DEFAULT_TTL_MS;
  return Date.now() - cachedTime > ttl;
}

/**
 * Write cache entry for a service.
 * Uses atomic write (write to temp, then rename) to prevent corruption
 * from concurrent access or crashes.
 */
export async function writeCache(
  service: string,
  tools: CachedToolSchema[],
  ttlMs: number = DEFAULT_TTL_MS,
): Promise<void> {
  const filePath = getCacheFilePath(service);
  const dir = dirname(filePath);

  // Ensure cache directory exists
  await mkdir(dir, { recursive: true });

  const entry: CacheEntry = {
    metadata: {
      service,
      cachedAt: new Date().toISOString(),
      ttlMs,
      toolCount: tools.length,
    },
    tools,
  };

  // Atomic write: write to temp file, then rename
  const tempPath = `${filePath}.tmp.${process.pid}`;
  try {
    await Bun.write(tempPath, JSON.stringify(entry, null, 2));
    // Rename is atomic on POSIX filesystems
    await rename(tempPath, filePath);
    log.debug("cache_written", { service, toolCount: tools.length });
  } catch (err) {
    // Clean up temp file on failure
    await unlink(tempPath).catch(() => {});
    throw err;
  }
}

/**
 * Clear cached schemas.
 * If service is provided, clears only that service's cache.
 * If no service, clears all cached schemas.
 */
export async function clearCache(service?: string): Promise<number> {
  const cacheDir = getCacheDir();

  if (service) {
    // Clear single service cache
    const filePath = getCacheFilePath(service);
    const file = Bun.file(filePath);
    if (await file.exists()) {
      await unlink(filePath);
      log.info("cache_cleared", { service });
      return 1;
    }
    return 0;
  }

  // Clear all caches
  let cleared = 0;
  try {
    const entries = await readdir(cacheDir);
    for (const entry of entries) {
      if (entry.endsWith(".json")) {
        await unlink(join(cacheDir, entry));
        cleared++;
      }
    }
  } catch {
    // Directory doesn't exist -- nothing to clear
    return 0;
  }

  log.info("cache_cleared_all", { count: cleared });
  return cleared;
}

/**
 * List all cached services.
 * Returns service names that have cache files.
 */
export async function listCachedServices(): Promise<string[]> {
  const cacheDir = getCacheDir();
  try {
    const entries = await readdir(cacheDir);
    return entries
      .filter((e) => e.endsWith(".json"))
      .map((e) => e.replace(/\.json$/, ""));
  } catch {
    return [];
  }
}

/**
 * Read cache without TTL check -- used by drift detection
 * to compare even expired caches against live schemas.
 */
export async function readCacheRaw(service: string): Promise<CacheEntry | null> {
  const filePath = getCacheFilePath(service);
  const file = Bun.file(filePath);

  if (!(await file.exists())) {
    return null;
  }

  try {
    const entry = (await file.json()) as CacheEntry;
    if (!entry.metadata || !Array.isArray(entry.tools)) {
      return null;
    }
    return entry;
  } catch {
    return null;
  }
}
