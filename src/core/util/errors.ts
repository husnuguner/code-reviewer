/**
 * Error classes whose names are part of the contract, and the one way a thrown value becomes a message.
 * @packageDocumentation
 */

/** A configuration file that cannot be used as written. Printed plainly; exit 2. */
export class CatalogError extends Error {
  override readonly name = "CatalogError";
}

/** A git invocation that did not succeed. Printed plainly; exit 2. */
export class GitError extends Error {
  override readonly name = "GitError";
}

/** An argument the callee cannot honour. */
export class ValueError extends Error {
  override readonly name = "ValueError";
}

/** A record file the run was told to write and cannot. Printed plainly; exit 2. */
export class ReportFileError extends Error {
  override readonly name = "ReportFileError";
}

/**
 * Renders any thrown value as message text.
 *
 * @param error - Whatever was thrown or rejected with.
 * @returns The `Error` message, the string itself, JSON for other values, or `<type>` when none applies.
 */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error === undefined || typeof error === "symbol" || typeof error === "function") {
    return `<${typeof error}>`;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return `<unserialisable ${typeof error}>`;
  }
}
