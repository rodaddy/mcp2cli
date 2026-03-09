import type { ValidationResult } from "./types.ts";

/**
 * Maximum input length per parameter value (10KB).
 * Prevents memory exhaustion and slow regex evaluation.
 */
const MAX_INPUT_LENGTH = 10_000;

/**
 * Matches control and invisible characters:
 *   - ASCII C0 range (0x00-0x1F) and DEL (0x7F)
 *   - C1 control range (0x80-0x9F)
 *   - Zero-width and Bidi override characters (U+200B-U+200F)
 *   - Line/paragraph separators (U+2028-U+2029)
 *   - Bidi embedding/override/isolate (U+202A-U+202E, U+2066-U+2069)
 *   - BOM (U+FEFF) and specials (U+FFF9-U+FFFC)
 * These are never legitimate in MCP tool parameters.
 */
const CONTROL_CHAR_REGEX = /[\x00-\x1f\x7f-\x9f\u200b-\u200f\u2028-\u2029\u202a-\u202e\u2066-\u2069\ufeff\ufff9-\ufffc]/;

/**
 * Matches literal path traversal: ".." preceded/followed by a separator (/ or \) or at string boundary.
 */
const PATH_TRAVERSAL_REGEX = /(?:^|[/\\])\.\.(?:[/\\]|$)/;

/**
 * Reject strings containing ASCII control characters (SEC-01).
 * Catches null bytes, newlines, tabs, escape sequences, bell, backspace, DEL, form feed.
 */
export function rejectControlChars(
  value: string,
  fieldName: string,
): ValidationResult {
  if (CONTROL_CHAR_REGEX.test(value)) {
    return {
      valid: false,
      code: "CONTROL_CHAR",
      field: fieldName,
      message: `${fieldName} contains invalid control characters`,
    };
  }
  return { valid: true };
}

/**
 * Reject strings containing path traversal patterns (SEC-02).
 * Two checks:
 *   1. Literal ".." with separator (/ or \) -- catches raw traversal and backslash variants
 *   2. Any "%" character -- prevents all percent-encoding bypass attacks
 */
export function rejectPathTraversal(
  value: string,
  fieldName: string,
): ValidationResult {
  // NFKC normalization catches fullwidth dots (U+FF0E) and slashes (U+FF0F)
  // that macOS HFS+ normalizes, bypassing the regex on raw input.
  const normalized = value.normalize("NFKC");

  if (PATH_TRAVERSAL_REGEX.test(normalized)) {
    return {
      valid: false,
      code: "PATH_TRAVERSAL",
      field: fieldName,
      message: `${fieldName} contains path traversal pattern '..'`,
    };
  }

  if (normalized.includes("%")) {
    return {
      valid: false,
      code: "PATH_TRAVERSAL",
      field: fieldName,
      message: `${fieldName} contains percent-encoding (potential traversal bypass)`,
    };
  }

  return { valid: true };
}

/**
 * Reject strings containing query (?) or fragment (#) injection (SEC-03).
 * Checks ? first, then # -- short-circuits on first match.
 */
export function rejectQueryFragment(
  value: string,
  fieldName: string,
): ValidationResult {
  if (value.includes("?")) {
    return {
      valid: false,
      code: "QUERY_INJECTION",
      field: fieldName,
      message: `${fieldName} contains '?' (query string injection)`,
    };
  }

  if (value.includes("#")) {
    return {
      valid: false,
      code: "FRAGMENT_INJECTION",
      field: fieldName,
      message: `${fieldName} contains '#' (fragment injection)`,
    };
  }

  return { valid: true };
}

/**
 * Reject strings exceeding the maximum input length.
 * Prevents memory exhaustion and slow regex evaluation on adversarial input.
 */
export function rejectOverlongInput(
  value: string,
  fieldName: string,
): ValidationResult {
  if (value.length > MAX_INPUT_LENGTH) {
    return {
      valid: false,
      code: "INPUT_TOO_LONG",
      field: fieldName,
      message: `${fieldName} exceeds maximum length of ${MAX_INPUT_LENGTH} characters`,
    };
  }
  return { valid: true };
}

/**
 * Reject empty or whitespace-only strings (SEC-05).
 * Catches empty identifiers that would produce silent downstream failures.
 */
export function rejectEmptyInput(
  value: string,
  fieldName: string,
): ValidationResult {
  if (value.trim().length === 0) {
    return {
      valid: false,
      code: "EMPTY_INPUT",
      field: fieldName,
      message: `${fieldName} must not be empty`,
    };
  }
  return { valid: true };
}
