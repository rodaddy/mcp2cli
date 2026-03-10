/**
 * Drift detection hook for the connection pool.
 * ADV-02: On new connection, compares live tool schemas against cached versions
 * and logs drift alerts identifying which tools changed and how.
 * ADV-06: Triggers auto-regeneration of skill files when drift is detected.
 */
import type { McpConnection } from "../connection/types.ts";
import { readCacheRaw, writeCache, hashToolSchema, detectDrift } from "../cache/index.ts";
import type { CachedToolSchema } from "../cache/index.ts";
import type { AccessPolicy } from "../access/types.ts";
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
    // Fetch live tool list
    const response = await connection.client.listTools();
    const liveTools = response.tools;

    // Hash all live tools
    const liveSchemas: CachedToolSchema[] = await Promise.all(
      liveTools.map(async (tool) => ({
        name: tool.name,
        description: tool.description ?? "(no description)",
        inputSchema: tool.inputSchema,
        annotations: tool.annotations as object | undefined,
        hash: await hashToolSchema({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
          annotations: tool.annotations as object | undefined,
        }),
      })),
    );

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
    await writeCache(serviceName, liveSchemas);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn("drift_check_failed", { service: serviceName, error: message });
  }
}
