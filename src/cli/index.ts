#!/usr/bin/env bun

import { printHelp, getVersion } from "./help.ts";
import { printError } from "./errors.ts";
import { handleServices } from "./commands/services.ts";
import { handleSchema } from "./commands/schema.ts";
import { handleServiceHelp } from "./commands/service-help.ts";
import { handleToolCall } from "./commands/tool-call.ts";
import { handleDaemonStop, handleDaemonStatus } from "./commands/daemon.ts";
import { handleBootstrap } from "./commands/bootstrap.ts";
import { handleGenerateSkills } from "./commands/generate-skills.ts";
import { ConfigError } from "../config/index.ts";
import { ConnectionError } from "../connection/index.ts";
import { ToolError } from "../invocation/errors.ts";
import { EXIT_CODES } from "../types/index.ts";
import type { CommandHandler, CliError, ErrorCode } from "../types/index.ts";

/**
 * Dispatch daemon subcommands (stop, status).
 */
const handleDaemonDispatch: CommandHandler = async (args: string[]) => {
  const subcommand = args[0];
  switch (subcommand) {
    case "stop":
      await handleDaemonStop(args.slice(1));
      break;
    case "status":
      await handleDaemonStatus(args.slice(1));
      break;
    default:
      console.log("Usage: mcp2cli daemon <stop|status>");
      break;
  }
};

/**
 * Static command registry. Each special command maps to its handler.
 * service.tool dispatch is handled in the default branch.
 */
const COMMANDS: Record<string, CommandHandler> = {
  services: handleServices,
  schema: handleSchema,
  daemon: handleDaemonDispatch,
  bootstrap: handleBootstrap,
  "generate-skills": handleGenerateSkills,
};

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const firstArg = args[0];

  // No args or help flag -- print help and exit 0
  if (
    !firstArg ||
    firstArg === "--help" ||
    firstArg === "-h" ||
    firstArg === "--help-format=ai"
  ) {
    printHelp(args);
    process.exitCode = EXIT_CODES.SUCCESS;
    return;
  }

  // Version flag
  if (firstArg === "--version") {
    console.log(getVersion());
    process.exitCode = EXIT_CODES.SUCCESS;
    return;
  }

  // Check command registry
  const handler = COMMANDS[firstArg];
  if (handler) {
    await handler(args.slice(1));
    // Schema/generate-skills direct path needs force exit (MCP transport async ops)
    if ((firstArg === "schema" || firstArg === "generate-skills") && process.env.MCP2CLI_NO_DAEMON) {
      process.exit(process.exitCode ?? 0);
    }
    return;
  }

  // Service-level help: mcp2cli <service> --help
  if (args[1] === "--help" || args[1] === "-h" || args[1] === "--help-format=ai") {
    await handleServiceHelp(firstArg, args.slice(1));
    // Direct path needs force exit (MCP transport async ops)
    if (process.env.MCP2CLI_NO_DAEMON) {
      process.exit(process.exitCode ?? 0);
    }
    return;
  }

  // Not a built-in command -- try as service.tool invocation
  await handleToolCall(args);

  // Direct path needs force exit -- MCP transport leaves async operations
  // (stdout reader, process monitor) that keep the event loop alive.
  // Daemon path has no dangling async ops, so process.exitCode suffices.
  if (process.env.MCP2CLI_NO_DAEMON) {
    process.exit(process.exitCode ?? 0);
  }
}

/**
 * Convert a structured app error into a CliError, print it, and exit.
 * Shared by all known error branches to eliminate duplication.
 */
function handleAppError(
  err: { code: ErrorCode; message: string; reason?: string },
  exitCode: number,
): never {
  const cliError: CliError = { error: true, code: err.code, message: err.message };
  if (err.reason) cliError.reason = err.reason;
  printError(cliError);
  process.exit(exitCode);
}

// Daemon mode: if MCP2CLI_DAEMON=1, start the daemon server instead of CLI
if (process.env.MCP2CLI_DAEMON === "1") {
  import("../daemon/index.ts").then((m) => m.startDaemon());
} else {
  main().catch((err: unknown) => {
    if (err instanceof ToolError) {
      handleAppError(err, EXIT_CODES.TOOL_ERROR);
    }
    if (err instanceof ConfigError) {
      handleAppError(err, EXIT_CODES.VALIDATION);
    }
    if (err instanceof ConnectionError) {
      handleAppError(err, EXIT_CODES.CONNECTION);
    }
    printError({
      error: true,
      code: "INTERNAL_ERROR",
      message: err instanceof Error ? err.message : String(err),
    });
    process.exit(EXIT_CODES.INTERNAL);
  });
}
