/**
 * Schema surface hashing.
 * Produces deterministic SHA-256 hashes from tool schemas using canonical JSON.
 */

/**
 * Produce canonical JSON: sorted keys recursively, no whitespace.
 * Deterministic serialization ensures identical schemas always hash the same.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, val) => {
    if (val !== null && typeof val === "object" && !Array.isArray(val)) {
      const sorted: Record<string, unknown> = {};
      for (const k of Object.keys(val as Record<string, unknown>).sort()) {
        sorted[k] = (val as Record<string, unknown>)[k];
      }
      return sorted;
    }
    return val;
  });
}

/**
 * Compute SHA-256 hash of a tool's schema surface.
 * The "surface" is: name + description + inputSchema + annotations.
 * All serialized as canonical JSON before hashing.
 */
export async function hashToolSchema(tool: {
  name: string;
  description?: string;
  inputSchema: object;
  annotations?: object;
}): Promise<string> {
  const surface = canonicalJson({
    name: tool.name,
    description: tool.description ?? "",
    inputSchema: tool.inputSchema,
    annotations: tool.annotations ?? null,
  });

  const encoder = new TextEncoder();
  const data = encoder.encode(surface);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = new Uint8Array(hashBuffer);

  return Array.from(hashArray)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
