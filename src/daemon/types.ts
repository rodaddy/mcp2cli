/**
 * Shared types for daemon IPC protocol.
 * Used by both daemon server (src/daemon/) and process client (src/process/).
 */
import type { ErrorCode } from "../types/index.ts";

/** Paths to daemon runtime files (PID file and Unix socket) */
export interface DaemonPaths {
  pidFile: string;
  socketPath: string;
}

/** Request body for POST /call -- invoke a tool on a service */
export interface DaemonCallRequest {
  service: string;
  tool: string;
  params: Record<string, unknown>;
}

/** Request body for POST /list-tools -- list available tools for a service */
export interface DaemonListToolsRequest {
  service: string;
}

/** Request body for POST /schema -- get full schema for a service.tool */
export interface DaemonSchemaRequest {
  service: string;
  tool: string;
}

/** Successful daemon response envelope */
export interface DaemonCallResponse {
  success: true;
  result: unknown;
}

/** Error daemon response envelope with typed error code */
export interface DaemonErrorResponse {
  success: false;
  error: {
    code: ErrorCode;
    message: string;
    reason?: string;
  };
}

/** Discriminated union of all daemon responses */
export type DaemonResponse = DaemonCallResponse | DaemonErrorResponse;

/** Unix domain socket listen config */
export interface UnixListenConfig {
  mode: "unix";
  socketPath: string;
}

/** TCP network listen config */
export interface TcpListenConfig {
  mode: "tcp";
  hostname: string;
  port: number;
}

/** Discriminated union for daemon listen mode */
export type DaemonListenConfig = UnixListenConfig | TcpListenConfig;
