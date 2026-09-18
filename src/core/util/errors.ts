/**
 * Error classes whose *names* are part of the behavioural contract, and the
 * one way an unknown thrown value becomes a log-line message.
 *
 * The CLI prints `CatalogError`, `GitError` and configuration errors plainly
 * and exits 2; `ValueError` marks programming-level misuse. The fixture
 * contract tests assert on these names.
 */

/** A configuration file that cannot be used as written. */
export class CatalogError extends Error {
  override readonly name = "CatalogError";
}

/** A git invocation that did not succeed. */
export class GitError extends Error {
  override readonly name = "GitError";
}

/** An argument the callee cannot honour (Python's `ValueError`). */
export class ValueError extends Error {
  override readonly name = "ValueError";
}

/**
 * A file a run was told to write its records to, and cannot.
 *
 * Named here beside `CatalogError` and `GitError` for the same reason they
 * are: it is a problem in what the operator supplied rather than in this
 * code, so the CLI prints it plainly and exits 2 instead of letting a stack
 * trace point at us. A path the filesystem refuses (a missing parent
 * directory, a read-only mount, a full disk) is theirs to fix.
 */
export class ReportFileError extends Error {
  override readonly name = "ReportFileError";
}

/**
 * The message of whatever was thrown. `Error` instances contribute their
 * message; anything else is spelled out, so a rejected promise carrying a
 * string or an object still yields readable text.
 */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  // `undefined`, symbols and functions have no JSON form; they are named by type.
  if (error === undefined || typeof error === "symbol" || typeof error === "function") {
    return `<${typeof error}>`;
  }
  try {
    // Objects, numbers, booleans and null spell themselves as JSON.
    return JSON.stringify(error);
  } catch {
    return `<unserialisable ${typeof error}>`;
  }
}
