/**
 * Table formatter: renders data as aligned columns with headers.
 * Auto-detects column widths, right-aligns numbers, truncates long values.
 */

const MAX_COLUMN_WIDTH = 40;
const TRUNCATION_SUFFIX = "...";

/**
 * Flatten a value to a row-friendly record.
 * Nested objects become JSON strings.
 */
function flattenRow(row: Record<string, unknown>): Record<string, string> {
  const flat: Record<string, string> = {};
  for (const [key, value] of Object.entries(row)) {
    if (value === null || value === undefined) {
      flat[key] = "";
    } else if (typeof value === "object") {
      flat[key] = JSON.stringify(value);
    } else {
      flat[key] = String(value);
    }
  }
  return flat;
}

/**
 * Check if a string represents a numeric value.
 */
function isNumeric(value: string): boolean {
  if (value === "") return false;
  return !isNaN(Number(value)) && isFinite(Number(value));
}

/**
 * Truncate a string to max length, appending "..." if truncated.
 */
function truncate(value: string, maxWidth: number): string {
  if (value.length <= maxWidth) return value;
  return value.slice(0, maxWidth - TRUNCATION_SUFFIX.length) + TRUNCATION_SUFFIX;
}

/**
 * Format data as an aligned text table.
 * - If data is an array of objects, each object is a row.
 * - If data is a single object, renders as key-value pairs.
 * - Numbers are right-aligned, strings left-aligned.
 * - Long values are truncated to MAX_COLUMN_WIDTH.
 */
export function formatTable(data: unknown): string {
  if (data === null || data === undefined) {
    return "(empty)";
  }

  // Single object -> key/value table
  if (typeof data === "object" && !Array.isArray(data)) {
    return formatKeyValueTable(data as Record<string, unknown>);
  }

  // Array of objects -> columnar table
  if (Array.isArray(data)) {
    if (data.length === 0) return "(empty)";

    // Array of primitives -> single column
    if (typeof data[0] !== "object" || data[0] === null) {
      return formatPrimitiveArray(data);
    }

    return formatColumnarTable(data as Record<string, unknown>[]);
  }

  // Primitive -> just stringify
  return String(data);
}

/**
 * Render a single object as a two-column key/value table.
 */
function formatKeyValueTable(obj: Record<string, unknown>): string {
  const rows = flattenRow(obj);
  const keys = Object.keys(rows);
  if (keys.length === 0) return "(empty)";

  const keyWidth = Math.min(
    Math.max(...keys.map((k) => k.length)),
    MAX_COLUMN_WIDTH,
  );

  const lines: string[] = [];
  // Header
  lines.push(
    `${"KEY".padEnd(keyWidth)}  VALUE`,
  );
  lines.push(`${"-".repeat(keyWidth)}  ${"-".repeat(MAX_COLUMN_WIDTH)}`);

  for (const [key, value] of Object.entries(rows)) {
    const truncatedKey = truncate(key, keyWidth);
    const truncatedValue = truncate(value, MAX_COLUMN_WIDTH);
    lines.push(`${truncatedKey.padEnd(keyWidth)}  ${truncatedValue}`);
  }

  return lines.join("\n");
}

/**
 * Render an array of primitives as a single VALUE column.
 */
function formatPrimitiveArray(arr: unknown[]): string {
  const lines: string[] = [];
  lines.push("VALUE");
  lines.push("-".repeat(MAX_COLUMN_WIDTH));
  for (const item of arr) {
    const value = item === null || item === undefined ? "" : String(item);
    lines.push(truncate(value, MAX_COLUMN_WIDTH));
  }
  return lines.join("\n");
}

/**
 * Render an array of objects as a columnar table with headers.
 */
function formatColumnarTable(rows: Record<string, unknown>[]): string {
  // Collect all unique keys across all rows (preserving insertion order)
  const keySet = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      keySet.add(key);
    }
  }
  const columns = Array.from(keySet);

  // Flatten all rows
  const flatRows = rows.map(flattenRow);

  // Calculate column widths (header length vs max data length, capped)
  const widths: Record<string, number> = {};
  for (const col of columns) {
    const headerLen = col.length;
    const maxDataLen = Math.max(
      ...flatRows.map((row) => (row[col] ?? "").length),
      0,
    );
    widths[col] = Math.min(Math.max(headerLen, maxDataLen), MAX_COLUMN_WIDTH);
  }

  // Detect which columns are numeric (all non-empty values are numbers)
  const numericCols = new Set<string>();
  for (const col of columns) {
    const values = flatRows.map((row) => row[col] ?? "").filter((v) => v !== "");
    if (values.length > 0 && values.every(isNumeric)) {
      numericCols.add(col);
    }
  }

  const lines: string[] = [];

  // Header row
  const headerParts = columns.map((col) => {
    const width = widths[col] as number;
    return col.toUpperCase().padEnd(width);
  });
  lines.push(headerParts.join("  "));

  // Separator
  const sepParts = columns.map((col) => "-".repeat(widths[col] as number));
  lines.push(sepParts.join("  "));

  // Data rows
  for (const row of flatRows) {
    const parts = columns.map((col) => {
      const width = widths[col] as number;
      const value = truncate(row[col] ?? "", width);
      if (numericCols.has(col)) {
        return value.padStart(width);
      }
      return value.padEnd(width);
    });
    lines.push(parts.join("  "));
  }

  return lines.join("\n");
}
