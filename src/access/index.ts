/**
 * Access control module -- barrel export.
 * Tool allow/block lists with glob-based pattern matching.
 */
export type { AccessPolicy, AccessCheckResult } from "./types.ts";
export {
  globToRegex,
  checkToolAccess,
  filterTools,
  extractPolicy,
} from "./filter.ts";
