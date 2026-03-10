/**
 * Simple YAML formatter -- no external dependencies.
 * Handles flat/nested objects, arrays, and primitive values.
 * Produces valid YAML output with proper string quoting.
 */

/**
 * Characters that require quoting in YAML string values.
 */
const YAML_SPECIAL_CHARS = /[:#\[\]{}&*!|>'"%@`,?\\]/;
const YAML_BOOL_PATTERN = /^(true|false|yes|no|on|off|null)$/i;
const YAML_NUMBER_PATTERN = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/;

/**
 * Check if a string value needs quoting in YAML.
 */
function needsQuoting(value: string): boolean {
  if (value === "") return true;
  if (value.startsWith(" ") || value.endsWith(" ")) return true;
  if (YAML_SPECIAL_CHARS.test(value)) return true;
  if (YAML_BOOL_PATTERN.test(value)) return true;
  if (YAML_NUMBER_PATTERN.test(value) && typeof value === "string") return true;
  if (value.includes("\n")) return true;
  return false;
}

/**
 * Quote a YAML string value using double quotes with escaping.
 */
function quoteString(value: string): string {
  const escaped = value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\t/g, "\\t")
    .replace(/\r/g, "\\r");
  return `"${escaped}"`;
}

/**
 * Format a key for YAML output, quoting if necessary.
 */
function formatKey(key: string): string {
  if (needsQuoting(key)) {
    return quoteString(key);
  }
  return key;
}

/**
 * Format a value as a YAML string.
 */
function formatValue(value: string): string {
  if (needsQuoting(value)) {
    return quoteString(value);
  }
  return value;
}

/**
 * Serialize data to YAML format.
 */
export function formatYaml(data: unknown): string {
  return serializeYaml(data, 0).trimEnd();
}

/**
 * Recursively serialize a value to YAML with proper indentation.
 */
function serializeYaml(data: unknown, indent: number): string {
  if (data === null || data === undefined) {
    return "null\n";
  }

  if (typeof data === "boolean") {
    return `${data}\n`;
  }

  if (typeof data === "number") {
    return `${data}\n`;
  }

  if (typeof data === "string") {
    return `${formatValue(data)}\n`;
  }

  if (Array.isArray(data)) {
    return serializeArray(data, indent);
  }

  if (typeof data === "object") {
    return serializeObject(data as Record<string, unknown>, indent);
  }

  return `${String(data)}\n`;
}

/**
 * Serialize an array to YAML.
 */
function serializeArray(arr: unknown[], indent: number): string {
  if (arr.length === 0) {
    return "[]\n";
  }

  const prefix = " ".repeat(indent);
  let result = "\n";

  for (const item of arr) {
    if (item === null || item === undefined) {
      result += `${prefix}- null\n`;
    } else if (typeof item === "object" && !Array.isArray(item)) {
      // Object items: first key on same line as dash
      const obj = item as Record<string, unknown>;
      const keys = Object.keys(obj);
      if (keys.length === 0) {
        result += `${prefix}- {}\n`;
      } else {
        const firstKey = keys[0] as string;
        const firstValue = obj[firstKey];
        const restKeys = keys.slice(1);

        // First key on dash line
        if (isScalar(firstValue)) {
          result += `${prefix}- ${formatKey(firstKey)}: ${serializeYaml(firstValue, indent + 2).trimStart()}`;
        } else {
          result += `${prefix}- ${formatKey(firstKey)}:${serializeYaml(firstValue, indent + 4)}`;
        }

        // Remaining keys indented under the dash
        for (const key of restKeys) {
          const value = obj[key];
          if (isScalar(value)) {
            result += `${prefix}  ${formatKey(key)}: ${serializeYaml(value, indent + 2).trimStart()}`;
          } else {
            result += `${prefix}  ${formatKey(key)}:${serializeYaml(value, indent + 2)}`;
          }
        }
      }
    } else if (Array.isArray(item)) {
      result += `${prefix}-${serializeYaml(item, indent + 2)}`;
    } else {
      result += `${prefix}- ${serializeYaml(item, indent + 2).trimStart()}`;
    }
  }

  return result;
}

/**
 * Serialize an object to YAML.
 */
function serializeObject(
  obj: Record<string, unknown>,
  indent: number,
): string {
  const keys = Object.keys(obj);
  if (keys.length === 0) {
    return "{}\n";
  }

  const prefix = " ".repeat(indent);
  let result = "\n";

  for (const key of keys) {
    const value = obj[key];
    if (isScalar(value)) {
      result += `${prefix}${formatKey(key)}: ${serializeYaml(value, indent + 2).trimStart()}`;
    } else {
      result += `${prefix}${formatKey(key)}:${serializeYaml(value, indent + 2)}`;
    }
  }

  return result;
}

/**
 * Check if a value is a scalar (not object/array).
 */
function isScalar(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "object") return false;
  return true;
}
