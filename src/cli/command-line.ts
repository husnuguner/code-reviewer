/**
 * What every command shares: how a command line is built, how errors become exit codes, and the option
 * parsers. Exit codes: `0` success · `1` usage · `2` operator-fixable · others the command's own.
 * @packageDocumentation
 */

import { Command, CommanderError, InvalidArgumentError, type OptionValues } from "commander";

/** Exit code for a usage error. */
export const USAGE_EXIT_CODE = 1;
/** Exit code for a problem the operator can fix. */
export const OPERATOR_EXIT_CODE = 2;

/** A usage error, carrying the exit code Commander chose (`0` for `--help`). */
export class UsageError extends Error {
  override readonly name = "UsageError";

  constructor(
    message: string,
    readonly exitCode: number = USAGE_EXIT_CODE,
  ) {
    super(message);
  }
}

/** A problem the operator can fix: one `error:` line and exit 2, never a stack trace. */
export class OperatorError extends Error {
  override readonly name = "OperatorError";
}

/**
 * A Commander `Command` with this package's conventions: errors are thrown (so `main` decides the exit
 * code), Commander prints nothing itself, and its own output goes to stderr.
 */
export function commandLine(name: string, description: string): Command {
  return new Command(name)
    .description(description)
    .allowExcessArguments(false)
    .exitOverride()
    .configureOutput({
      writeErr: (text) => process.stderr.write(text),
      outputError: () => {
        // Reported once by `runCommand` from the thrown error.
      },
    });
}

/**
 * One subcommand: how it is spelled and what it does.
 *
 * @typeParam A - The parsed arguments; `build` reads them, `run` acts on them.
 */
export interface CliCommand<A> {
  /** The word on the command line. */
  readonly name: string;
  /** The Commander subcommand; `onParsed` receives the arguments it read. */
  build(onParsed: (arguments_: A) => void): Command;
  /** Acts on parsed arguments; returns the exit code. */
  run(arguments_: A): Promise<number> | number;
  /** Which of this command's failures are the operator's to fix. */
  isOperatorError(error: unknown): boolean;
}

/** Arguments shaped `A` as Commander returns them: a `null` field is `undefined` there. */
export type ParsedOptions<A> = {
  readonly [K in keyof A]: null extends A[K] ? Exclude<A[K], null> | undefined : A[K];
};

/**
 * What one command states about itself; {@link defineCommand} turns it into a `CliCommand`.
 *
 * @typeParam O - The options shape Commander produces; a command with a positional narrows it.
 */
export interface CommandSpec<A, O extends OptionValues = ParsedOptions<A>> {
  readonly name: string;
  readonly description: string;
  /** Adds this command's flags and positionals. */
  readonly options: (command: Command) => Command;
  /** Builds the arguments from the parsed options (the root's included) and positionals. */
  readonly arguments: (options: O, positionals: readonly string[]) => A;
  readonly run: (arguments_: A) => Promise<number> | number;
  /** Which failures are the operator's to fix; none by default. */
  readonly isOperatorError?: (error: unknown) => boolean;
}

/** Builds a `CliCommand` from a spec, writing the Commander plumbing once. */
export function defineCommand<A, O extends OptionValues = ParsedOptions<A>>(
  spec: CommandSpec<A, O>,
): CliCommand<A> {
  return {
    name: spec.name,
    build: (onParsed) =>
      spec.options(commandLine(spec.name, spec.description)).action((...received: unknown[]) => {
        // Commander passes positionals, then options, then the command; everything is read off the command.
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

/** A parsed command line: the command it named, bound to its arguments. */
export interface Invocation<A = unknown> {
  readonly command: string;
  readonly arguments: A;
  run(): Promise<number> | number;
}

/** Binds a command to its parsed arguments. */
export function bind<A>(command: CliCommand<A>, arguments_: A): Invocation<A> {
  return {
    command: command.name,
    arguments: arguments_,
    run: () => command.run(arguments_),
  };
}

/** Whether `invocation` is `command`'s, narrowing its arguments. */
export function isInvocationOf<A>(
  invocation: Invocation,
  command: CliCommand<A>,
): invocation is Invocation<A> {
  return invocation.command === command.name;
}

/**
 * Parses `argv` (without executable and script).
 *
 * @throws {@link UsageError} carrying Commander's exit code: `1` for a bad flag, `0` for `--help`/`--version`.
 */
export function parseCommandLine(program: Command, argv: readonly string[]): void {
  try {
    program.parse([...argv], { from: "user" });
  } catch (error) {
    if (error instanceof CommanderError) throw new UsageError(error.message, error.exitCode);
    throw error;
  }
}

/** Options for {@link runCommand}. */
export interface RunCommandOptions {
  /** Error types that are the operator's to fix, on top of `OperatorError`. */
  readonly isOperatorError?: (error: unknown) => boolean;
}

/**
 * Runs a command body and turns its errors into an exit code.
 *
 * @returns The body's code; a `UsageError`'s code (message printed unless `0`); `2` with one `error:`
 * line for an operator error. Anything else is rethrown with its stack trace.
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

/** Turns a flag's text into a value; refuses with `InvalidArgumentError`, which Commander reports against the flag. */
export type OptionParser<T> = (value: string) => T;

/** Options for {@link choice}. */
export interface ChoiceOptions {
  /** What the values are called in a refusal: "Allowed <label> are …". */
  readonly label?: string;
  /** Match regardless of case and surrounding space; the canonical spelling is returned. */
  readonly caseInsensitive?: boolean;
}

/** Exactly one of the listed values. */
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

/** A whole number. */
export const integer: OptionParser<number> = (value) => {
  if (!/^\d+$/u.test(value)) throw new InvalidArgumentError("Not a whole number.");
  return Number(value);
};

/** Options for {@link listOf}. */
export interface ListOptions {
  /** The item separator; default `,`. */
  readonly separator?: string;
  /** A word that alone means the empty list (`none` for a gate); also named in a refusal. */
  readonly none?: string;
}

/** A separated list of items, each parsed on its own; blank entries are dropped. */
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

/** One item of a list; a refusal also names the empty-list word. */
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

/** A flag given more than once, each occurrence one more item; pass to `.option()` with `[]` as default. */
export function repeatable<T>(
  item: OptionParser<T>,
): (value: string, previous: readonly T[]) => T[] {
  return (value, previous) => [...previous, item(value)];
}

/** The text itself. */
export const text: OptionParser<string> = (value) => value;

/** Whether an error is an instance of any of the classes; the shape every `isOperatorError` takes. */
export function instanceOfAny(
  ...classes: readonly (abstract new (...arguments_: never[]) => unknown)[]
): (error: unknown) => boolean {
  return (error) => classes.some((type) => error instanceof type);
}
