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
  "DYLD_INSERT_LIBRARIES",
  "NODE_OPTIONS",
  "NODE_PATH",
  "PYTHONPATH",
  "HOME",
  "BUN_FLAGS",
  "MCP2CLI_AUTH_TOKEN",
  "MCP2CLI_CREDENTIALS_FILE",
  "MCP2CLI_TOKENS_FILE",
]);

const RESERVED_OBJECT_KEYS = new Set(["__proto__", "constructor", "prototype"]);

export const CredentialKeySchema = z.string()
  .min(1)
  .max(256)
  .refine((name) => !RESERVED_OBJECT_KEYS.has(name), {
    message: "Reserved object key is not allowed",
  })
  .refine((name) => !/[\u0000-\u001f\u007f]/.test(name), {
    message: "Control characters are not allowed",
  })
  .refine((name) => !/[/?#\\]/.test(name), {
    message: "Path, query, and fragment separators are not allowed",
  });

function credentialRecord<Value extends z.ZodType>(
  valueSchema: Value,
) {
  return z.unknown()
    .superRefine((value, ctx) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return;
      for (const key of Object.keys(value)) {
        const result = CredentialKeySchema.safeParse(key);
        if (!result.success) {
          ctx.addIssue({
            code: "custom",
            path: [key],
            message: result.error.issues.map((i) => i.message).join(", "),
          });
        }
      }
    })
    .pipe(z.record(z.string(), valueSchema));
}

/**
 * Per-service credential overrides.
 * For http/websocket: override headers sent to the backend.
 * For stdio: override env vars passed to the spawned process.
 */
export const ServiceCredentialSchema = z.object({
  headers: credentialRecord(
    z.string().max(8192).refine(
      (val) => !/[\r\n]/.test(val),
      { message: "Header values must not contain \\r or \\n" },
    ),
  ).superRefine((headers, ctx) => {
    for (const name of Object.keys(headers)) {
      if (DANGEROUS_HEADERS.has(name.toLowerCase())) {
        ctx.addIssue({
          code: "custom",
          path: [name],
          message: "Dangerous header name (Host, Transfer-Encoding, Content-Length, Connection)",
        });
      }
    }
  }).refine(
    (r) => Object.keys(r).length <= 50,
    { message: "Too many headers (max 50)" },
  ).optional(),
  env: credentialRecord(
    z.string().max(8192),
  ).superRefine((env, ctx) => {
    for (const name of Object.keys(env)) {
      if (DANGEROUS_ENV_VARS.has(name)) {
        ctx.addIssue({
          code: "custom",
          path: [name],
          message: "Dangerous env var name",
        });
      }
    }
  }).refine(
    (r) => Object.keys(r).length <= 50,
    { message: "Too many env vars (max 50)" },
  ).optional(),
}).refine(
  (data) => data.headers !== undefined || data.env !== undefined,
  { message: "Credential must have at least one of 'headers' or 'env'" },
);

/**
 * Credential mapping: identity/group name -> service name -> credential overrides.
 */
const CredentialMapSchema = credentialRecord(credentialRecord(ServiceCredentialSchema));

/**
 * Root credentials.json schema.
 * - groups: named sets of user/agent IDs for shared credential assignment
 * - credentials: per-identity or per-group credential overrides
 * - defaults: fallback credentials when no identity/group match exists
 */
export const CredentialsConfigSchema = z.object({
  groups: credentialRecord(z.array(CredentialKeySchema)).optional().default({}),
  credentials: CredentialMapSchema.optional().default({}),
  defaults: credentialRecord(ServiceCredentialSchema).optional().default({}),
});

export type ServiceCredential = z.infer<typeof ServiceCredentialSchema>;
export type CredentialsConfig = z.infer<typeof CredentialsConfigSchema>;
