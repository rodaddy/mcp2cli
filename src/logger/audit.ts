/**
 * Audit logger for MCP tool calls.
 * Writes NDJSON entries to ~/.cache/mcp2cli/logs/audit.ndjson.
 * Captures every tool call (daemon + CLI) with params, response summary, and timing.
 * Supports file rotation to prevent unbounded growth.
 *
 * Rotation uses single-backup retention: current -> audit.ndjson.1.
 * Concurrent processes may race on rotation; rename failures are caught and ignored
 * so the worst case is one lost backup cycle, not data loss.
 */
import { mkdir, stat, rename, unlink, open, chmod } from "node:fs/promises";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { createLogger } from "./index.ts";

const log = createLogger("audit");

/** Max audit log size before rotation (default 50MB) */
const DEFAULT_MAX_SIZE_BYTES = 50 * 1024 * 1024;

/** Minimum allowed audit max size (1MB) */
const MIN_MAX_SIZE_BYTES = 1_048_576;

/** Max length for params/response in audit entries */
const MAX_FIELD_LENGTH = 2000;

/** Max recursion depth for sanitizeValue/sanitizeParams */
const MAX_SANITIZE_DEPTH = 10;

/**
 * Shared sensitive keyword alternation -- single source of truth for all regex uses.
 * M1: `auth` narrowed to `auth[_-]|authorization|authentication` to avoid matching `author`/`authority`.
 * L7: extracted from three inline copies.
 */
const SENSITIVE_KEYS =
  "token|secret|password|api[_-]?key|auth[_-]|authorization|authentication|credential|bearer|private[_-]?key|access[_-]?key|session[_-]?id|cookie|signing[_-]?key|passphrase";

/** Patterns that suggest sensitive content -- applied to KEYS only, never values */
const SENSITIVE_PATTERNS = new RegExp(`(?:${SENSITIVE_KEYS})`, "i");

export interface AuditEntry {
  timestamp: string;
  path: "daemon" | "cli";
  service: string;
  tool: string;
  resolvedTool?: string;
  transport?: string;
  params?: Record<string, unknown>;
  responseSummary?: string;
  durationMs: number;
  success: boolean;
  error?: string;
}

/** Resolve the audit log file path. Exported for reuse by audit CLI. */
export function resolveAuditPath(): string {
  const logDir = process.env.MCP2CLI_LOG_DIR
    ?? join(process.env.HOME ?? homedir(), ".cache", "mcp2cli", "logs");
  return join(logDir, "audit.ndjson");
}

function resolveMaxSize(): number {
  const envVal = process.env.MCP2CLI_AUDIT_MAX_SIZE;
  if (envVal) {
    const bytes = parseInt(envVal, 10);
    if (!Number.isNaN(bytes) && bytes > 0) {
      return Math.max(bytes, MIN_MAX_SIZE_BYTES);
    }
  }
  return DEFAULT_MAX_SIZE_BYTES;
}

/**
 * Sanitize a single value recursively.
 * - Plain objects are recursed through sanitizeParams (which checks keys).
 * - Arrays have each element recursed.
 * - Strings are truncated if too long.
 * - Key-level sensitive pattern checks happen in sanitizeParams, NOT here.
 * M3: depth-limited to MAX_SANITIZE_DEPTH to prevent stack overflow on deeply nested input.
 */
function sanitizeValue(value: unknown, depth = 0): unknown {
  if (depth > MAX_SANITIZE_DEPTH) return "[nested too deep]";
  if (value === null || value === undefined) return value;

  if (Array.isArray(value)) {
    return value.map((el) => sanitizeValue(el, depth + 1));
  }

  if (typeof value === "object") {
    return sanitizeParams(value as Record<string, unknown>, depth + 1);
  }

  if (typeof value === "string" && value.length > MAX_FIELD_LENGTH) {
    return value.slice(0, MAX_FIELD_LENGTH) + "...(truncated)";
  }

  return value;
}

export function sanitizeParams(params: Record<string, unknown>, depth = 0): Record<string, unknown> {
  if (depth > MAX_SANITIZE_DEPTH) return { "[nested too deep]": true };
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    if (SENSITIVE_PATTERNS.test(key)) {
      sanitized[key] = "[REDACTED]";
    } else {
      sanitized[key] = sanitizeValue(value, depth);
    }
  }
  return sanitized;
}

/**
 * Sanitize a response summary string.
 * Parses JSON, runs through sanitizeParams, re-serializes.
 * Falls back to regex scan for truncated/unparseable JSON.
 */
function sanitizeResponseSummary(summary: string): string {
  try {
    const parsed = JSON.parse(summary);
    if (typeof parsed === "object" && parsed !== null) {
      const sanitized = Array.isArray(parsed)
        ? parsed.map((el: unknown) => sanitizeValue(el))
        : sanitizeParams(parsed as Record<string, unknown>);
      return JSON.stringify(sanitized);
    }
    return summary;
  } catch {
    // Truncated or invalid JSON -- regex scan for sensitive key patterns
    // L7: uses shared SENSITIVE_KEYS. M4: matches non-string values too.
    return summary.replace(
      new RegExp(`("(?:${SENSITIVE_KEYS})")\\s*:\\s*(?:"[^"]*"|[^,}\\]\\s]+)`, "gi"),
      '$1:"[REDACTED]"',
    );
  }
}

/**
 * Sanitize an error message string.
 * Redacts values following sensitive key patterns and truncates.
 */
function sanitizeError(error: string): string {
  // L7: uses shared SENSITIVE_KEYS. L6: `[^\s;,&]+` instead of `\S+` to stop at common delimiters.
  const redacted = error.replace(
    new RegExp(`(?:${SENSITIVE_KEYS})[=:]\\s*[^\\s;,&]+`, "gi"),
    (match) => {
      const eqIdx = match.search(/[=:]/);
      return match.slice(0, eqIdx + 1) + "[REDACTED]";
    },
  );
  if (redacted.length > MAX_FIELD_LENGTH) {
    return redacted.slice(0, MAX_FIELD_LENGTH) + "...(truncated)";
  }
  return redacted;
}

function summarizeResponse(result: unknown): string {
  if (result === null || result === undefined) return "null";
  try {
    const json = JSON.stringify(result);
    if (json.length <= MAX_FIELD_LENGTH) return json;
    return json.slice(0, MAX_FIELD_LENGTH) + "...(truncated)";
  } catch {
    // Circular reference or other serialization error
    return "[unserializable]";
  }
}

async function rotateIfNeeded(filePath: string): Promise<void> {
  try {
    const stats = await stat(filePath);
    if (stats.size >= resolveMaxSize()) {
      const backupPath = `${filePath}.1`;
      await unlink(backupPath).catch(() => {});
      // Race mitigation: if another process already rotated, rename fails harmlessly
      try {
        await rename(filePath, backupPath);
        log.info("audit_log_rotated", { path: filePath, sizeBytes: stats.size });
      } catch {
        // Another process likely rotated already -- continue to appendFile
      }
    }
  } catch {
    // File doesn't exist yet -- nothing to rotate
  }
}

/** Track whether the log directory has been created */
let dirEnsured = false;

// --- Write queue (M10: proper queue, not promise chain) ---
let writing = false;
const queue: Array<() => Promise<void>> = [];

async function processQueue(): Promise<void> {
  if (writing) return;
  writing = true;
  while (queue.length > 0) {
    const task = queue.shift()!;
    await task();
  }
  writing = false;
}

/**
 * Wait for all queued audit writes to complete.
 * Use in tests for deterministic assertions, and before process.exit in CLI paths.
 */
export async function flushAuditQueue(): Promise<void> {
  // If writing is in progress, wait for it to finish
  while (writing || queue.length > 0) {
    await new Promise((r) => setTimeout(r, 5));
  }
}

/**
 * Write an audit entry to the NDJSON log file.
 * Serializes writes to prevent interleaving. Non-blocking -- errors are logged but never thrown.
 */
export function writeAuditEntry(entry: AuditEntry): void {
  queue.push(async () => {
    try {
      const filePath = resolveAuditPath();

      if (!dirEnsured) {
        const dir = dirname(filePath);
        await mkdir(dir, { recursive: true });
        await chmod(dir, 0o700).catch(() => {});
        dirEnsured = true;
      }

      await rotateIfNeeded(filePath);

      const sanitizedEntry: AuditEntry = {
        ...entry,
        params: entry.params ? sanitizeParams(entry.params) : undefined,
        responseSummary: entry.responseSummary
          ? sanitizeResponseSummary(entry.responseSummary)
          : undefined,
        error: entry.error ? sanitizeError(entry.error) : undefined,
      };

      // M2: open with mode 0o600 creates file atomically with correct permissions (no TOCTOU).
      // L8: no per-write chmod needed -- mode is set at creation time.
      const fd = await open(filePath, "a", 0o600);
      try {
        await fd.appendFile(JSON.stringify(sanitizedEntry) + "\n");
      } finally {
        await fd.close();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.warn("audit_write_failed", { error: message });
    }
  });
  processQueue();
}

/**
 * Record a tool call in the audit log.
 * Call at the end of every tool invocation (daemon or CLI).
 */
export function auditToolCall(opts: {
  path: "daemon" | "cli";
  service: string;
  tool: string;
  resolvedTool?: string;
  transport?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  durationMs: number;
  success: boolean;
  error?: string;
}): void {
  writeAuditEntry({
    timestamp: new Date().toISOString(),
    path: opts.path,
    service: opts.service,
    tool: opts.tool,
    resolvedTool: opts.resolvedTool,
    transport: opts.transport,
    params: opts.params,
    responseSummary: opts.result !== undefined ? summarizeResponse(opts.result) : undefined,
    durationMs: Math.round(opts.durationMs),
    success: opts.success,
    error: opts.error,
  });
}

/** Reset internal state -- for testing only */
export function _resetAuditState(): void {
  dirEnsured = false;
  writing = false;
  queue.length = 0;
}
