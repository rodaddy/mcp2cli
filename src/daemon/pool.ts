/**
 * Connection pool for lazy MCP connection management.
 * Caches connections by service name, supports concurrent access guard.
 * MEM-04: Bounded pool size (default 50, configurable via MCP2CLI_POOL_MAX).
 * MEM-05: Health check before reuse -- stale connections are replaced.
 */
import { connectToService, connectToHttpService } from "../connection/index.ts";
import { ConnectionError } from "../connection/errors.ts";
import type { McpConnection } from "../connection/types.ts";
import type { ServicesConfig, HttpService } from "../config/index.ts";
import { createLogger } from "../logger/index.ts";
import { checkDriftOnConnect } from "./drift-hook.ts";
import { extractPolicy } from "../access/filter.ts";
import {
  shouldAttemptHttp,
  recordFailure,
  recordSuccess,
} from "../resilience/index.ts";

const log = createLogger("pool");

const DEFAULT_POOL_MAX = 50;
const DEFAULT_HEALTH_CHECK_TIMEOUT_MS = 5000;

interface PoolEntry {
  connection: McpConnection;
  connectedAt: number;
}

interface PoolOptions {
  maxSize?: number;
  healthCheckTimeoutMs?: number;
}

/**
 * Manages a pool of MCP connections, one per service.
 * Lazily connects on first access, caches for reuse,
 * and guards against concurrent duplicate spawns.
 */
export class ConnectionPool {
  private connections = new Map<string, PoolEntry>();
  private pending = new Map<string, Promise<McpConnection>>();
  private readonly _maxSize: number;
  private readonly _healthCheckTimeoutMs: number;

  constructor(options?: PoolOptions) {
    const envMax = parseInt(process.env.MCP2CLI_POOL_MAX ?? "", 10);
    this._maxSize = options?.maxSize ?? (Number.isNaN(envMax) ? DEFAULT_POOL_MAX : envMax);
    this._healthCheckTimeoutMs = options?.healthCheckTimeoutMs ?? DEFAULT_HEALTH_CHECK_TIMEOUT_MS;
  }

  /** Maximum number of concurrent connections allowed. */
  get maxSize(): number {
    return this._maxSize;
  }

  /**
   * Get or create a connection for a named service.
   * Concurrent calls for the same unconnected service share one connection attempt.
   * MEM-05: Cached connections are health-checked before reuse.
   * MEM-04: New connections are rejected if pool is at capacity.
   */
  async getConnection(
    serviceName: string,
    config: ServicesConfig,
  ): Promise<McpConnection> {
    // Check cached connection with health validation
    const cached = this.connections.get(serviceName);
    if (cached) {
      const healthy = await this.isHealthy(cached.connection);
      if (healthy) return cached.connection;

      // Stale connection -- remove and reconnect
      log.warn("stale_connection", { service: serviceName });
      this.connections.delete(serviceName);
      await cached.connection.close().catch(() => {});
      // Fall through to create new connection
    }

    // Check if someone else is already connecting
    const pendingPromise = this.pending.get(serviceName);
    if (pendingPromise) return pendingPromise;

    // MEM-04: Enforce pool size limit for genuinely new connections
    if (this.connections.size >= this._maxSize && !this.connections.has(serviceName)) {
      throw new ConnectionError(
        `Connection pool limit reached (${this._maxSize}). Close unused connections first.`,
        "pool_limit_reached",
      );
    }

    // Look up service config
    const serviceConfig = config.services[serviceName];
    if (!serviceConfig) {
      throw new ConnectionError(
        `Service not found in config: ${serviceName}`,
        "service_not_configured",
      );
    }
    // Create connection promise and store in pending map
    log.info("connecting", { service: serviceName });
    let connectFn: () => Promise<McpConnection>;
    if (serviceConfig.backend === "http") {
      connectFn = () => this.connectHttpWithFallback(serviceName, serviceConfig);
    } else if (serviceConfig.backend === "stdio") {
      connectFn = () => connectToService(serviceConfig);
    } else {
      const backend = (serviceConfig as { backend: string }).backend;
      throw new ConnectionError(
        `Unsupported backend for service ${serviceName}: ${backend}`,
        "unsupported_backend",
      );
    }
    const connectPromise = connectFn().then(
      (connection) => {
        this.connections.set(serviceName, {
          connection,
          connectedAt: Date.now(),
        });
        this.pending.delete(serviceName);
        log.info("connected", { service: serviceName });
        // ADV-02: Fire-and-forget drift check on new connection
        // ADV-06: Pass access policy for skill auto-regeneration filtering
        const policy = extractPolicy(serviceConfig);
        checkDriftOnConnect(serviceName, connection, policy).catch(() => {});
        return connection;
      },
      (err) => {
        this.pending.delete(serviceName);
        const message = err instanceof Error ? err.message : String(err);
        log.error("connect_failed", { service: serviceName, error: message });
        throw err;
      },
    );

    this.pending.set(serviceName, connectPromise);
    return connectPromise;
  }

  /** Close and remove a single service connection. */
  async closeService(serviceName: string): Promise<void> {
    const entry = this.connections.get(serviceName);
    if (entry) {
      log.info("disconnecting", { service: serviceName });
      this.connections.delete(serviceName);
      await entry.connection.close();
    }
  }

  /** Close all connections. Best-effort -- won't throw on individual failures. */
  async closeAll(): Promise<void> {
    log.info("closing_all", { count: this.connections.size });
    const entries = Array.from(this.connections.values());
    this.connections.clear();
    await Promise.allSettled(entries.map((e) => e.connection.close()));
  }

  /** Number of active connections. */
  get size(): number {
    return this.connections.size;
  }

  /** Names of all connected services. */
  get serviceNames(): string[] {
    return Array.from(this.connections.keys());
  }

  /**
   * INFRA-01/02: Connect to an HTTP service with circuit breaker and stdio fallback.
   * 1. If circuit is open, skip HTTP and go directly to fallback.
   * 2. If circuit is closed/half-open, attempt HTTP connection.
   * 3. On HTTP failure, record failure in circuit breaker.
   * 4. If fallback is configured, fall back to stdio; otherwise re-throw.
   */
  private async connectHttpWithFallback(
    serviceName: string,
    serviceConfig: HttpService,
  ): Promise<McpConnection> {
    const hasFallback = !!serviceConfig.fallback;
    const attemptHttp = await shouldAttemptHttp(serviceName);

    // Circuit is open -- skip HTTP entirely
    if (!attemptHttp) {
      if (hasFallback) {
        log.warn("fallback_circuit_open", {
          service: serviceName,
          url: serviceConfig.url,
        });
        return this.connectFallback(serviceName, serviceConfig);
      }
      // No fallback configured -- report the open circuit as an error
      throw new ConnectionError(
        `Circuit breaker open for ${serviceName} and no fallback configured`,
        `url: ${serviceConfig.url}`,
      );
    }

    // Attempt HTTP connection
    try {
      const connection = await connectToHttpService(serviceConfig);
      await recordSuccess(serviceName);
      return connection;
    } catch (err) {
      await recordFailure(serviceName);
      const message = err instanceof Error ? err.message : String(err);

      if (hasFallback) {
        log.warn("fallback_http_failed", {
          service: serviceName,
          url: serviceConfig.url,
          error: message,
        });
        return this.connectFallback(serviceName, serviceConfig);
      }

      // No fallback -- propagate the original error
      throw err;
    }
  }

  /**
   * Connect via the stdio fallback defined in an HTTP service config.
   * Constructs a StdioService-compatible object from the fallback fields.
   */
  private async connectFallback(
    serviceName: string,
    serviceConfig: HttpService,
  ): Promise<McpConnection> {
    const fb = serviceConfig.fallback!;
    log.warn("using_stdio_fallback", {
      service: serviceName,
      command: fb.command,
    });
    return connectToService({
      backend: "stdio" as const,
      command: fb.command,
      args: fb.args,
      env: fb.env,
    });
  }

  /**
   * MEM-05: Lightweight health check using listTools as a ping.
   * Returns false if the connection is dead or times out.
   */
  private async isHealthy(conn: McpConnection): Promise<boolean> {
    try {
      await Promise.race([
        conn.client.listTools(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("health check timeout")), this._healthCheckTimeoutMs),
        ),
      ]);
      return true;
    } catch {
      return false;
    }
  }
}
