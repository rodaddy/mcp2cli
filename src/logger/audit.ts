/**
 * Audit logger for MCP tool calls.
 * Writes NDJSON entries to ~/.cache/mcp2cli/logs/audit.ndjson.
 * Captures every tool call (daemon + CLI) with params, response summary, and timing.
 * Supports file rotation to prevent unbounded growth.
 */
import { mkdir, stat, rename, unlink, appendFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { createLogger } from "./index.ts";

const log = createLogger("audit");

/** Max audit log size before rotation (default 50MB) */
const DEFAULT_MAX_SIZE_BYTES = 50 * 1024 * 1024;

/** Max length for params/response in audit entries */
const MAX_FIELD_LENGTH = 2000;

/** Patterns that suggest sensitive content */
const SENSITIVE_PATTERNS = /(?:token|secret|password|api[_-]?key|auth|credential|bearer)/i;

export interface AuditEntry {
  timestamp: string;
  path: "daemon" | "cli";
  service: string;
  tool: string;
  params?: Record<string, unknown>;
  responseSummary?: string;
  durationMs: number;
  success: boolean;
  error?: string;
}

function resolveAuditPath(): string {
  const logDir = process.env.MCP2CLI_LOG_DIR
    ?? join(process.env.HOME ?? "", ".cache", "mcp2cli", "logs");
  return join(logDir, "audit.ndjson");
}

function resolveMaxSize(): number {
  const envVal = process.env.MCP2CLI_AUDIT_MAX_SIZE;
  if (envVal) {
    const bytes = parseInt(envVal, 10);
    if (!Number.isNaN(bytes) && bytes > 0) return bytes;
  }
  return DEFAULT_MAX_SIZE_BYTES;
}

function sanitizeValue(value: unknown): unknown {
  if (typeof value === "string" && SENSITIVE_PATTERNS.test(value)) {
    return "[REDACTED]";
  }
  if (typeof value === "string" && value.length > MAX_FIELD_LENGTH) {
    return value.slice(0, MAX_FIELD_LENGTH) + `... (${value.length} chars)`;
  }
  return value;
}

function sanitizeParams(params: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    if (SENSITIVE_PATTERNS.test(key)) {
      sanitized[key] = "[REDACTED]";
    } else {
      sanitized[key] = sanitizeValue(value);
    }
  }
  return sanitized;
}

function summarizeResponse(result: unknown): string {
  if (result === null || result === undefined) return "null";
  const json = JSON.stringify(result);
  if (json.length <= MAX_FIELD_LENGTH) return json;
  return json.slice(0, MAX_FIELD_LENGTH) + `... (${json.length} chars)`;
}

async function rotateIfNeeded(filePath: string): Promise<void> {
  try {
    const stats = await stat(filePath);
    if (stats.size >= resolveMaxSize()) {
      const backupPath = `${filePath}.1`;
      await unlink(backupPath).catch(() => {});
      await rename(filePath, backupPath);
      log.info("audit_log_rotated", { path: filePath, sizeBytes: stats.size });
    }
  } catch {
    // File doesn't exist yet — nothing to rotate
  }
}

let writeQueue: Promise<void> = Promise.resolve();

/**
 * Write an audit entry to the NDJSON log file.
 * Serializes writes to prevent interleaving. Non-blocking — errors are logged but never thrown.
 */
export function writeAuditEntry(entry: AuditEntry): void {
  writeQueue = writeQueue.then(async () => {
    try {
      const filePath = resolveAuditPath();
      await mkdir(dirname(filePath), { recursive: true });
      await rotateIfNeeded(filePath);

      const sanitizedEntry: AuditEntry = {
        ...entry,
        params: entry.params ? sanitizeParams(entry.params) : undefined,
        responseSummary: entry.responseSummary
          ? entry.responseSummary.slice(0, MAX_FIELD_LENGTH)
          : undefined,
      };

      await appendFile(filePath, JSON.stringify(sanitizedEntry) + "\n");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.warn("audit_write_failed", { error: message });
    }
  });
}

/**
 * Record a tool call in the audit log.
 * Call at the end of every tool invocation (daemon or CLI).
 */
export function auditToolCall(opts: {
  path: "daemon" | "cli";
  service: string;
  tool: string;
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
    params: opts.params,
    responseSummary: opts.result !== undefined ? summarizeResponse(opts.result) : undefined,
    durationMs: Math.round(opts.durationMs),
    success: opts.success,
    error: opts.error,
  });
}
