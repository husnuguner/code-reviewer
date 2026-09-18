/**
 * The `reviewer` command: one executable, five subcommands.
 *
 *   reviewer [review] --base X [--branch Y] ...   review a change set (default)
 *   reviewer init | projects | add <name>         the catalogue
 *   reviewer comment --findings F --repo R --pr N post a run's findings
 *
 * `review` and `comment` are two commands of one executable, never one run:
 * the review reads untrusted diff text into a model and holds no hosting
 * token; `comment` holds the token and builds no model. Each has its own
 * composition root, and the workflow that uses them gives each its own job
 * and permissions (see README, "Why the reviewer cannot post").
 *
 * The commands are registered, not named: this module knows the list and
 * nothing of what any entry does. A parse yields an `Invocation` -- a command
 * already bound to its arguments -- and running the command line is running
 * that. Adding a command is writing its module and adding it to `COMMANDS`.
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
import { ADD } from "./commands/add/command";
import { COMMENT } from "./commands/comment/command";
import { INIT } from "./commands/init/command";
import { PROJECTS } from "./commands/projects/command";
import { REVIEW } from "./commands/review/command";

export { type Invocation, UsageError, isInvocationOf } from "./command-line";

/** What a command line that names no command means: `reviewer --base main` reviews. */
const DEFAULT_COMMAND: CliCommand<unknown> = REVIEW;

/**
 * Every command, in the order `--help` lists them.
 *
 * The list holds them as `CliCommand<unknown>`: what each one's arguments are
 * is its own business, settled between its `build` and its `run` when the
 * invocation is bound. A caller that needs the arguments back asks the
 * command itself (`invokes`).
 */
const COMMANDS: readonly CliCommand<unknown>[] = [REVIEW, INIT, PROJECTS, ADD, COMMENT];

/** Attach one command to the root, so that its parse hands back a bound invocation. */
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
 * The command line as a `Command`; exposed so `--help` output can be tested.
 *
 * `onParsed` is called once, by whichever subcommand the arguments named.
 * The logging flags live here on the root, so every command takes them in
 * the same place and reads them through its globals: how loud a run is has
 * nothing to do with which command it runs.
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

/**
 * The flags that decide what reaches stderr.
 *
 * Spelled the way the rest of a user's toolbox spells them, so none of it
 * has to be learned: `-v`/`-q` for the two directions, `--log-level` when
 * neither shorthand is exact enough, `--no-color` alongside the `NO_COLOR`
 * every other tool already honours. Logs never touch stdout, so none of
 * these can affect what a pipe downstream reads -- `--format` is that
 * decision, and it is deliberately a different knob.
 */
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

/** Parse `argv` (without the executable and script) into a command bound to its arguments. */
export function parseArguments(argv: readonly string[]): Invocation {
  // A holder rather than a `let`: the assignment happens inside a callback,
  // which the type checker's flow analysis does not follow.
  const result: { invocation: Invocation | null } = { invocation: null };
  const program = buildProgram((invocation) => {
    result.invocation = invocation;
  });
  parseCommandLine(program, argv);
  // A parse that neither threw nor ran a subcommand's action cannot happen:
  // every path through Commander ends in one or the other.
  if (result.invocation === null) throw new Error("the command line parsed but named no command");
  return result.invocation;
}

/**
 * The process entry: parse, run what was parsed, and turn operator errors
 * into plain messages.
 *
 * Both halves run inside one `runCommand`, so the exit-code contract is
 * stated once (`command-line.ts`): a usage error from the parse and one from
 * `add` are the same kind of failure and must not be told apart by which
 * line raised them. Every command's notion of an operator error applies,
 * because a catalogue that cannot be read is the operator's problem whichever
 * command tripped over it.
 */
export async function main(argv: readonly string[]): Promise<number> {
  return runCommand(() => parseArguments(argv).run(), {
    isOperatorError: (error) => COMMANDS.some((command) => command.isOperatorError(error)),
  });
}
