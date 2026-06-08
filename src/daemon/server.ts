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
import { listToolsForService, getToolSchema, resolveToolName } from "../schema/introspect.ts";
import { ConnectionError } from "../connection/errors.ts";
import { ToolError } from "../invocation/errors.ts";
import type { ErrorCode } from "../types/index.ts";
import { createLogger } from "../logger/index.ts";
import { isAuthExempt, authenticateRequest, checkPermission } from "./auth.ts";
import { TokenAuthProvider } from "./auth-provider.ts";
import type { AuthProvider, AuthContext } from "./auth-provider.ts";
import type { MetricsCollector } from "./metrics.ts";
import { ConfigManager, ConfigManagerError } from "./config-manager.ts";
import { renderUI } from "./ui.ts";

const log = createLogger("server");
const reqLog = createLogger("daemon:request");

interface DaemonServerOptions {
  listenConfig: DaemonListenConfig;
  pool: ConnectionPool;
  config: ServicesConfig;
  configManager?: ConfigManager;
  idleTimer: IdleTimer;
  onShutdown: () => void;
  authProvider: AuthProvider;
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
  const { listenConfig, pool, config, configManager, idleTimer, onShutdown, authProvider, metrics } = opts;

  // Use configManager's live config for pool lookups when available
  const getConfig = (): ServicesConfig => configManager ? configManager.getServices() : config;

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
      let authCtx: AuthContext | null = null;
      if (!isAuthExempt(path)) {
        authCtx = authenticateRequest(req, authProvider);
        if (!authCtx) {
          metrics.onAuthFailure();
          return errorResponse("AUTH_ERROR", "Unauthorized", undefined, 401);
        }
        // RBAC permission check
        const denied = checkPermission(req, authCtx);
        if (denied) {
          return errorResponse("AUTH_ERROR", `Permission denied: ${denied} requires higher role`, undefined, 403);
        }
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
          const conn = await pool.getConnection(body.service, getConfig());

          // MEM-02: AbortSignal timeout on tool calls
          // Priority: per-service config > MCP2CLI_TOOL_TIMEOUT env > 30s default
          const serviceConfig = getConfig().services[body.service];
          const perServiceTimeout = serviceConfig && "timeout" in serviceConfig ? serviceConfig.timeout : undefined;
          const timeout = perServiceTimeout ?? parseInt(process.env.MCP2CLI_TOOL_TIMEOUT ?? "30000", 10);
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), timeout);

          let resolvedTool = body.tool;
          try {
            const allTools = await conn.client.listTools();
            resolvedTool = resolveToolName(allTools.tools, body.tool, body.service) ?? body.tool;
          } catch { /* listTools unavailable, use original name */ }
          let sdkResult: Awaited<ReturnType<typeof conn.client.callTool>>;
          try {
            sdkResult = await Promise.race([
              conn.client.callTool({
                name: resolvedTool,
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
          const conn = await pool.getConnection(body.service, getConfig());
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
          const conn = await pool.getConnection(body.service, getConfig());
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

      // POST /api/auth/login -- exchange username+password for bearer token (auth-exempt)
      if (path === "/api/auth/login" && req.method === "POST") {
        try {
          const body = await req.json() as { username?: string; password?: string };
          if (!body.username || !body.password) {
            return errorResponse("INPUT_VALIDATION_ERROR", "Missing username or password", undefined, 400);
          }
          if (!(authProvider instanceof TokenAuthProvider)) {
            return errorResponse("AUTH_ERROR", "Login not supported with current auth provider", undefined, 501);
          }
          const result = authProvider.authenticateBasic(body.username, body.password);
          if (!result) {
            metrics.onAuthFailure();
            return Response.json({ success: false, error: "Invalid username or password" }, { status: 401 });
          }
          return Response.json({
            success: true,
            token: result.token,
            userId: result.ctx.userId,
            role: result.ctx.role,
          });
        } catch {
          return errorResponse("INPUT_VALIDATION_ERROR", "Invalid request body", undefined, 400);
        }
      }

      // GET /api/auth/me -- returns current user identity and role
      if (path === "/api/auth/me" && req.method === "GET") {
        return Response.json({
          success: true,
          userId: authCtx?.userId ?? "anonymous",
          role: authCtx?.role ?? "admin",
        });
      }

      // --- Management API routes (require configManager) ---
      if (configManager) {
        // GET / -- Web UI
        if (path === "/" && req.method === "GET") {
          return new Response(renderUI(), {
            headers: { "Content-Type": "text/html; charset=utf-8" },
          });
        }

        // GET /api/services -- list all services with connection status
        if (path === "/api/services" && req.method === "GET") {
          const cfg = configManager.getServices();
          const services = Object.entries(cfg.services).map(([name, svc]) => ({
            name,
            backend: svc.backend,
            connected: pool.serviceNames.includes(name),
            ...(svc.backend !== "stdio" && "url" in svc ? { url: svc.url } : {}),
          }));
          return Response.json({ success: true, services });
        }

        // POST /api/services -- add a service { name, config }
        if (path === "/api/services" && req.method === "POST") {
          try {
            const body = await req.json() as { name: string; config: unknown };
            if (!body.name || !body.config) {
              return errorResponse("INPUT_VALIDATION_ERROR", "Missing 'name' or 'config' field", undefined, 400);
            }
            await configManager.addService(body.name, body.config);
            return Response.json({ success: true, message: `Service '${body.name}' added` }, { status: 201 });
          } catch (err) {
            if (err instanceof ConfigManagerError) {
              return errorResponse("INPUT_VALIDATION_ERROR", err.message, undefined, 400);
            }
            return errorResponse("INTERNAL_ERROR", err instanceof Error ? err.message : String(err));
          }
        }

        // PUT /api/services/:name -- update a service
        const putMatch = path.match(/^\/api\/services\/([^/]+)$/);
        if (putMatch && req.method === "PUT") {
          try {
            const name = decodeURIComponent(putMatch[1]!);
            const body = await req.json() as { config: unknown };
            if (!body.config) {
              return errorResponse("INPUT_VALIDATION_ERROR", "Missing 'config' field", undefined, 400);
            }
            await configManager.updateService(name, body.config);
            return Response.json({ success: true, message: `Service '${name}' updated` });
          } catch (err) {
            if (err instanceof ConfigManagerError) {
              return errorResponse("INPUT_VALIDATION_ERROR", err.message, undefined, 400);
            }
            return errorResponse("INTERNAL_ERROR", err instanceof Error ? err.message : String(err));
          }
        }

        // DELETE /api/services/:name -- remove a service
        const deleteMatch = path.match(/^\/api\/services\/([^/]+)$/);
        if (deleteMatch && req.method === "DELETE") {
          try {
            const name = decodeURIComponent(deleteMatch[1]!);
            await configManager.removeService(name);
            return Response.json({ success: true, message: `Service '${name}' removed` });
          } catch (err) {
            if (err instanceof ConfigManagerError) {
              return errorResponse("INPUT_VALIDATION_ERROR", err.message, undefined, 400);
            }
            return errorResponse("INTERNAL_ERROR", err instanceof Error ? err.message : String(err));
          }
        }

        // GET /api/services/:name/status -- connection health + tool count
        const statusMatch = path.match(/^\/api\/services\/([^/]+)\/status$/);
        if (statusMatch && req.method === "GET") {
          try {
            const name = decodeURIComponent(statusMatch[1]!);
            const svc = configManager.getService(name);
            if (!svc) {
              return errorResponse("UNKNOWN_COMMAND", `Service not found: ${name}`, undefined, 404);
            }
            const connected = pool.serviceNames.includes(name);
            let toolCount = 0;
            if (connected) {
              try {
                const conn = await pool.getConnection(name, getConfig());
                const tools = await listToolsForService(conn.client);
                toolCount = tools.length;
              } catch { /* connection may have gone stale */ }
            }
            return Response.json({
              success: true,
              name,
              backend: svc.backend,
              connected,
              toolCount,
            });
          } catch (err) {
            return errorResponse("INTERNAL_ERROR", err instanceof Error ? err.message : String(err));
          }
        }

        // POST /api/services/reload -- reload config from disk
        if (path === "/api/services/reload" && req.method === "POST") {
          try {
            const diff = await configManager.reloadFromDisk();
            return Response.json({ success: true, ...diff });
          } catch (err) {
            if (err instanceof ConfigManagerError) {
              return errorResponse("INPUT_VALIDATION_ERROR", err.message, undefined, 400);
            }
            return errorResponse("INTERNAL_ERROR", err instanceof Error ? err.message : String(err));
          }
        }

        // POST /api/services/import -- import from URL { url, mode?, repo?, branch?, path? }
        if (path === "/api/services/import" && req.method === "POST") {
          try {
            const body = await req.json() as {
              url?: string;
              mode?: "merge" | "replace";
              repo?: string;
              branch?: string;
              path?: string;
            };
            let importUrl = body.url;
            if (!importUrl && body.repo) {
              importUrl = ConfigManager.buildGitHubRawUrl(
                body.repo,
                body.branch ?? "main",
                body.path ?? "services.json",
              );
            }
            if (!importUrl) {
              return errorResponse("INPUT_VALIDATION_ERROR", "Missing 'url' or 'repo' field", undefined, 400);
            }
            const diff = await configManager.importFromUrl(importUrl, body.mode ?? "merge");
            return Response.json({ success: true, url: importUrl, ...diff });
          } catch (err) {
            if (err instanceof ConfigManagerError) {
              return errorResponse("INPUT_VALIDATION_ERROR", err.message, undefined, 400);
            }
            return errorResponse("INTERNAL_ERROR", err instanceof Error ? err.message : String(err));
          }
        }
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
