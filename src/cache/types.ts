/**
 * Cache module types.
 * Defines structures for schema caching with TTL and drift detection.
 */

/** Cached schema for a single tool within a service */
export interface CachedToolSchema {
  name: string;
  description: string;
  inputSchema: object;
  annotations?: object;
  /** SHA-256 hash of canonical JSON (sorted keys, no whitespace) */
  hash: string;
}

/** Metadata for a service's cached schema file */
export interface CacheMetadata {
  /** Service name this cache belongs to */
  service: string;
  /** ISO timestamp when cache was written */
  cachedAt: string;
  /** TTL in milliseconds (default 24h) */
  ttlMs: number;
  /** Number of tools cached */
  toolCount: number;
}

/** A complete cache entry -- metadata + tool schemas */
export interface CacheEntry {
  metadata: CacheMetadata;
  tools: CachedToolSchema[];
}

/** Result of comparing a single tool's schema between cached and live */
export interface ToolDrift {
  tool: string;
  type: "added" | "removed" | "changed";
  /** Present when type is "changed" -- describes what changed */
  details?: string;
}

/** Result of drift detection for a service */
export interface DriftResult {
  service: string;
  /** Whether any drift was detected */
  hasDrift: boolean;
  /** Individual tool changes */
  changes: ToolDrift[];
  /** ISO timestamp of cached version */
  cachedAt: string;
  /** ISO timestamp of detection */
  detectedAt: string;
}
