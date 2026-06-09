/**
 * Handle `mcp2cli audit <subcommand>` -- view and manage audit logs.
 * Supports: tail [n] [--json], search <pattern> [--json], clear, path, stats
 */
import { stat, unlink } from "node:fs/promises";
import { EXIT_CODES } from "../../types/index.ts";
import type { CommandHandler } from "../../types/index.ts";
import { resolveAuditPath } from "../../logger/audit.ts";
import type { AuditEntry } from "../../logger/audit.ts";

interface ReadResult {
  entries: AuditEntry[];
  skippedLines: number;
}

async function readAuditEntries(opts?: { fromEnd?: number }): Promise<ReadResult> {
  const filePath = resolveAuditPath();
  const file = Bun.file(filePath);
  if (!(await file.exists())) return { entries: [], skippedLines: 0 };

  let lines: string[];

  if (opts?.fromEnd && opts.fromEnd > 0) {
    // Efficient tail: read estimated bytes from end
    const fileSize = file.size;
    const estimatedBytes = opts.fromEnd * 2048;
    if (estimatedBytes < fileSize) {
      const slice = file.slice(fileSize - estimatedBytes);
      const text = await slice.text();
      // First line is likely partial, skip it
      const allLines = text.split("\n").filter(Boolean);
      lines = allLines.length > 1 ? allLines.slice(1) : allLines;
    } else {
      const text = await file.text();
      lines = text.trim().split("\n").filter(Boolean);
    }
    // Take only the last N lines
    lines = lines.slice(-opts.fromEnd);
  } else {
    const text = await file.text();
    lines = text.trim().split("\n").filter(Boolean);
  }

  const entries: AuditEntry[] = [];
  let skippedLines = 0;
  for (const line of lines) {
    try {
      entries.push(JSON.parse(line) as AuditEntry);
    } catch {
      skippedLines++;
    }
  }

  return { entries, skippedLines };
}

export const handleAudit: CommandHandler = async (args: string[]) => {
  const subcommand = args[0];

  switch (subcommand) {
    case "tail":
      await handleAuditTail(args.slice(1));
      break;
    case "search":
      await handleAuditSearch(args.slice(1));
      break;
    case "clear":
      await handleAuditClear();
      break;
    case "path":
      console.log(resolveAuditPath());
      process.exitCode = EXIT_CODES.SUCCESS;
      break;
    case "stats":
      await handleAuditStats();
      break;
    default:
      console.log(
        [
          "Usage: mcp2cli audit <subcommand>",
          "",
          "SUBCOMMANDS:",
          "    tail [n] [--json]      Show last n audit entries (default: 20)",
          "    search <pattern> [--json] Search audit entries by service/tool/error/params/response",
          "    stats                  Show summary statistics from audit log",
          "    clear                  Delete the audit log",
          "    path                   Print the audit log file path",
        ].join("\n"),
      );
      process.exitCode = subcommand ? EXIT_CODES.VALIDATION : EXIT_CODES.SUCCESS;
      break;
  }
};

async function handleAuditTail(args: string[]): Promise<void> {
  const jsonMode = args.includes("--json");
  const count = parseInt(args.find((a) => !a.startsWith("--")) ?? "20", 10);
  const limit = Number.isNaN(count) || count <= 0 ? 20 : count;

  const { entries, skippedLines } = await readAuditEntries({ fromEnd: limit });

  if (skippedLines > 0) {
    process.stderr.write(`warning: ${skippedLines} malformed line(s) skipped\n`);
  }

  if (entries.length === 0) {
    console.log("No audit entries found.");
    process.exitCode = EXIT_CODES.SUCCESS;
    return;
  }

  if (jsonMode) {
    console.log(JSON.stringify(entries));
  } else {
    for (const e of entries) {
      const status = e.success ? "OK" : `ERR: ${e.error ?? "unknown"}`;
      console.log(`${e.timestamp}  ${e.path}  ${e.service}.${e.tool}  ${e.durationMs}ms  ${status}`);
    }
  }

  process.exitCode = EXIT_CODES.SUCCESS;
}

async function handleAuditSearch(args: string[]): Promise<void> {
  const jsonMode = args.includes("--json");
  const pattern = args.find((a) => !a.startsWith("--"));

  if (!pattern) {
    console.error("Usage: mcp2cli audit search <pattern> [--json]");
    process.exitCode = EXIT_CODES.VALIDATION;
    return;
  }

  const { entries, skippedLines } = await readAuditEntries();

  if (skippedLines > 0) {
    process.stderr.write(`warning: ${skippedLines} malformed line(s) skipped\n`);
  }

  const lower = pattern.toLowerCase();

  const matches = entries.filter((e) =>
    e.service.toLowerCase().includes(lower) ||
    e.tool.toLowerCase().includes(lower) ||
    (e.error ?? "").toLowerCase().includes(lower) ||
    JSON.stringify(e.params ?? "").toLowerCase().includes(lower) ||
    (e.responseSummary ?? "").toLowerCase().includes(lower),
  );

  if (jsonMode) {
    console.log(JSON.stringify({ query: pattern, matches, total: matches.length }));
  } else if (matches.length === 0) {
    console.log(`No audit entries matching "${pattern}".`);
  } else {
    for (const e of matches) {
      const status = e.success ? "OK" : `ERR: ${e.error ?? "unknown"}`;
      console.log(`${e.timestamp}  ${e.path}  ${e.service}.${e.tool}  ${e.durationMs}ms  ${status}`);
    }
    console.log(`\n${matches.length} entries found.`);
  }

  process.exitCode = EXIT_CODES.SUCCESS;
}

async function handleAuditClear(): Promise<void> {
  const filePath = resolveAuditPath();
  try {
    await unlink(filePath);
    console.log("Audit log cleared.");
  } catch {
    console.log("No audit log found.");
  }

  // Also clean up rotated backup
  try {
    await unlink(`${filePath}.1`);
  } catch { /* no backup to remove */ }

  process.exitCode = EXIT_CODES.SUCCESS;
}

async function handleAuditStats(): Promise<void> {
  const { entries, skippedLines } = await readAuditEntries();

  if (skippedLines > 0) {
    process.stderr.write(`warning: ${skippedLines} malformed line(s) skipped\n`);
  }

  if (entries.length === 0) {
    console.log("No audit entries found.");
    process.exitCode = EXIT_CODES.SUCCESS;
    return;
  }

  const serviceMap = new Map<string, { total: number; errors: number; totalMs: number }>();
  let totalErrors = 0;

  for (const e of entries) {
    const key = e.service;
    const stats = serviceMap.get(key) ?? { total: 0, errors: 0, totalMs: 0 };
    stats.total++;
    stats.totalMs += e.durationMs;
    if (!e.success) {
      stats.errors++;
      totalErrors++;
    }
    serviceMap.set(key, stats);
  }

  const lines = [
    `Audit log: ${entries.length} entries, ${totalErrors} errors`,
    "",
  ];

  for (const [service, stats] of Array.from(serviceMap.entries()).sort((a, b) => b[1].total - a[1].total)) {
    const avgMs = Math.round(stats.totalMs / stats.total);
    const errRate = stats.errors > 0 ? ` (${stats.errors} errors)` : "";
    lines.push(`  ${service}: ${stats.total} calls, avg ${avgMs}ms${errRate}`);
  }

  // File size
  try {
    const filePath = resolveAuditPath();
    const fileStats = await stat(filePath);
    const sizeMb = (fileStats.size / 1024 / 1024).toFixed(1);
    lines.push(`\nLog size: ${sizeMb}MB`);
  } catch { /* file may not exist */ }

  console.log(lines.join("\n"));
  process.exitCode = EXIT_CODES.SUCCESS;
}
