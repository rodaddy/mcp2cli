import type { Transport, TransportSendOptions } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import type { ConnectionOptions } from "./types.ts";
import { parseJsonRpcLine } from "./filter.ts";
import { ConnectionError } from "./errors.ts";
import { createLogger } from "../logger/index.ts";
import { mkdirSync, appendFileSync } from "node:fs";
import { join } from "node:path";

const log = createLogger("transport");

/**
 * Resolve the directory for stderr log files.
 * Uses MCP2CLI_LOG_DIR env var or defaults to ~/.cache/mcp2cli/logs/.
 */
function getStderrLogDir(): string {
  if (process.env.MCP2CLI_LOG_DIR) return process.env.MCP2CLI_LOG_DIR;
  const home = process.env.HOME ?? "/tmp";
  return join(home, ".cache", "mcp2cli", "logs");
}

/**
 * Sanitize a command string into a safe filename component.
 */
function sanitizeForFilename(cmd: string): string {
  return cmd.replace(/[^a-zA-Z0-9_.-]/g, "_").slice(0, 64);
}

/**
 * Expand ${VAR} references in a string using the provided env map.
 * Supports ${VAR} syntax only (not $VAR without braces).
 */
function expandEnvVars(s: string, env: Record<string, string | undefined>): string {
  return s.replace(/\$\{([^}]+)\}/g, (_match, name: string) => env[name] ?? "");
}

/** Maximum line buffer size (1MB). Prevents unbounded growth from servers that emit data without newlines. */
const MAX_LINE_BUFFER = 1024 * 1024;

/**
 * MCP transport wrapping Bun.spawn for stdio-based MCP servers.
 * Spawns a child process, filters non-JSON-RPC stdout noise,
 * and implements the SDK Transport interface.
 */
export class McpTransport implements Transport {
  private proc: ReturnType<typeof Bun.spawn> | null = null;
  private readonly options: ConnectionOptions;
  private closed = false;
  /** MEM-01: stored readers so close() can cancel dangling reads */
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private stderrReader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  /** MEM-03: signals fire-and-forget tasks to exit cleanly */
  private abortController = new AbortController();
  /** LOG-04: path to stderr log file for this child process */
  private stderrLogPath: string | null = null;

  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;
  sessionId?: string;

  constructor(options: ConnectionOptions) {
    this.options = options;
  }

  async start(): Promise<void> {
    // LOG-04: set up stderr capture to a log file
    let stderrSink: "inherit" | "pipe" = "pipe";
    try {
      const logDir = getStderrLogDir();
      mkdirSync(logDir, { recursive: true });
      const filename = `${sanitizeForFilename(this.options.command)}-stderr.log`;
      this.stderrLogPath = join(logDir, filename);
    } catch {
      // If we can't set up the log dir, fall back to inherit
      stderrSink = "inherit";
    }

    try {
      // Merge env and expand ${VAR} references in args (Bun.spawn doesn't do shell expansion)
      const mergedEnv = { ...process.env, ...this.options.env };
      const expandedArgs = this.options.args.map((a) => expandEnvVars(a, mergedEnv));
      this.proc = Bun.spawn([this.options.command, ...expandedArgs], {
        stdin: "pipe",
        stdout: "pipe",
        stderr: stderrSink,
        env: mergedEnv,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new ConnectionError(
        `Failed to spawn process: ${message}`,
        `command: ${this.options.command}`,
      );
    }

    const proc = this.proc;

    // LOG-04: pipe stderr to log file if we have a path
    if (this.stderrLogPath && stderrSink === "pipe") {
      this.captureStderr(proc);
    }

    // Fire-and-forget: read stdout, filter, dispatch JSON-RPC messages
    this.readStdout(proc);

    // Fire-and-forget: monitor process exit
    this.monitorExit(proc);
  }

  /** LOG-04: Read child stderr and append to log file */
  private async captureStderr(proc: NonNullable<typeof this.proc>): Promise<void> {
    const stderr = proc.stderr;
    if (!stderr || typeof stderr === "number" || !this.stderrLogPath) return;

    const logPath = this.stderrLogPath;
    const decoder = new TextDecoder();

    try {
      const stderrReader = (stderr as ReadableStream<Uint8Array>).getReader();
      this.stderrReader = stderrReader as typeof this.stderrReader;
      while (!this.abortController.signal.aborted) {
        const { done, value } = await stderrReader.read();
        if (done) break;
        const text = decoder.decode(value, { stream: true });
        try {
          appendFileSync(logPath, text);
        } catch {
          // Best-effort -- don't crash if log write fails
        }
      }
    } catch {
      // Suppress read errors during shutdown
    } finally {
      this.stderrReader = null;
    }
  }

  private async readStdout(proc: NonNullable<typeof this.proc>): Promise<void> {
    const stdout = proc.stdout;
    if (!stdout || typeof stdout === "number") return;

    const decoder = new TextDecoder();
    let buffer = "";

    try {
      // MEM-01: store reader so close() can cancel it
      const reader = (stdout as ReadableStream<Uint8Array>).getReader();
      this.reader = reader as typeof this.reader;

      while (!this.abortController.signal.aborted) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Guard against unbounded buffer growth (server sending data without newlines)
        if (buffer.length > MAX_LINE_BUFFER) {
          const lastNewline = buffer.lastIndexOf("\n");
          if (lastNewline !== -1) {
            // Keep everything after the last newline (partial line)
            buffer = buffer.slice(lastNewline + 1);
          } else {
            // No newline at all -- discard entire buffer
            buffer = "";
          }
          this.onerror?.(new Error(
            `stdout line buffer exceeded ${MAX_LINE_BUFFER} bytes, discarded overflow`,
          ));
        }

        let newlineIndex: number;
        while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, newlineIndex);
          buffer = buffer.slice(newlineIndex + 1);

          const parsed = parseJsonRpcLine(line);
          if (parsed) {
            this.onmessage?.(parsed);
          } else if (process.env.MCP2CLI_DEBUG === "1" && line.trim().length > 0) {
            process.stderr.write(`[mcp2cli:transport] discarded: ${line}\n`);
          }
        }
      }
    } catch (err) {
      // MEM-03: suppress errors when transport is closing
      if (!this.closed && !this.abortController.signal.aborted) {
        const message = err instanceof Error ? err.message : String(err);
        log.error("read_error", { command: this.options.command, error: message });
        this.onerror?.(new Error(`stdout read error: ${message}`));
      }
    } finally {
      // MEM-01: clear reader reference
      this.reader = null;
    }
  }

  private async monitorExit(proc: NonNullable<typeof this.proc>): Promise<void> {
    try {
      const exitCode = await proc.exited;
      // MEM-03: only report unexpected exits when transport is still active
      if (!this.closed && !this.abortController.signal.aborted) {
        log.warn("process_exited", { exitCode, command: this.options.command });
        this.onerror?.(new Error(`Process exited unexpectedly with code ${exitCode}`));
        this.onclose?.();
      }
    } catch {
      // Process reference may be invalid if spawn failed
    }
  }

  async send(message: JSONRPCMessage, _options?: TransportSendOptions): Promise<void> {
    if (!this.proc || !this.proc.stdin) {
      throw new ConnectionError(
        "Cannot send message: process not started or stdin closed",
        `command: ${this.options.command}`,
      );
    }

    const stdin = this.proc.stdin;
    if (typeof stdin === "number") {
      throw new ConnectionError(
        "Cannot send message: stdin is a file descriptor, not a pipe",
        `command: ${this.options.command}`,
      );
    }

    const serialized = JSON.stringify(message) + "\n";
    try {
      stdin.write(serialized);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new ConnectionError(
        `Failed to write to process stdin: ${msg}`,
        `command: ${this.options.command}`,
      );
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;

    // MEM-03: signal fire-and-forget tasks to stop
    this.abortController.abort();

    // MEM-01: cancel active readers to unblock dangling readStdout()/captureStderr()
    await Promise.all([
      this.reader?.cancel().catch(() => {}),
      this.stderrReader?.cancel().catch(() => {}),
    ]);

    if (!this.proc) {
      this.onclose?.();
      return;
    }

    const proc = this.proc;

    // Step 1: Close stdin to signal EOF
    try {
      const stdin = proc.stdin;
      if (stdin && typeof stdin !== "number") {
        stdin.end();
      }
    } catch {
      // stdin may already be closed
    }

    // Step 2: Wait for graceful exit (2s timeout)
    const exited = await Promise.race([
      proc.exited.then(() => true),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), 2000)),
    ]);

    if (!exited) {
      // Step 3: SIGTERM
      try {
        proc.kill("SIGTERM");
      } catch {
        // May already be dead
      }

      // Step 4: Wait again (2s)
      const terminated = await Promise.race([
        proc.exited.then(() => true),
        new Promise<false>((resolve) => setTimeout(() => resolve(false), 2000)),
      ]);

      if (!terminated) {
        // Step 5: SIGKILL
        try {
          proc.kill("SIGKILL");
        } catch {
          // Already dead
        }
      }
    }

    log.info("disconnected", { command: this.options.command });
    this.onclose?.();
  }
}
