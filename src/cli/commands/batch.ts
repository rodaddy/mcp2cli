/**
 * Batch command: read NDJSON tool call specs from stdin, execute them,
 * and output results as NDJSON. Supports sequential and parallel execution.
 */
import { callViaDaemon } from "../../process/index.ts";
import { createLogger } from "../../logger/index.ts";

const log = createLogger("batch");

/** A single tool call spec from stdin. */
export interface BatchCallSpec {
  service: string;
  tool: string;
  params: Record<string, unknown>;
}

/** A single result line written to stdout. */
export interface BatchResult {
  service: string;
  tool: string;
  success: boolean;
  result?: unknown;
  error?: { code: string; message: string };
}

/**
 * Parse NDJSON lines into BatchCallSpec objects.
 * Skips blank lines. Returns parse errors inline so they don't abort the batch.
 */
export function parseBatchInput(input: string): Array<{ spec?: BatchCallSpec; error?: string; line: number }> {
  const lines = input.split("\n");
  const results: Array<{ spec?: BatchCallSpec; error?: string; line: number }> = [];

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i]!.trim();
    if (trimmed === "") continue;

    try {
      const parsed = JSON.parse(trimmed);
      if (!parsed.service || !parsed.tool) {
        results.push({ error: `Missing required fields "service" and/or "tool"`, line: i + 1 });
        continue;
      }
      results.push({
        spec: {
          service: parsed.service,
          tool: parsed.tool,
          params: parsed.params ?? {},
        },
        line: i + 1,
      });
    } catch {
      results.push({ error: `Invalid JSON on line ${i + 1}`, line: i + 1 });
    }
  }

  return results;
}

/**
 * Execute a single batch call via the daemon.
 * Returns a BatchResult -- never throws.
 */
async function executeSingle(spec: BatchCallSpec): Promise<BatchResult> {
  try {
    const response = await callViaDaemon({
      service: spec.service,
      tool: spec.tool,
      params: spec.params,
    });

    if (response.success) {
      return {
        service: spec.service,
        tool: spec.tool,
        success: true,
        result: response.result,
      };
    }

    return {
      service: spec.service,
      tool: spec.tool,
      success: false,
      error: response.error,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      service: spec.service,
      tool: spec.tool,
      success: false,
      error: { code: "INTERNAL_ERROR", message },
    };
  }
}

/**
 * Execute batch calls sequentially, writing each result to stdout as NDJSON.
 */
async function executeSequential(specs: BatchCallSpec[]): Promise<void> {
  for (const spec of specs) {
    const result = await executeSingle(spec);
    console.log(JSON.stringify(result));
  }
}

/**
 * Execute batch calls in parallel, writing results to stdout as NDJSON.
 * Order of output matches order of input.
 */
async function executeParallel(specs: BatchCallSpec[]): Promise<void> {
  const results = await Promise.all(specs.map(executeSingle));
  for (const result of results) {
    console.log(JSON.stringify(result));
  }
}

/**
 * Read all stdin until EOF. Returns the full input as a string.
 */
async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf-8");
}

/**
 * Handle the `mcp2cli batch` command.
 * Reads NDJSON from stdin, executes calls, outputs results as NDJSON.
 */
export async function handleBatch(args: string[]): Promise<void> {
  const parallel = args.includes("--parallel");

  log.info("batch_start", { parallel });

  const input = await readStdin();

  if (input.trim() === "") {
    log.info("batch_empty_input");
    return;
  }

  const parsed = parseBatchInput(input);
  const specs: BatchCallSpec[] = [];

  // Emit parse errors as result lines, collect valid specs
  for (const entry of parsed) {
    if (entry.error) {
      const errorResult: BatchResult = {
        service: "unknown",
        tool: "unknown",
        success: false,
        error: { code: "INPUT_VALIDATION_ERROR", message: entry.error },
      };
      console.log(JSON.stringify(errorResult));
      continue;
    }
    if (entry.spec) {
      specs.push(entry.spec);
    }
  }

  if (specs.length === 0) {
    log.info("batch_no_valid_specs");
    return;
  }

  log.info("batch_executing", { count: specs.length, parallel });

  if (parallel) {
    await executeParallel(specs);
  } else {
    await executeSequential(specs);
  }

  log.info("batch_complete", { count: specs.length });
}
