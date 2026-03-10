/**
 * Supported output format types for CLI results.
 * "json" is the default; others are opt-in via --format flag.
 */
export type OutputFormat = "json" | "table" | "yaml" | "csv" | "ndjson";

/**
 * All valid format values, used for validation.
 */
export const VALID_FORMATS: ReadonlySet<string> = new Set([
  "json",
  "table",
  "yaml",
  "csv",
  "ndjson",
]);

/**
 * Check if a string is a valid OutputFormat.
 */
export function isValidFormat(value: string): value is OutputFormat {
  return VALID_FORMATS.has(value);
}
