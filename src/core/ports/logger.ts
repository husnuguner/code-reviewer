/**
 * The logging port. Messages are pre-formatted text; the sink is the adapter's.
 * @packageDocumentation
 */

/** A leveled logger. */
export interface Logger {
  debug(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  /** A logger for a sub-component, named `parent.name`. */
  child(name: string): Logger;
}

const discard = (_message: string): void => undefined;

/** Discards everything; the default where none is injected. */
export const NULL_LOGGER: Logger = {
  debug: discard,
  info: discard,
  warn: discard,
  error: discard,
  child: () => NULL_LOGGER,
};
