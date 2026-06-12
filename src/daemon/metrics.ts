/**
 * Prometheus metrics collector for mcp2cli daemon.
 * Exposes request metrics, connection pool state, and system health
 * in Prometheus text exposition format at GET /metrics.
 */
import pkg from "../../package.json" with { type: "json" };

const VERSION = pkg.version;

/** Histogram bucket boundaries for request duration (ms) */
const DURATION_BUCKETS = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000];

interface RequestMetric {
  count: number;
  errorCount: number;
  totalDurationMs: number;
  /** Histogram buckets: count of requests <= bucket boundary */
  buckets: number[];
}

export interface UserMetricSummary {
  userId: string;
  totalRequests: number;
  errorCount: number;
  totalDurationMs: number;
  requests: Array<{
    service: string;
    tool: string;
    count: number;
    errorCount: number;
    totalDurationMs: number;
    avgDurationMs: number;
  }>;
}

/**
 * Centralized metrics collector.
 * Thread-safe for single-threaded Bun runtime.
 */
export class MetricsCollector {
  private readonly requests = new Map<string, RequestMetric>();
  private readonly callerRequests = new Map<string, RequestMetric>();
  private activeRequests = 0;
  private peakActiveRequests = 0;
  private totalRequests = 0;
  private readonly startTime = Date.now();

  /** Record start of a request (increments active count) */
  onRequestStart(): void {
    this.activeRequests++;
    if (this.activeRequests > this.peakActiveRequests) {
      this.peakActiveRequests = this.activeRequests;
    }
  }

  /** Record end of a request with service/tool/status/duration */
  onRequestEnd(
    service: string,
    tool: string,
    success: boolean,
    durationMs: number,
    caller?: string,
  ): void {
    this.activeRequests = Math.max(0, this.activeRequests - 1);
    this.totalRequests++;

    this.recordMetric(this.requests, metricKey(service, tool), success, durationMs);
    if (caller) {
      this.recordMetric(this.callerRequests, metricKey(service, tool, caller), success, durationMs);
    }
  }

  getUserBreakdown(userId: string): UserMetricSummary {
    const requests: UserMetricSummary["requests"] = [];
    let totalRequests = 0;
    let errorCount = 0;
    let totalDurationMs = 0;

    for (const [key, metric] of this.callerRequests) {
      const parsed = parseMetricKey(key);
      if (!parsed.caller || parsed.caller !== userId) continue;
      totalRequests += metric.count;
      errorCount += metric.errorCount;
      totalDurationMs += metric.totalDurationMs;
      requests.push({
        service: parsed.service,
        tool: parsed.tool,
        count: metric.count,
        errorCount: metric.errorCount,
        totalDurationMs: metric.totalDurationMs,
        avgDurationMs: metric.count === 0 ? 0 : Math.round(metric.totalDurationMs / metric.count),
      });
    }

    requests.sort((a, b) => b.count - a.count || a.service.localeCompare(b.service) || a.tool.localeCompare(b.tool));

    return {
      userId,
      totalRequests,
      errorCount,
      totalDurationMs,
      requests,
    };
  }

  private recordMetric(
    map: Map<string, RequestMetric>,
    key: string,
    success: boolean,
    durationMs: number,
  ): void {
    let metric = map.get(key);
    if (!metric) {
      metric = newMetric();
      map.set(key, metric);
    }

    metric.count++;
    if (!success) metric.errorCount++;
    metric.totalDurationMs += durationMs;

    // Update histogram buckets
    for (let i = 0; i < DURATION_BUCKETS.length; i++) {
      if (durationMs <= DURATION_BUCKETS[i]!) {
        metric.buckets[i]!++;
      }
    }
  }

  /** Record an auth failure */
  private authFailures = 0;
  onAuthFailure(): void {
    this.authFailures++;
  }

  /**
   * Render all metrics in Prometheus text exposition format.
   * @param poolSize Current connection pool size
   * @param poolServices List of connected service names
   */
  render(
    poolSize: number,
    poolServices: string[],
    opts: { includeCallerMetrics?: boolean } = {},
  ): string {
    const lines: string[] = [];

    // -- Process metrics --
    const mem = process.memoryUsage();
    lines.push("# HELP mcp2cli_process_uptime_seconds Daemon uptime in seconds");
    lines.push("# TYPE mcp2cli_process_uptime_seconds gauge");
    lines.push(`mcp2cli_process_uptime_seconds ${((Date.now() - this.startTime) / 1000).toFixed(1)}`);

    lines.push("# HELP mcp2cli_process_memory_rss_bytes Resident set size in bytes");
    lines.push("# TYPE mcp2cli_process_memory_rss_bytes gauge");
    lines.push(`mcp2cli_process_memory_rss_bytes ${mem.rss}`);

    lines.push("# HELP mcp2cli_process_memory_heap_used_bytes V8 heap used in bytes");
    lines.push("# TYPE mcp2cli_process_memory_heap_used_bytes gauge");
    lines.push(`mcp2cli_process_memory_heap_used_bytes ${mem.heapUsed}`);

    lines.push("# HELP mcp2cli_process_memory_heap_total_bytes V8 heap total in bytes");
    lines.push("# TYPE mcp2cli_process_memory_heap_total_bytes gauge");
    lines.push(`mcp2cli_process_memory_heap_total_bytes ${mem.heapTotal}`);

    // -- Connection pool metrics --
    lines.push("# HELP mcp2cli_pool_connections_active Current active connections");
    lines.push("# TYPE mcp2cli_pool_connections_active gauge");
    lines.push(`mcp2cli_pool_connections_active ${poolSize}`);

    lines.push("# HELP mcp2cli_pool_services Connected service names");
    lines.push("# TYPE mcp2cli_pool_services gauge");
    for (const svc of poolServices) {
      lines.push(`mcp2cli_pool_services{service="${svc}"} 1`);
    }

    // -- Request metrics --
    lines.push("# HELP mcp2cli_requests_active Currently in-flight requests");
    lines.push("# TYPE mcp2cli_requests_active gauge");
    lines.push(`mcp2cli_requests_active ${this.activeRequests}`);

    lines.push("# HELP mcp2cli_requests_active_peak Peak concurrent requests since start");
    lines.push("# TYPE mcp2cli_requests_active_peak gauge");
    lines.push(`mcp2cli_requests_active_peak ${this.peakActiveRequests}`);

    lines.push("# HELP mcp2cli_requests_total Total requests by service and tool");
    lines.push("# TYPE mcp2cli_requests_total counter");
    lines.push("# HELP mcp2cli_requests_errors_total Total failed requests");
    lines.push("# TYPE mcp2cli_requests_errors_total counter");
    lines.push("# HELP mcp2cli_requests_duration_ms_sum Total request duration in ms");
    lines.push("# TYPE mcp2cli_requests_duration_ms_sum counter");

    for (const [key, metric] of this.requests) {
      const { service, tool } = parseMetricKey(key);
      const labels = `service="${escapeLabelValue(service)}",tool="${escapeLabelValue(tool)}"`;
      lines.push(`mcp2cli_requests_total{${labels}} ${metric.count}`);
      lines.push(`mcp2cli_requests_errors_total{${labels}} ${metric.errorCount}`);
      lines.push(`mcp2cli_requests_duration_ms_sum{${labels}} ${metric.totalDurationMs.toFixed(0)}`);
    }

    if (opts.includeCallerMetrics) {
      for (const [key, metric] of this.callerRequests) {
        const { service, tool, caller } = parseMetricKey(key);
        const labels = `service="${escapeLabelValue(service)}",tool="${escapeLabelValue(tool)}",caller="${escapeLabelValue(caller ?? "unknown")}"`;
        lines.push(`mcp2cli_requests_total{${labels}} ${metric.count}`);
        lines.push(`mcp2cli_requests_errors_total{${labels}} ${metric.errorCount}`);
        lines.push(`mcp2cli_requests_duration_ms_sum{${labels}} ${metric.totalDurationMs.toFixed(0)}`);
      }
    }

    // -- Request duration histogram --
    lines.push("# HELP mcp2cli_request_duration_ms Request duration histogram");
    lines.push("# TYPE mcp2cli_request_duration_ms histogram");
    for (const [key, metric] of this.requests) {
      const { service, tool } = parseMetricKey(key);
      const labels = `service="${escapeLabelValue(service)}",tool="${escapeLabelValue(tool)}"`;
      for (let i = 0; i < DURATION_BUCKETS.length; i++) {
        lines.push(`mcp2cli_request_duration_ms_bucket{${labels},le="${DURATION_BUCKETS[i]}"} ${metric.buckets[i]}`);
      }
      lines.push(`mcp2cli_request_duration_ms_bucket{${labels},le="+Inf"} ${metric.count}`);
      lines.push(`mcp2cli_request_duration_ms_count{${labels}} ${metric.count}`);
      lines.push(`mcp2cli_request_duration_ms_sum{${labels}} ${metric.totalDurationMs.toFixed(0)}`);
    }
    if (opts.includeCallerMetrics) {
      for (const [key, metric] of this.callerRequests) {
        const { service, tool, caller } = parseMetricKey(key);
        const labels = `service="${escapeLabelValue(service)}",tool="${escapeLabelValue(tool)}",caller="${escapeLabelValue(caller ?? "unknown")}"`;
        for (let i = 0; i < DURATION_BUCKETS.length; i++) {
          lines.push(`mcp2cli_request_duration_ms_bucket{${labels},le="${DURATION_BUCKETS[i]}"} ${metric.buckets[i]}`);
        }
        lines.push(`mcp2cli_request_duration_ms_bucket{${labels},le="+Inf"} ${metric.count}`);
        lines.push(`mcp2cli_request_duration_ms_count{${labels}} ${metric.count}`);
        lines.push(`mcp2cli_request_duration_ms_sum{${labels}} ${metric.totalDurationMs.toFixed(0)}`);
      }
    }

    // -- Auth metrics --
    lines.push("# HELP mcp2cli_auth_failures_total Total auth failures");
    lines.push("# TYPE mcp2cli_auth_failures_total counter");
    lines.push(`mcp2cli_auth_failures_total ${this.authFailures}`);

    // -- Info metric --
    lines.push("# HELP mcp2cli_info Build info");
    lines.push("# TYPE mcp2cli_info gauge");
    lines.push(`mcp2cli_info{version="${VERSION}"} 1`);

    lines.push("");
    return lines.join("\n");
  }

}

function newMetric(): RequestMetric {
  return {
    count: 0,
    errorCount: 0,
    totalDurationMs: 0,
    buckets: new Array(DURATION_BUCKETS.length).fill(0) as number[],
  };
}

function metricKey(service: string, tool: string, caller?: string): string {
  return JSON.stringify(caller ? [service, tool, caller] : [service, tool]);
}

function parseMetricKey(key: string): { service: string; tool: string; caller?: string } {
  const parsed = JSON.parse(key) as [string, string, string?];
  return { service: parsed[0], tool: parsed[1], caller: parsed[2] };
}

function escapeLabelValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/"/g, '\\"');
}
