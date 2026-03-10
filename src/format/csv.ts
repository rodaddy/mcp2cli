/**
 * CSV formatter -- RFC 4180 compliant.
 * Handles proper quoting for values containing commas, double quotes, and newlines.
 * No external dependencies.
 */

/**
 * Characters that trigger quoting per RFC 4180.
 */
const NEEDS_QUOTING = /[",\n\r]/;

/**
 * Quote a CSV field value per RFC 4180:
 * - Enclose in double quotes if field contains comma, quote, or newline
 * - Double any embedded double quotes
 */
function quoteField(value: string): string {
  if (NEEDS_QUOTING.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Convert a value to a CSV-safe string.
 */
function toCsvString(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}

/**
 * Format data as CSV.
 * - Array of objects: header row from keys + data rows
 * - Single object: header row + single data row
 * - Array of primitives: single VALUE column
 * - Primitive: single value
 */
export function formatCsv(data: unknown): string {
  if (data === null || data === undefined) {
    return "";
  }

  // Single object -> one row
  if (typeof data === "object" && !Array.isArray(data)) {
    return formatObjectCsv(data as Record<string, unknown>);
  }

  // Array
  if (Array.isArray(data)) {
    if (data.length === 0) return "";

    // Array of primitives -> single column
    if (typeof data[0] !== "object" || data[0] === null) {
      return formatPrimitiveCsv(data);
    }

    return formatArrayCsv(data as Record<string, unknown>[]);
  }

  // Primitive
  return quoteField(String(data));
}

/**
 * Format a single object as CSV with header + one data row.
 */
function formatObjectCsv(obj: Record<string, unknown>): string {
  const keys = Object.keys(obj);
  if (keys.length === 0) return "";

  const header = keys.map(quoteField).join(",");
  const row = keys.map((k) => quoteField(toCsvString(obj[k]))).join(",");
  return `${header}\n${row}`;
}

/**
 * Format an array of primitives as CSV with a VALUE header.
 */
function formatPrimitiveCsv(arr: unknown[]): string {
  const lines = ["VALUE"];
  for (const item of arr) {
    lines.push(quoteField(toCsvString(item)));
  }
  return lines.join("\n");
}

/**
 * Format an array of objects as CSV.
 * Collects all unique keys across all objects for the header.
 */
function formatArrayCsv(rows: Record<string, unknown>[]): string {
  // Collect all unique keys preserving insertion order
  const keySet = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      keySet.add(key);
    }
  }
  const columns = Array.from(keySet);

  const lines: string[] = [];

  // Header row
  lines.push(columns.map(quoteField).join(","));

  // Data rows
  for (const row of rows) {
    const values = columns.map((col) => quoteField(toCsvString(row[col])));
    lines.push(values.join(","));
  }

  return lines.join("\n");
}
