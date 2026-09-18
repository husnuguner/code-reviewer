/**
 * What every command in this package shares: how a command line is built,
 * how its errors become exit codes, and what those codes mean.
 *
 * The exit-code contract is exactly the kind of thing a caller (a workflow, a
 * shell script) depends on without reading the source, so it is stated here
 * once; each command states only what differs: its flags, and which of its
 * errors are the operator's to fix.
 *
 * Exit codes: `0` success · `1` usage error · `2` a problem the operator can
 * fix (named in one `error:` line) · anything else is the command's own to
 * define · an unexpected error is never caught here, so its stack trace
 * survives to be read.
 */

import { Command, CommanderError, InvalidArgumentError, type OptionValues } from "commander";

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
 * A `Command` with the conventions every command here follows: errors are
 * thrown rather than exiting the process (so `main` decides the exit code),
 * and Commander does not print them itself -- `runCommand` does, once, from
 * the error it receives. Everything else Commander writes to stderr goes
 * there, leaving stdout to the command's own output -- which for a review is
 * a machine-readable stream.
 *
 * Used for the root command and for each subcommand alike: Commander copies
 * these settings only to subcommands it creates itself, and ours are built
 * apart and attached.
 */
export function commandLine(name: string, description: string): Command {
  return new Command(name)
    .description(description)
    .allowExcessArguments(false)
    .exitOverride()
    .configureOutput({
      writeErr: (text) => process.stderr.write(text),
      outputError: () => {
        // Reported by `runCommand` from the thrown error, so that it is said once.
      },
    });
}

/**
 * One subcommand: how it is spelled on the command line, and what it does.
 *
 * The two halves are kept apart -- `build` reads flags into `A`, `run` acts
 * on an `A` -- so the flags can be tested without touching a container, and
 * the root command can bind one to the other without knowing what `A` is.
 * A command is *registered* with the root, never named in it: adding one is
 * writing a module and adding it to the list, not editing a dispatch.
 */
export interface CliCommand<A> {
  /** The word on the command line. */
  readonly name: string;
  /** The Commander subcommand; `onParsed` is called with the arguments it read. */
  build(onParsed: (arguments_: A) => void): Command;
  /** Act on parsed arguments; the exit code. */
  run(arguments_: A): Promise<number> | number;
  /** Which of this command's own failures are the operator's to fix. */
  isOperatorError(error: unknown): boolean;
}

/**
 * What Commander hands back for arguments shaped `A`: a string flag left
 * unset is `undefined` there and `null` here, everything else is the same.
 * Saves each command spelling its argument shape twice.
 */
export type ParsedOptions<A> = {
  readonly [K in keyof A]: null extends A[K] ? Exclude<A[K], null> | undefined : A[K];
};

/**
 * What one command states about itself. `defineCommand` turns it into a
 * `CliCommand`, so the Commander plumbing -- the action, reading the options
 * with the root's globals, the positionals -- is written once, here, and a
 * command module holds only its flags, its argument shape and its work.
 *
 * `O` is the options shape Commander produces; it defaults to `A`'s, and a
 * command with a positional narrows it to the flags alone.
 */
export interface CommandSpec<A, O extends OptionValues = ParsedOptions<A>> {
  readonly name: string;
  readonly description: string;
  /** This command's own flags and positionals, added to a bare command. */
  readonly options: (command: Command) => Command;
  /** The parsed options (the root's included) and positionals, as this command's arguments. */
  readonly arguments: (options: O, positionals: readonly string[]) => A;
  readonly run: (arguments_: A) => Promise<number> | number;
  /** Which of this command's own failures are the operator's to fix; none by default. */
  readonly isOperatorError?: (error: unknown) => boolean;
}

/** A `CliCommand` from what a command states about itself. */
export function defineCommand<A, O extends OptionValues = ParsedOptions<A>>(
  spec: CommandSpec<A, O>,
): CliCommand<A> {
  return {
    name: spec.name,
    build: (onParsed) =>
      spec.options(commandLine(spec.name, spec.description)).action((...received: unknown[]) => {
        // Commander calls an action with the positionals, then the options,
        // then the command itself; everything is read back off the command.
        const command = received.at(-1);
        if (!(command instanceof Command)) {
          throw new TypeError("Commander did not pass the command to its action");
        }
        const positionals = received.slice(0, -2).filter((value) => typeof value === "string");
        onParsed(spec.arguments(command.optsWithGlobals<O>(), positionals));
      }),
    run: spec.run,
    isOperatorError: spec.isOperatorError ?? (() => false),
  };
}

/**
 * A command line that has been read: the command it named, bound to what it
 * was given. `run` needs nothing more -- the binding happened at the parse,
 * which is what lets the root act on any command the same way.
 */
export interface Invocation<A = unknown> {
  readonly command: string;
  readonly arguments: A;
  run(): Promise<number> | number;
}

/** Bind a command to the arguments it parsed: the one place the two meet. */
export function bind<A>(command: CliCommand<A>, arguments_: A): Invocation<A> {
  return {
    command: command.name,
    arguments: arguments_,
    run: () => command.run(arguments_),
  };
}

/** Whether `invocation` is `command`'s -- and, when it is, what its arguments are. */
export function isInvocationOf<A>(
  invocation: Invocation,
  command: CliCommand<A>,
): invocation is Invocation<A> {
  return invocation.command === command.name;
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
   * of `OperatorError`. A review names its config, catalogue and git errors
   * here; `comment` names the hosting system's refusals.
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

// -- option parsers -----------------------------------------------------------
//
// A flag's text becomes a value through an `OptionParser`. The parsers here
// know nothing of the domain: a command builds the one it needs by composing
// them with its own vocabulary (`listOf(choice(SEVERITIES, ...), ...)`), so
// a new kind of value is a new composition, not a new hand-written parser.

/**
 * The text a flag was given, as the value the command wants. Refuses with
 * `InvalidArgumentError`, which Commander reports against the flag's name.
 */
export type OptionParser<T> = (value: string) => T;

export interface ChoiceOptions {
  /** What the values are called when one is refused: "Allowed <label> are ...". */
  readonly label?: string;
  /** Match regardless of case and surrounding space; the canonical spelling is returned. */
  readonly caseInsensitive?: boolean;
}

/** Exactly one of the listed values, named when refusing. */
export function choice<T extends string>(
  allowed: readonly T[],
  options: ChoiceOptions = {},
): OptionParser<T> {
  const fold = (text: string): string =>
    options.caseInsensitive === true ? text.trim().toLowerCase() : text;
  const canonical = new Map(allowed.map((item) => [fold(item), item]));
  const label = options.label ?? "choices";
  return (value) => {
    const match = canonical.get(fold(value));
    if (match === undefined) {
      throw new InvalidArgumentError(`Allowed ${label} are ${allowed.join(", ")}.`);
    }
    return match;
  };
}

/** A whole number (0, 1, 2, ...), for a pull-request number or a cap. */
export const integer: OptionParser<number> = (value) => {
  if (!/^\d+$/u.test(value)) throw new InvalidArgumentError("Not a whole number.");
  return Number(value);
};

export interface ListOptions {
  /** What separates the items; a comma unless said otherwise. */
  readonly separator?: string;
  /**
   * A word that, on its own, means the empty list -- `none` for a gate.
   * Spelled out rather than left to an empty string, because `--fail-on ''`
   * reads like a mistake and a gate nobody meant to disable is the one that
   * silently stops failing builds. It is also named when an item is refused.
   */
  readonly none?: string;
}

/**
 * A separated list of `item`s, each parsed on its own; blank entries are
 * dropped, so `a, ,b` is two items. The result is what a command gates on,
 * in the order given.
 */
export function listOf<T>(item: OptionParser<T>, options: ListOptions = {}): OptionParser<T[]> {
  const separator = options.separator ?? ",";
  return (value) => {
    const parts = value
      .split(separator)
      .map((part) => part.trim())
      .filter((part) => part !== "");
    const isNone = options.none !== undefined && parts.length === 1 && parts[0] === options.none;
    return isNone ? [] : parts.map((part) => parseItem(item, part, options.none));
  };
}

/** One item of a list; a refusal names the word for the empty list, which the item could not know. */
function parseItem<T>(item: OptionParser<T>, part: string, none: string | undefined): T {
  try {
    return item(part);
  } catch (error) {
    const isRefusal = error instanceof InvalidArgumentError && none !== undefined;
    throw isRefusal
      ? new InvalidArgumentError(`${error.message.replace(/\.$/u, "")}, or ${none}.`)
      : error;
  }
}

/**
 * A flag that may be given more than once, each occurrence one more item:
 * `--exclude a --exclude b`. This is Commander's accumulating shape, so it is
 * handed to `.option()` as the parser with `[]` as the default.
 */
export function repeatable<T>(
  item: OptionParser<T>,
): (value: string, previous: readonly T[]) => T[] {
  return (value, previous) => [...previous, item(value)];
}

/** The text itself; for a flag whose value needs no parsing but sits in a composition. */
export const text: OptionParser<string> = (value) => value;

/**
 * Whether an error is an instance of any of the listed classes -- the shape
 * every command's `isOperatorError` takes, so each names its classes and not
 * the loop.
 */
export function instanceOfAny(
  ...classes: readonly (abstract new (...arguments_: never[]) => unknown)[]
): (error: unknown) => boolean {
  return (error) => classes.some((type) => error instanceof type);
}
