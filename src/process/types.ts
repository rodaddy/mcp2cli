/**
 * Client-side types for daemon process management.
 */

/** Status of the daemon process as seen from the CLI client */
export type DaemonStatus = "running" | "stale" | "stopped";
