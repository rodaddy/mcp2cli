/**
 * Output format module barrel export.
 * Dispatches data formatting based on the requested output format.
 */
export { formatTable } from "./table.ts";
export { formatYaml } from "./yaml.ts";
export { formatCsv } from "./csv.ts";
export { formatNdjson } from "./ndjson.ts";
export { isValidFormat, VALID_FORMATS } from "./types.ts";
export type { OutputFormat } from "./types.ts";

import type { OutputFormat } from "./types.ts";
import { formatTable } from "./table.ts";
import { formatYaml } from "./yaml.ts";
import { formatCsv } from "./csv.ts";
import { formatNdjson } from "./ndjson.ts";

/**
 * Format data according to the specified output format.
 *
 * For "json" format, wraps in the standard { success: true, result: ... } envelope.
 * For other formats, renders the raw result data directly.
 */
export function formatOutput(
  data: unknown,
  format: OutputFormat,
): string {
  switch (format) {
    case "json":
      return JSON.stringify({ success: true, result: data });
    case "table":
      return formatTable(data);
    case "yaml":
      return formatYaml(data);
    case "csv":
      return formatCsv(data);
    case "ndjson":
      return formatNdjson(data);
    default: {
      const _exhaustive: never = format;
      throw new Error(`Unsupported format: ${_exhaustive}`);
    }
  }
}
