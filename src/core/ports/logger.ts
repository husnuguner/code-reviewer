/**
 * The logging port.
 *
 * The core reports what it decides -- which file it skipped and why, how a
 * finding's line was settled, where every finding ended up -- without knowing
 * where those lines go. The CLI routes them to stderr; a UI can route them to
 * a run log. Messages are plain, pre-formatted text so the port stays trivial
 * to implement.
 */

export interface Logger {
  debug(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  /** A logger for a sub-component, named like Python's `logging.getLogger(__name__)`. */
  child(name: string): Logger;
}

const discard = (_message: string): void => undefined;

/** A logger that discards everything; the default where none is injected. */
export const NULL_LOGGER: Logger = {
  debug: discard,
  info: discard,
  warn: discard,
  error: discard,
  child: () => NULL_LOGGER,
};
