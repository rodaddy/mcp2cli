import { z } from "zod";

/**
 * Routing source for per-service remote/local control.
 * - "local": always use local daemon (Mac-only services)
 * - "remote": always route to remote daemon
 * - "remote-local": try remote first, fall back to local if unreachable
 * When omitted, defaults to "local" (no remote URL) or "remote-local" (remote URL set).
 */
export const SourceSchema = z
  .enum(["local", "remote", "remote-local"])
  .optional();
export type ServiceSource = z.infer<typeof SourceSchema>;

const SecretRefUrlSchema = z
  .string()
  .refine(
    (value) =>
      /^\$\{secret:[^}]+\}$/.test(value) ||
      z.string().url().safeParse(value).success,
    { message: "Invalid url" },
  );

/**
 * Tool access control fields shared by all service backends.
 * allowTools: glob patterns for tools to include (whitelist). If set, only matching tools are visible.
 * blockTools: glob patterns for tools to exclude (blacklist). Applied after allowTools.
 * Both use simple glob syntax: * matches any chars, ? matches single char.
 */
const accessControlFields = {
  allowTools: z.array(z.string()).optional(),
  blockTools: z.array(z.string()).optional(),
  /** Per-service tool call timeout in milliseconds. Overrides MCP2CLI_TOOL_TIMEOUT env var. */
  timeout: z.number().int().positive().optional(),
  /** OS platforms where this service can run locally. Values match process.platform. */
  platforms: z.array(z.string().min(1)).optional(),
  /**
   * Require a per-identity credential before connecting this service through
   * the daemon. This is for identity-sensitive services whose backend bearer
   * token determines data ownership, such as Open Brain namespaces.
   */
  requiresCredentials: z.boolean().optional(),
  /**
   * Whether daemon startup preconnect should open a base connection for this
   * service. Defaults to true. Set false for services that require per-user
   * credentials so the unauthenticated base service is never probed.
   */
  preconnect: z.boolean().optional(),
  source: SourceSchema,
};

/**
 * Stdio-based MCP service configuration.
 * Launches a local process and communicates via stdin/stdout.
 */
export const StdioServiceSchema = z.object({
  description: z.string().optional(),
  backend: z.literal("stdio"),
  command: z.string().min(1),
  args: z.array(z.string()).optional().default([]),
  env: z.record(z.string(), z.string()).optional().default({}),
  ...accessControlFields,
});

/**
 * Stdio fallback configuration for HTTP services.
 * When the HTTP gateway is unreachable, the CLI falls back to this local process.
 */
export const StdioFallbackSchema = z.object({
  command: z.string().min(1),
  args: z.array(z.string()).optional().default([]),
  env: z.record(z.string(), z.string()).optional().default({}),
});

/**
 * HTTP-based MCP service configuration.
 * Connects to a remote MCP server over HTTP/SSE.
 * Optional fallback launches a local stdio process when the gateway is unreachable.
 */
export const HttpServiceSchema = z.object({
  description: z.string().optional(),
  backend: z.literal("http"),
  url: SecretRefUrlSchema,
  headers: z.record(z.string(), z.string()).optional().default({}),
  fallback: StdioFallbackSchema.optional(),
  ...accessControlFields,
});

/**
 * WebSocket-based MCP service configuration.
 * Connects to a remote MCP server over WebSocket.
 * Optional fallback launches a local stdio process when the server is unreachable.
 */
export const WebSocketServiceSchema = z.object({
  description: z.string().optional(),
  backend: z.literal("websocket"),
  url: SecretRefUrlSchema,
  headers: z.record(z.string(), z.string()).optional().default({}),
  fallback: StdioFallbackSchema.optional(),
  ...accessControlFields,
});

/**
 * Discriminated union of all supported service backends.
 * The "backend" field determines which schema variant applies.
 */
export const ServiceSchema = z.discriminatedUnion("backend", [
  StdioServiceSchema,
  HttpServiceSchema,
  WebSocketServiceSchema,
]);

/**
 * Root configuration schema for services.json.
 * Requires at least one service to be configured.
 */
export const ServicesConfigSchema = z.object({
  importUrl: z.string().url().optional(),
  importTtlSeconds: z.number().int().nonnegative().optional(),
  services: z
    .record(z.string(), ServiceSchema)
    .refine((obj) => Object.keys(obj).length > 0, {
      message: "At least one service must be configured",
    }),
});

/** Inferred types from schemas */
export type StdioService = z.infer<typeof StdioServiceSchema>;
export type StdioFallback = z.infer<typeof StdioFallbackSchema>;
export type HttpService = z.infer<typeof HttpServiceSchema>;
export type WebSocketService = z.infer<typeof WebSocketServiceSchema>;
export type ServiceConfig = z.infer<typeof ServiceSchema>;
export type ServicesConfig = z.infer<typeof ServicesConfigSchema>;
