/**
 * Counting braces as structure, not as characters. Shared by the pre-context (which reads the members
 * of a declaration) and the bypass scan (which reads the extent of a block).
 * @packageDocumentation
 */

/** A string literal, so a brace inside one is not counted as structure. */
const STRING_LITERAL = /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/gu;

/** The line with every string literal removed, so what is left is code. */
export function withoutStringLiterals(line: string): string {
  return line.replaceAll(STRING_LITERAL, "");
}

/**
 * How much deeper in braces a line ends than it began.
 *
 * @remarks An enum member `OPEN = '{'` or a field typed `"{"` is a value, not a block: counted as
 * structure it would keep the block open until the line cap elided it.
 */
export function braceDepthChange(line: string): number {
  let change = 0;
  for (const found of withoutStringLiterals(line)) {
    if (found === "{") change += 1;
    else if (found === "}") change -= 1;
  }
  return change;
}
