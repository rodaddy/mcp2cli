import { z } from "zod";

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
});

/**
 * HTTP-based MCP service configuration.
 * Connects to a remote MCP server over HTTP/SSE.
 */
export const HttpServiceSchema = z.object({
  description: z.string().optional(),
  backend: z.literal("http"),
  url: z.string().url(),
  headers: z.record(z.string(), z.string()).optional().default({}),
});

/**
 * Discriminated union of all supported service backends.
 * The "backend" field determines which schema variant applies.
 */
export const ServiceSchema = z.discriminatedUnion("backend", [
  StdioServiceSchema,
  HttpServiceSchema,
]);

/**
 * Root configuration schema for services.json.
 * Requires at least one service to be configured.
 */
export const ServicesConfigSchema = z.object({
  services: z
    .record(z.string(), ServiceSchema)
    .refine((obj) => Object.keys(obj).length > 0, {
      message: "At least one service must be configured",
    }),
});

/** Inferred types from schemas */
export type StdioService = z.infer<typeof StdioServiceSchema>;
export type HttpService = z.infer<typeof HttpServiceSchema>;
export type ServiceConfig = z.infer<typeof ServiceSchema>;
export type ServicesConfig = z.infer<typeof ServicesConfigSchema>;
