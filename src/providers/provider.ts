/**
 * A provider: a named, self-describing thing that builds one port implementation from one input.
 * @packageDocumentation
 */

/**
 * The base of every provider kind. A kind (`ModelProvider`, `FormatProvider`, …) pins `In` and `Out`;
 * each implementation is a class of that kind.
 */
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- `In`/`Out` are the contract a kind pins and a registry reads back
export abstract class Provider<In, Out> {
  /** The id an operator writes on the command line or in the environment. */
  abstract readonly name: string;
  /** One line, shown in `--help` and quoted in refusals. */
  abstract readonly description: string;

  /** Builds the one thing this provider provides. */
  abstract create(input: In): Out;
}
