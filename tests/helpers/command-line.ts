/**
 * Parse a `reviewer` command line and hand back the arguments as `command`
 * saw them, typed. A parse that named another command is a failed test, not
 * a value some expectation happens to accept.
 */

import { type CliCommand } from "../../src/cli/command-line";
import { isInvocationOf, parseArguments } from "../../src/cli/reviewer";

export function argumentsOf<A>(command: CliCommand<A>, argv: readonly string[]): A {
  const parsed = parseArguments(argv);
  if (!isInvocationOf(parsed, command)) {
    throw new Error(`expected ${command.name}, parsed ${parsed.command}`);
  }
  return parsed.arguments;
}

/**
 * `argumentsOf` for one command, the command's name put first: a test then writes only the flags, the way a
 * user writes them after `reviewer <command>`.
 */
export function parsedBy<A>(command: CliCommand<A>): (argv: readonly string[]) => A {
  return (argv) => argumentsOf(command, [command.name, ...argv]);
}
