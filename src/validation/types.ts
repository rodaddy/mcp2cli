/**
 * Machine-readable validation error codes.
 * Each code maps to a specific attack category from SEC requirements.
 */
export type ValidationCode =
  | "CONTROL_CHAR"
  | "PATH_TRAVERSAL"
  | "QUERY_INJECTION"
  | "FRAGMENT_INJECTION"
  | "INPUT_TOO_LONG"
  | "EMPTY_INPUT"
  | "PROTOTYPE_POLLUTION"
  | "MAX_DEPTH_EXCEEDED";

/**
 * Discriminated union for validation results.
 * Success returns {valid: true}. Failure includes code, field, and message.
 */
export type ValidationResult =
  | { valid: true }
  | { valid: false; code: ValidationCode; field: string; message: string };
