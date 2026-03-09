import type { CliError } from "../types/index.ts";

export type { CliError };

/**
 * Print a structured JSON error to stdout.
 * All machine-readable output goes to stdout -- agents parse stdout, not stderr.
 */
export function printError(error: CliError): void {
  console.log(JSON.stringify(error));
}

/**
 * Print a structured JSON error and exit with the given code.
 * Uses process.exit() for the "never" return type guarantee.
 */
export function exitWithError(error: CliError, exitCode: number): never {
  printError(error);
  process.exit(exitCode);
}
