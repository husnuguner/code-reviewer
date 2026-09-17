/**
 * What every executable in this package shares: how a command line is built,
 * how its errors become exit codes, and what those codes mean.
 *
 * Two executables (`reviewer`, `review-comment`) used to carry a copy of this
 * each. A copy is a promise to keep two things the same by hand, and the
 * exit-code contract is exactly the kind of thing a caller (a workflow, a
 * shell script) depends on without reading the source -- so it lives here
 * once, and the executables state only what differs: their flags, and which
 * of their errors are the operator's to fix.
 *
 * Exit codes: `0` success · `1` usage error · `2` a problem the operator can
 * fix (named in one `error:` line) · anything else is the command's own to
 * define · an unexpected error is never caught here, so its stack trace
 * survives to be read.
 */

import { Command, CommanderError } from "commander";

export const USAGE_EXIT_CODE = 1;
export const OPERATOR_EXIT_CODE = 2;

/** A usage error, surfaced as a message and exit code instead of a thrown `CommanderError`. */
export class UsageError extends Error {
  override readonly name = "UsageError";

  constructor(
    message: string,
    readonly exitCode: number = USAGE_EXIT_CODE,
  ) {
    super(message);
  }
}

/**
 * A problem the operator can fix: a file that is not there, a token that is
 * not set, a refusal from a service. It gets one plain `error:` line and
 * exit 2, never a stack trace -- the stack would point at our code, and the
 * fix is in theirs.
 */
export class OperatorError extends Error {
  override readonly name = "OperatorError";
}

/**
 * A `Command` with the conventions every executable here follows: errors are
 * thrown rather than exiting the process (so `main` decides the exit code),
 * and everything Commander prints goes to stderr, leaving stdout to the
 * command's own output -- which for `reviewer` is a machine-readable stream.
 */
export function commandLine(name: string, description: string): Command {
  return new Command(name)
    .description(description)
    .allowExcessArguments(false)
    .exitOverride()
    .configureOutput({ writeErr: (text) => process.stderr.write(text) });
}

/**
 * Parse `argv` (without the executable and script), turning Commander's
 * exception into a `UsageError` that carries the exit code Commander chose:
 * `1` for a bad flag, `0` for `--help` and `--version`, which are not errors.
 */
export function parseCommandLine(program: Command, argv: readonly string[]): void {
  try {
    program.parse([...argv], { from: "user" });
  } catch (error) {
    if (error instanceof CommanderError) throw new UsageError(error.message, error.exitCode);
    throw error;
  }
}

export interface RunCommandOptions {
  /**
   * Which of this command's own error types are the operator's to fix, on top
   * of `OperatorError`. A `reviewer` run names its config, catalogue and git
   * errors here; `review-comment` names the hosting system's refusals.
   */
  readonly isOperatorError?: (error: unknown) => boolean;
}

/**
 * Run a command body and turn its errors into an exit code.
 *
 * Three kinds of failure, three treatments, decided once:
 *
 * - `UsageError` -- the message (unless the code is 0: `--help` is not an
 *   error) and Commander's exit code.
 * - An operator's error -- one `error:` line and exit 2.
 * - Anything else -- rethrown. It is ours to fix, and the stack trace is
 *   the evidence.
 */
export async function runCommand(
  body: () => Promise<number> | number,
  options: RunCommandOptions = {},
): Promise<number> {
  try {
    return await body();
  } catch (error) {
    if (error instanceof UsageError) {
      if (error.exitCode !== 0) process.stderr.write(`${error.message}\n`);
      return error.exitCode;
    }
    if (error instanceof OperatorError || options.isOperatorError?.(error) === true) {
      process.stderr.write(`error: ${(error as Error).message}\n`);
      return OPERATOR_EXIT_CODE;
    }
    throw error;
  }
}
