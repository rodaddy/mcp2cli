/**
 * Cache module -- barrel export.
 * Schema caching with TTL, drift detection, and file-based persistence.
 */
export type {
  CacheEntry,
  CacheMetadata,
  CachedToolSchema,
  ToolDrift,
  DriftResult,
} from "./types.ts";

export { canonicalJson, hashToolSchema, fingerprintSchemas } from "./hash.ts";

export {
  getCacheDir,
  getCacheFilePath,
  readCache,
  readCacheRaw,
  writeCache,
  clearCache,
  clearServiceCacheKeys,
  readCacheFingerprint,
  listCachedServices,
  isCacheExpired,
  resolveTtlMs,
} from "./storage.ts";

export { detectDrift } from "./drift.ts";

export type { RawMcpTool } from "./mapper.ts";
export { mapToolsToCachedSchemas } from "./mapper.ts";
