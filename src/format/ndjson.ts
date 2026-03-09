/**
 * NDJSON (Newline Delimited JSON) formatter.
 * If result is an array, outputs one JSON object per line.
 * If single object, outputs one line.
 */

/**
 * Format data as NDJSON.
 * - Array: one JSON line per element
 * - Non-array: single JSON line
 * - null/undefined: empty string
 */
export function formatNdjson(data: unknown): string {
  if (data === null || data === undefined) {
    return "null";
  }

  if (Array.isArray(data)) {
    if (data.length === 0) return "";
    return data.map((item) => JSON.stringify(item)).join("\n");
  }

  return JSON.stringify(data);
}
