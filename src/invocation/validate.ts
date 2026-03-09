import type { ValidationResult } from "../validation/types.ts";
import { validateIdentifier, validateText } from "../validation/pipelines.ts";
import type { ParsedToolCall } from "./types.ts";

/**
 * Validate all user-provided inputs in a parsed tool call.
 * Runs Phase 3 validators on service name, tool name, and all param keys/values.
 * Short-circuits on first failure.
 */
export function validateToolCallInputs(
  parsed: ParsedToolCall,
): ValidationResult {
  const serviceResult = validateIdentifier(parsed.serviceName, "service");
  if (!serviceResult.valid) return serviceResult;

  const toolResult = validateIdentifier(parsed.toolName, "tool");
  if (!toolResult.valid) return toolResult;

  return validateParamValues(parsed.params, "params");
}

/** Keys that must be rejected to prevent prototype pollution. */
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/** Maximum nesting depth for recursive param validation. */
const MAX_DEPTH = 10;

/**
 * Recursively validate param keys (as identifiers) and string values (as text).
 * Non-string primitives (number, boolean, null) pass through without validation.
 * Nested objects are recursed. Array elements are validated individually.
 */
export function validateParamValues(
  obj: Record<string, unknown>,
  parentPath = "params",
  depth = 0,
): ValidationResult {
  // Recursion depth limit
  if (depth > MAX_DEPTH) {
    return {
      valid: false,
      code: "MAX_DEPTH_EXCEEDED",
      field: parentPath,
      message: `Object nesting exceeds maximum depth of ${MAX_DEPTH}`,
    };
  }

  for (const key of Object.keys(obj)) {
    // Reject prototype pollution keys
    if (FORBIDDEN_KEYS.has(key)) {
      return {
        valid: false,
        code: "PROTOTYPE_POLLUTION",
        field: `${parentPath}.${key}`,
        message: `Forbidden key "${key}" (prototype pollution)`,
      };
    }

    const fieldPath = `${parentPath}.${key}`;

    // Validate key as identifier
    const keyResult = validateIdentifier(key, `${fieldPath}(key)`);
    if (!keyResult.valid) return keyResult;

    const value = obj[key];

    // Validate string values as text
    if (typeof value === "string") {
      const valResult = validateText(value, fieldPath);
      if (!valResult.valid) return valResult;
    }

    // Recurse into nested objects (skip null)
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      const nestedResult = validateParamValues(
        value as Record<string, unknown>,
        fieldPath,
        depth + 1,
      );
      if (!nestedResult.valid) return nestedResult;
    }

    // Validate array elements
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        const elem = value[i] as unknown;
        const elemPath = `${fieldPath}[${i}]`;

        if (typeof elem === "string") {
          const elemResult = validateText(elem, elemPath);
          if (!elemResult.valid) return elemResult;
        }

        // Fix 6: Handle nested arrays by recursing
        if (Array.isArray(elem)) {
          const arrayResult = validateParamValues(
            Object.fromEntries(
              (elem as unknown[]).map((v, j) => [String(j), v]),
            ),
            elemPath,
            depth + 1,
          );
          if (!arrayResult.valid) return arrayResult;
        }

        if (
          typeof elem === "object" &&
          elem !== null &&
          !Array.isArray(elem)
        ) {
          const nestedResult = validateParamValues(
            elem as Record<string, unknown>,
            elemPath,
            depth + 1,
          );
          if (!nestedResult.valid) return nestedResult;
        }
      }
    }
  }

  return { valid: true };
}
