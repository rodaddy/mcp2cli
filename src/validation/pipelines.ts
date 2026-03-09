import type { ValidationResult, ValidationCode } from "./types.ts";
import type { CliError } from "../types/index.ts";
import {
  rejectEmptyInput,
  rejectOverlongInput,
  rejectControlChars,
  rejectPathTraversal,
  rejectQueryFragment,
} from "./validators.ts";

/**
 * Validator function signature for pipeline composition.
 */
export type Validator = (value: string, fieldName: string) => ValidationResult;

/**
 * Run a chain of validators in order, short-circuiting on first failure.
 * Returns {valid: true} if all validators pass.
 */
export function validateChain(
  value: string,
  fieldName: string,
  validators: Validator[],
): ValidationResult {
  for (const validate of validators) {
    const result = validate(value, fieldName);
    if (!result.valid) return result;
  }
  return { valid: true };
}

/**
 * Validate a string as a strict identifier (IDs, names, keys).
 * Applies all 4 validators: length, control chars, path traversal, query/fragment.
 */
export function validateIdentifier(
  value: string,
  fieldName: string,
): ValidationResult {
  return validateChain(value, fieldName, [
    rejectEmptyInput,
    rejectOverlongInput,
    rejectControlChars,
    rejectPathTraversal,
    rejectQueryFragment,
  ]);
}

/**
 * Validate a string as free text (descriptions, prompts).
 * Only checks length and control characters -- allows ? and # in text context.
 */
export function validateText(
  value: string,
  fieldName: string,
): ValidationResult {
  return validateChain(value, fieldName, [
    rejectOverlongInput,
    rejectControlChars,
  ]);
}

/**
 * Convert a failed ValidationResult to a CliError.
 * Maps the specific ValidationCode into the reason field.
 */
export function validationResultToCliError(
  result: { valid: false; code: ValidationCode; field: string; message: string },
): CliError {
  return {
    error: true,
    code: "INPUT_VALIDATION_ERROR",
    message: result.message,
    reason: result.code,
  };
}
