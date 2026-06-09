/**
 * Shared schema hash computation for skill drift detection.
 * Used by generate-skills, auto-regen, and skills list commands.
 */

/**
 * Compute a truncated SHA-256 hash from tool names and descriptions.
 * Used to detect schema drift without comparing full file content.
 *
 * @param tools - Array of tools with name and optional description
 * @returns 16-char hex hash string
 */
export async function computeSchemaHash(
  tools: { name: string; description?: string }[],
): Promise<string> {
  const surface = tools
    .map((t) => `${t.name}:${t.description ?? ""}`)
    .sort()
    .join("|");
  const data = new TextEncoder().encode(surface);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16);
}

/**
 * Compute a schema hash that includes full input schemas.
 * Catches parameter changes in addition to name/description drift.
 *
 * @param schemas - Array of schemas with tool name and inputSchema
 * @returns 16-char hex hash string
 */
export async function computeFullSchemaHash(
  schemas: { tool: string; inputSchema: object }[],
): Promise<string> {
  const surface = schemas
    .map((s) => `${s.tool}:${JSON.stringify(s.inputSchema)}`)
    .sort()
    .join("|");
  const data = new TextEncoder().encode(surface);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16);
}
