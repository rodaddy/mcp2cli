/**
 * Field masking for tool call responses.
 * Supports dot-notation paths to extract nested fields from response objects.
 */

/** Result of applying a field mask */
export interface FieldMaskResult {
  masked: unknown;
  missing: string[];
}

/**
 * Walk a dot-separated path on an object/array.
 * Handles array indices (numeric segments on arrays).
 * Returns undefined on miss -- never throws.
 */
export function getByPath(obj: unknown, path: string): unknown {
  const segments = path.split(".");
  let current: unknown = obj;

  for (const segment of segments) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== "object") return undefined;

    if (Array.isArray(current)) {
      const index = Number(segment);
      if (Number.isNaN(index)) return undefined;
      current = current[index];
    } else {
      current = (current as Record<string, unknown>)[segment];
    }
  }

  return current;
}

/**
 * Set a value at a dot-separated path, creating intermediate objects/arrays as needed.
 * If the next segment is numeric, creates an array; otherwise creates an object.
 */
export function setByPath(
  obj: Record<string, unknown>,
  path: string,
  value: unknown,
): void {
  const segments = path.split(".");
  let current: Record<string, unknown> = obj;

  for (let i = 0; i < segments.length - 1; i++) {
    const segment = segments[i]!;
    const nextSegment = segments[i + 1]!;
    const nextIsNumeric = /^\d+$/.test(nextSegment);

    if (current[segment] === undefined || current[segment] === null) {
      current[segment] = nextIsNumeric ? [] : {};
    }

    current = current[segment] as Record<string, unknown>;
  }

  const lastSegment = segments[segments.length - 1]!;
  if (Array.isArray(current)) {
    const index = Number(lastSegment);
    (current as unknown[])[index] = value;
  } else {
    current[lastSegment] = value;
  }
}

/**
 * Apply a field mask to data.
 * - Non-object/non-array data: returns data unchanged with all fields as missing
 * - Object: extracts each field path, tracks missing
 * - Array: applies mask to each item, dedupes missing across items
 */
export function applyFieldMask(
  data: unknown,
  fields: string[],
): FieldMaskResult {
  // Non-object/non-array: nothing to extract from
  if (data === null || data === undefined || typeof data !== "object") {
    return { masked: data, missing: [...fields] };
  }

  // Array of items: apply mask to each
  if (Array.isArray(data)) {
    const allMissing = new Set<string>(fields);
    const maskedItems: unknown[] = [];

    for (const item of data) {
      if (item === null || item === undefined || typeof item !== "object" || Array.isArray(item)) {
        maskedItems.push(item);
        continue;
      }

      const itemResult = applyFieldMaskToObject(item as Record<string, unknown>, fields);
      maskedItems.push(itemResult.masked);

      // Remove fields that were found in this item
      for (const field of fields) {
        if (!itemResult.missing.includes(field)) {
          allMissing.delete(field);
        }
      }
    }

    return { masked: maskedItems, missing: [...allMissing] };
  }

  // Single object
  return applyFieldMaskToObject(data as Record<string, unknown>, fields);
}

/**
 * Apply field mask to a single object.
 * Internal helper -- handles dot-notation extraction.
 */
function applyFieldMaskToObject(
  obj: Record<string, unknown>,
  fields: string[],
): FieldMaskResult {
  const masked: Record<string, unknown> = {};
  const missing: string[] = [];

  for (const field of fields) {
    const value = getByPath(obj, field);
    if (value === undefined) {
      missing.push(field);
    } else {
      setByPath(masked, field, value);
    }
  }

  return { masked, missing };
}
