/**
 * The `::command key=value::message` wire format a GitHub runner reads.
 *
 * Two things in this codebase speak it, for unrelated reasons: the report
 * writes findings as annotations on the diff, and the logger writes its
 * lines as `::debug::`/`::warning::` so the runner folds and colours them.
 * The escaping is the same both times and getting it wrong is silent -- an
 * unescaped newline truncates the message at its first line, and the runner
 * reports no error -- so it is written once, here, rather than twice in
 * modules that otherwise share nothing.
 */

/**
 * Escape a value used as `key=value`, where `:` and `,` would end the
 * property list.
 */
export function escapeProperty(value: string): string {
  return value
    .replaceAll("%", "%25")
    .replaceAll("\r", "%0D")
    .replaceAll("\n", "%0A")
    .replaceAll(":", "%3A")
    .replaceAll(",", "%2C");
}

/** Escape the message half, where `:` and `,` are legal but newlines are not. */
export function escapeData(value: string): string {
  return value.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
}
