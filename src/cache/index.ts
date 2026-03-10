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

export { canonicalJson, hashToolSchema } from "./hash.ts";

export {
  getCacheDir,
  getCacheFilePath,
  readCache,
  readCacheRaw,
  writeCache,
  clearCache,
  listCachedServices,
  isCacheExpired,
} from "./storage.ts";

export { detectDrift } from "./drift.ts";
