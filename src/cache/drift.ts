/**
 * Schema drift detection.
 * Compares cached tool hashes against live tool hashes to identify
 * added, removed, or changed tools per service.
 */
import type { CachedToolSchema, DriftResult, ToolDrift } from "./types.ts";
import { createLogger } from "../logger/index.ts";

const log = createLogger("drift");

/**
 * Compare cached and live tool schemas to detect drift.
 * Uses pre-computed SHA-256 hashes for efficient comparison.
 *
 * @param service - Service name for reporting
 * @param cached - Previously cached tool schemas with hashes
 * @param live - Current live tool schemas with hashes
 * @param cachedAt - ISO timestamp of the cached version
 * @returns DriftResult describing all changes
 */
export function detectDrift(
  service: string,
  cached: CachedToolSchema[],
  live: CachedToolSchema[],
  cachedAt: string,
): DriftResult {
  const changes: ToolDrift[] = [];

  // Build lookup maps by tool name
  const cachedMap = new Map(cached.map((t) => [t.name, t]));
  const liveMap = new Map(live.map((t) => [t.name, t]));

  // Check for removed tools (in cached but not in live)
  for (const [name] of cachedMap) {
    if (!liveMap.has(name)) {
      changes.push({ tool: name, type: "removed" });
    }
  }

  // Check for added tools (in live but not in cached)
  for (const [name] of liveMap) {
    if (!cachedMap.has(name)) {
      changes.push({ tool: name, type: "added" });
    }
  }

  // Check for changed tools (hash mismatch)
  for (const [name, liveSchema] of liveMap) {
    const cachedSchema = cachedMap.get(name);
    if (cachedSchema && cachedSchema.hash !== liveSchema.hash) {
      const details = describeChange(cachedSchema, liveSchema);
      changes.push({ tool: name, type: "changed", details });
    }
  }

  // Sort changes by tool name for deterministic output
  changes.sort((a, b) => a.tool.localeCompare(b.tool));

  const result: DriftResult = {
    service,
    hasDrift: changes.length > 0,
    changes,
    cachedAt,
    detectedAt: new Date().toISOString(),
  };

  if (result.hasDrift) {
    logDrift(result);
  }

  return result;
}

/**
 * Describe what changed between two versions of a tool schema.
 * Compares inputSchema properties and required fields.
 */
function describeChange(
  cached: CachedToolSchema,
  live: CachedToolSchema,
): string {
  const parts: string[] = [];

  // Check description change
  if (cached.description !== live.description) {
    parts.push("description changed");
  }

  // Compare inputSchema properties
  const cachedProps = getSchemaProperties(cached.inputSchema);
  const liveProps = getSchemaProperties(live.inputSchema);

  const addedProps = liveProps.filter((p) => !cachedProps.includes(p));
  const removedProps = cachedProps.filter((p) => !liveProps.includes(p));

  if (addedProps.length > 0) {
    parts.push(`params added: ${addedProps.join(", ")}`);
  }
  if (removedProps.length > 0) {
    parts.push(`params removed: ${removedProps.join(", ")}`);
  }

  // Compare required fields
  const cachedRequired = getSchemaRequired(cached.inputSchema);
  const liveRequired = getSchemaRequired(live.inputSchema);

  const newRequired = liveRequired.filter((r) => !cachedRequired.includes(r));
  const removedRequired = cachedRequired.filter((r) => !liveRequired.includes(r));

  if (newRequired.length > 0) {
    parts.push(`newly required: ${newRequired.join(", ")}`);
  }
  if (removedRequired.length > 0) {
    parts.push(`no longer required: ${removedRequired.join(", ")}`);
  }

  if (parts.length === 0) {
    parts.push("schema structure changed");
  }

  return parts.join("; ");
}

/** Extract property names from a JSON Schema object */
function getSchemaProperties(schema: object): string[] {
  const s = schema as { properties?: Record<string, unknown> };
  return s.properties ? Object.keys(s.properties).sort() : [];
}

/** Extract required field names from a JSON Schema object */
function getSchemaRequired(schema: object): string[] {
  const s = schema as { required?: string[] };
  return s.required ? [...s.required].sort() : [];
}

/** Log drift detection results via structured logger */
function logDrift(result: DriftResult): void {
  const summary = result.changes.map((c) => {
    const detail = c.details ? ` (${c.details})` : "";
    return `${c.type}: ${c.tool}${detail}`;
  });

  log.warn("schema_drift_detected", {
    service: result.service,
    changeCount: result.changes.length,
    cachedAt: result.cachedAt,
    changes: summary,
  });
}
