import { resolve } from "path";

export interface CliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  success: boolean;
}

/**
 * Spawn the CLI entry point via Bun.spawnSync and capture output.
 * Uses Bun.spawnSync (NOT Bun.spawn) per research pitfall #1.
 */
export function runCli(
  args: string[] = [],
  env?: Record<string, string>,
): CliResult {
  const projectRoot = resolve(import.meta.dir, "../..");

  const proc = Bun.spawnSync(["bun", "run", "src/cli/index.ts", ...args], {
    cwd: projectRoot,
    env: {
      ...process.env,
      MCP2CLI_NO_DAEMON: "1",
      MCP2CLI_REMOTE_URL: "",
      MCP_HOST: "",
      MCP2CLI_PID_FILE: "",
      MCP2CLI_SOCKET_PATH: "",
      MCP2CLI_TOKENS_FILE: "",
      MCP2CLI_AUTH_TOKEN: "",
      MCP_TOKEN: "",
      ...env,
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  return {
    stdout: proc.stdout.toString().trim(),
    stderr: proc.stderr.toString().trim(),
    exitCode: proc.exitCode,
    success: proc.success,
  };
}
