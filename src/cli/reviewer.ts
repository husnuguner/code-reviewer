/**
 * The `reviewer` root command: a registry of subcommands (`review` default, `init`, `comment`). `review`
 * holds no hosting token; `comment` builds no model.
 * @packageDocumentation
 */

import { type Command } from "commander";

import { LOG_FORMATS, LOG_LEVELS } from "../providers/logging/log-settings";

import {
  type CliCommand,
  type Invocation,
  bind,
  choice,
  commandLine,
  parseCommandLine,
  runCommand,
} from "./command-line";
import { COMMENT } from "./commands/comment/command";
import { INIT } from "./commands/init/command";
import { REVIEW } from "./commands/review/command";

export { type Invocation, UsageError, isInvocationOf } from "./command-line";

/** What a command line that names no command means. */
const DEFAULT_COMMAND: CliCommand<unknown> = REVIEW;

/** Every command, in `--help` order. */
const COMMANDS: readonly CliCommand<unknown>[] = [REVIEW, INIT, COMMENT];

/** Attaches one command to the root so its parse hands back a bound invocation. */
function register(
  program: Command,
  command: CliCommand<unknown>,
  onParsed: (invocation: Invocation) => void,
): void {
  program.addCommand(
    command.build((arguments_) => {
      onParsed(bind(command, arguments_));
    }),
    { isDefault: command === DEFAULT_COMMAND },
  );
}

/**
 * Builds the command line as a Commander `Command`.
 *
 * @param onParsed - Called once, by whichever subcommand the arguments named.
 * @remarks Exposed so `--help` output can be tested. The logging flags live on the root.
 */
export function buildProgram(onParsed: (invocation: Invocation) => void): Command {
  const program = loggingOptions(
    commandLine(
      "reviewer",
      "Review a change set with a language model and report anchored findings, or post a " +
        `run's findings to a pull request. \`${DEFAULT_COMMAND.name}\` is the default command.`,
    ),
  );
  for (const command of COMMANDS) register(program, command, onParsed);
  return program;
}

/** The root logging flags: `-v`, `-q`, `--log-level`, `--log-format`, `--no-color`. */
function loggingOptions(program: Command): Command {
  return program
    .option(
      "-v, --verbose",
      "Debug logging: DEBUG-level detail for reviewer.* (per-file decisions, skill matches), with local clock times (14:32:07.412) and component names.",
      false,
    )
    .option(
      "-q, --quiet",
      "Warnings and errors only. The report itself is unaffected: it goes to stdout.",
      false,
    )
    .option(
      "--log-level <level>",
      `How much reaches stderr: ${LOG_LEVELS.join(", ")}. Outranks -v and -q; falls back to REVIEWER_LOG_LEVEL.`,
      choice(LOG_LEVELS, { label: "levels", caseInsensitive: true }),
    )
    .option(
      "--log-format <format>",
      `Shape of a log line: ${LOG_FORMATS.join(", ")}. 'auto' prints workflow commands on a GitHub runner and plain text elsewhere.`,
      choice(LOG_FORMATS, { label: "log formats", caseInsensitive: true }),
      "auto",
    )
    .option("--no-color", "Never colour log lines. NO_COLOR in the environment does the same.");
}

/**
 * Parses `argv` (without executable and script) into a command bound to its arguments.
 *
 * @throws {@link UsageError} on a bad command line.
 */
export function parseArguments(argv: readonly string[]): Invocation {
  // A holder rather than a `let`: the assignment happens inside a callback flow analysis does not follow.
  const result: { invocation: Invocation | null } = { invocation: null };
  const program = buildProgram((invocation) => {
    result.invocation = invocation;
  });
  parseCommandLine(program, argv);
  if (result.invocation === null) throw new Error("the command line parsed but named no command");
  return result.invocation;
}

/**
 * The process entry: parses, runs, and turns operator errors into plain messages and exit codes.
 *
 * @returns The exit code.
 */
export async function main(argv: readonly string[]): Promise<number> {
  return runCommand(() => parseArguments(argv).run(), {
    isOperatorError: (error) => COMMANDS.some((command) => command.isOperatorError(error)),
  });
}
