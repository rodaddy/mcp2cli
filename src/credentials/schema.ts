import { z } from "zod";

const DANGEROUS_HEADERS = new Set([
  "host",
  "transfer-encoding",
  "content-length",
  "connection",
]);

const DANGEROUS_ENV_VARS = new Set([
  "PATH",
  "LD_PRELOAD",
  "LD_LIBRARY_PATH",
  "DYLD_LIBRARY_PATH",
  "NODE_OPTIONS",
  "BUN_FLAGS",
]);

/**
 * Per-service credential overrides.
 * For http/websocket: override headers sent to the backend.
 * For stdio: override env vars passed to the spawned process.
 */
export const ServiceCredentialSchema = z.object({
  headers: z.record(
    z.string().refine(
      (name) => !DANGEROUS_HEADERS.has(name.toLowerCase()),
      { message: "Dangerous header name (Host, Transfer-Encoding, Content-Length, Connection)" },
    ),
    z.string().refine(
      (val) => !/[\r\n]/.test(val),
      { message: "Header values must not contain \\r or \\n" },
    ),
  ).optional(),
  env: z.record(
    z.string().refine(
      (name) => !DANGEROUS_ENV_VARS.has(name),
      { message: "Dangerous env var name (PATH, LD_PRELOAD, LD_LIBRARY_PATH, DYLD_LIBRARY_PATH, NODE_OPTIONS, BUN_FLAGS)" },
    ),
    z.string(),
  ).optional(),
}).refine(
  (data) => data.headers !== undefined || data.env !== undefined,
  { message: "Credential must have at least one of 'headers' or 'env'" },
);

/**
 * Credential mapping: identity/group name -> service name -> credential overrides.
 */
const CredentialMapSchema = z.record(
  z.string(),
  z.record(z.string(), ServiceCredentialSchema),
);

/**
 * Root credentials.json schema.
 * - groups: named sets of user/agent IDs for shared credential assignment
 * - credentials: per-identity or per-group credential overrides
 * - defaults: fallback credentials when no identity/group match exists
 */
export const CredentialsConfigSchema = z.object({
  groups: z.record(z.string(), z.array(z.string())).optional().default({}),
  credentials: CredentialMapSchema.optional().default({}),
  defaults: z.record(z.string(), ServiceCredentialSchema).optional().default({}),
});

export type ServiceCredential = z.infer<typeof ServiceCredentialSchema>;
export type CredentialsConfig = z.infer<typeof CredentialsConfigSchema>;
