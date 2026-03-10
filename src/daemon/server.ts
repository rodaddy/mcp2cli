/**
 * Daemon HTTP server over Unix domain socket or TCP.
 * Handles /call, /list-tools, /schema, /health, /metrics, /shutdown endpoints.
 * Supports bearer token auth for TCP mode.
 */
// Server type inferred from Bun.serve() return
import type { ServicesConfig } from "../config/index.ts";
import type { ConnectionPool } from "./pool.ts";
import type { IdleTimer } from "./idle.ts";
import type {
  DaemonCallRequest,
  DaemonListToolsRequest,
  DaemonSchemaRequest,
  DaemonCallResponse,
  DaemonErrorResponse,
  DaemonListenConfig,
} from "./types.ts";
import { formatToolResult } from "../invocation/format.ts";
import { listToolsForService, getToolSchema } from "../schema/introspect.ts";
import { ConnectionError } from "../connection/errors.ts";
import { ToolError } from "../invocation/errors.ts";
import type { ErrorCode } from "../types/index.ts";
import { createLogger } from "../logger/index.ts";
import { checkAuth, isAuthExempt } from "./auth.ts";
import type { MetricsCollector } from "./metrics.ts";

const log = createLogger("server");
const reqLog = createLogger("daemon:request");

interface DaemonServerOptions {
  listenConfig: DaemonListenConfig;
  pool: ConnectionPool;
  config: ServicesConfig;
  idleTimer: IdleTimer;
  onShutdown: () => void;
  authToken: string | undefined;
  metrics: MetricsCollector;
}

function errorResponse(
  code: ErrorCode,
  message: string,
  reason?: string,
  status = 500,
): Response {
  const body: DaemonErrorResponse = {
    success: false,
    error: { code, message, reason },
  };
  return Response.json(body, { status });
}

/**
 * Create the daemon HTTP server bound to a Unix socket or TCP port.
 * Returns the Bun.serve() server instance.
 */
export function createDaemonServer(opts: DaemonServerOptions) {
  const { listenConfig, pool, config, idleTimer, onShutdown, authToken, metrics } = opts;

  // Build listen options based on mode
  const listenOpts = listenConfig.mode === "unix"
    ? { unix: listenConfig.socketPath }
    : { hostname: listenConfig.hostname, port: listenConfig.port };

  return Bun.serve({
    ...listenOpts,

    async fetch(req: Request): Promise<Response> {
      const url = new URL(req.url);
      const path = url.pathname;
      log.debug("request received", { method: req.method, path });

      // Auth check (exempt paths skip this)
      if (!isAuthExempt(path) && !checkAuth(req, authToken)) {
        metrics.onAuthFailure();
        return errorResponse("AUTH_ERROR", "Unauthorized", undefined, 401);
      }

      // POST /call -- invoke a tool
      if (path === "/call" && req.method === "POST") {
        idleTimer.onRequestStart();
        metrics.onRequestStart();
        const startTime = performance.now();
        let callService = "unknown";
        let callTool = "unknown";
        let success = false;
        try {
          const body = (await req.json()) as DaemonCallRequest;
          callService = body.service;
          callTool = body.tool;
          const conn = await pool.getConnection(body.service, config);

          // MEM-02: AbortSignal timeout on tool calls (default 30s, configurable)
          const timeout = parseInt(process.env.MCP2CLI_TOOL_TIMEOUT ?? "30000", 10);
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), timeout);

          let sdkResult: Awaited<ReturnType<typeof conn.client.callTool>>;
          try {
            sdkResult = await Promise.race([
              conn.client.callTool({
                name: body.tool,
                arguments: body.params,
              }),
              new Promise<never>((_, reject) => {
                controller.signal.addEventListener("abort", () =>
                  reject(new ToolError(
                    `Tool call timed out after ${timeout}ms`,
                    body.tool,
                  )),
                );
              }),
            ]);
          } finally {
            clearTimeout(timer);
          }

          const duration = Math.round(performance.now() - startTime);
          reqLog.info("tool_call", { service: callService, tool: callTool, duration, result: "success" });
          success = true;
          const formatted = formatToolResult(
            sdkResult as Parameters<typeof formatToolResult>[0],
          );
          const response: DaemonCallResponse = {
            success: true,
            result: formatted.result,
          };
          return Response.json(response);
        } catch (err) {
          const duration = Math.round(performance.now() - startTime);
          const message = err instanceof Error ? err.message : String(err);
          reqLog.info("tool_call", { service: callService, tool: callTool, duration, result: "error", error: message });
          // MEM-02: map timeout errors to TOOL_TIMEOUT code
          if (err instanceof ToolError && err.message.includes("timed out")) {
            return errorResponse("TOOL_TIMEOUT", err.message, err.reason, 408);
          }
          return handleEndpointError(err, pool);
        } finally {
          const duration = Math.round(performance.now() - startTime);
          metrics.onRequestEnd(callService, callTool, success, duration);
          idleTimer.onRequestEnd();
        }
      }

      // POST /list-tools -- list available tools for a service
      if (path === "/list-tools" && req.method === "POST") {
        idleTimer.onRequestStart();
        try {
          const body = (await req.json()) as DaemonListToolsRequest;
          const conn = await pool.getConnection(body.service, config);
          const tools = await listToolsForService(conn.client);
          return Response.json({ success: true, result: tools });
        } catch (err) {
          return handleEndpointError(err, pool);
        } finally {
          idleTimer.onRequestEnd();
        }
      }

      // POST /schema -- get full schema for a service.tool
      if (path === "/schema" && req.method === "POST") {
        idleTimer.onRequestStart();
        try {
          const body = (await req.json()) as DaemonSchemaRequest;
          const conn = await pool.getConnection(body.service, config);
          const result = await getToolSchema(
            conn.client,
            body.tool,
            body.service,
          );
          if (result === null) {
            return errorResponse(
              "UNKNOWN_COMMAND",
              `Tool not found: ${body.tool}`,
              undefined,
              404,
            );
          }
          return Response.json({ success: true, result });
        } catch (err) {
          return handleEndpointError(err, pool);
        } finally {
          idleTimer.onRequestEnd();
        }
      }

      // GET /health -- health check (auth-exempt)
      if (path === "/health" && req.method === "GET") {
        const mem = process.memoryUsage();
        return Response.json({
          status: "ok",
          uptime: process.uptime(),
          services: pool.serviceNames,
          activeConnections: pool.size,
          memory: {
            rss: mem.rss,
            heapUsed: mem.heapUsed,
            heapTotal: mem.heapTotal,
          },
        });
      }

      // GET /metrics -- Prometheus metrics (auth-exempt)
      if (path === "/metrics" && req.method === "GET") {
        const body = metrics.render(pool.size, pool.serviceNames);
        return new Response(body, {
          headers: { "Content-Type": "text/plain; version=0.0.4; charset=utf-8" },
        });
      }

      // POST /shutdown -- graceful shutdown
      if (path === "/shutdown" && req.method === "POST") {
        // Return response FIRST, then schedule shutdown
        setTimeout(() => onShutdown(), 100);
        return Response.json({ status: "shutting_down" });
      }

      // Default: 404
      return Response.json({ error: "not_found" }, { status: 404 });
    },

    error(err: Error): Response {
      return errorResponse("INTERNAL_ERROR", err.message);
    },
  });
}

/** Shared error handler for /call, /list-tools, /schema endpoints */
function handleEndpointError(
  err: unknown,
  _pool: ConnectionPool,
): Response {
  if (err instanceof ConnectionError) {
    return errorResponse("CONNECTION_ERROR", err.message, err.reason);
  }
  if (err instanceof ToolError) {
    return errorResponse("TOOL_ERROR", err.message, err.reason, 400);
  }
  const message = err instanceof Error ? err.message : String(err);
  return errorResponse("INTERNAL_ERROR", message);
}
