/**
 * Drift detection hook for the connection pool.
 * ADV-02: On new connection, compares live tool schemas against cached versions
 * and logs drift alerts identifying which tools changed and how.
 * ADV-06: Triggers auto-regeneration of skill files when drift is detected.
 */
import type { McpConnection } from "../connection/types.ts";
import { readCacheRaw, writeCache, detectDrift, resolveTtlMs, mapToolsToCachedSchemas, clearServiceCacheKeys } from "../cache/index.ts";
import type { AccessPolicy } from "../access/types.ts";
import { listAllTools } from "../schema/introspect.ts";
import { autoRegenerateSkills } from "../generation/auto-regen.ts";
import { createLogger } from "../logger/index.ts";

const log = createLogger("drift-hook");

/**
 * Check for schema drift on a new connection.
 * Fetches live tool list, hashes each tool, compares against cached hashes.
 * When drift is detected, triggers auto-regeneration of skill files.
 * Non-blocking -- errors are logged but never propagated.
 *
 * @param serviceName - The service to check
 * @param connection - Active MCP connection
 * @param policy - Optional access policy for filtering tools during regeneration
 */
export async function checkDriftOnConnect(
  serviceName: string,
  connection: McpConnection,
  policy?: AccessPolicy,
): Promise<void> {
  try {
    // Fetch live tool list (paginated)
    const liveTools = await listAllTools(connection.client);

    // Hash all live tools
    const liveSchemas = await mapToolsToCachedSchemas(liveTools);

    // Read existing cache (raw -- ignoring TTL for drift comparison)
    const cached = await readCacheRaw(serviceName);

    if (cached && cached.tools.length > 0) {
      // Compare cached vs live
      const drift = detectDrift(
        serviceName,
        cached.tools,
        liveSchemas,
        cached.metadata.cachedAt,
      );

      if (drift.hasDrift) {
        log.warn("drift_check_complete", {
          service: serviceName,
          driftDetected: true,
          changeCount: drift.changes.length,
        });

        // #58: a contract change must invalidate EVERY cache key for this
        // service -- the bare entry AND all per-credential keys -- not just the
        // base entry rewritten below. Otherwise a user's credential-scoped read
        // keeps serving the old schema after the bump. Clear them all here; the
        // base entry is repopulated immediately below, and credential entries
        // refill on their next read.
        const clearedKeys = await clearServiceCacheKeys(serviceName);
        if (clearedKeys > 0) {
          log.info("drift_cache_invalidated", {
            service: serviceName,
            keysCleared: clearedKeys,
          });
        }

        // ADV-06: Auto-regenerate skill files on drift
        const toolSummaries = liveTools.map((t) => ({
          name: t.name,
          description: t.description ?? "(no description)",
        }));
        const regenResult = await autoRegenerateSkills(
          serviceName,
          toolSummaries,
          policy ?? {},
        );

        if (regenResult.regenerated) {
          log.info("skill_auto_regen_triggered", {
            service: serviceName,
            filesWritten: regenResult.filesWritten.length,
            manualSectionsPreserved: regenResult.manualSectionsPreserved,
          });
        }
      } else {
        log.debug("drift_check_complete", {
          service: serviceName,
          driftDetected: false,
        });
      }
    } else {
      log.debug("drift_check_skipped", {
        service: serviceName,
        reason: "no_cached_schemas",
      });
    }

    // Always update cache with fresh schemas after drift check
    await writeCache(serviceName, liveSchemas, resolveTtlMs());
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn("drift_check_failed", { service: serviceName, error: message });
  }
}
