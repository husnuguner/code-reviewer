/**
 * Escaping for the `::command key=value::message` format a GitHub runner reads. An unescaped newline
 * silently truncates a message.
 * @packageDocumentation
 */

/** Escapes a `key=value` property, where `:` and `,` would end the property list. */
export function escapeProperty(value: string): string {
  return value
    .replaceAll("%", "%25")
    .replaceAll("\r", "%0D")
    .replaceAll("\n", "%0A")
    .replaceAll(":", "%3A")
    .replaceAll(",", "%2C");
}

/** Escapes the message half, where `:` and `,` are legal but newlines are not. */
export function escapeData(value: string): string {
  return value.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
}
