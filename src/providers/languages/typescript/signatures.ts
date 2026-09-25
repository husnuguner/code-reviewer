/**
 * A TypeScript/JavaScript module read as a surface: each `export` with its doc block, an open signature's
 * continuation, and the members of an `enum`/`interface`/`type` -- what a caller may use, not how it works.
 * @packageDocumentation
 */

import { braceDepthChange } from "../../../core/review/braces";
import { cutToLength } from "../../../core/util/text";

const JSDOC_LINES_KEPT = 6;

/** Declarations whose members _are_ the signature: an enum's values, an interface's fields. */
const MEMBER_DECLARATION = /^\s*export\s+(?:declare\s+)?(?:const\s+)?(?:enum|interface|type)\b/u;

/** Body lines of such a declaration kept before the rest is elided. */
const MEMBER_LINES_KEPT = 16;

/**
 * A module's exported surface: each `export` line with the doc block above it, the members of an
 * `enum`/`interface`/`type` it opens, or the first lines of a module exporting nothing recognisable.
 *
 * @param maxChars - The code-point cap.
 */
export function exportSignatures(text: string, maxChars: number): string {
  const lines = text.split("\n");
  const kept: string[] = [];
  for (const [index, line] of lines.entries()) {
    if (!/^\s*export\b/u.test(line)) continue;
    const continuation = continuationOf(lines, index);
    kept.push(
      ...documentBlockAbove(lines, index),
      line.trimEnd(),
      ...continuation,
      ...memberBlockOf(lines, index, index + continuation.length),
    );
  }
  const body = kept.length > 0 ? kept.join("\n") : lines.slice(0, 30).join("\n");
  return cutToLength(body, maxChars);
}

/** Up to four lines finishing a signature the `export` line left open. */
function continuationOf(lines: readonly string[], index: number): string[] {
  const line = lines[index] ?? "";
  if (/[;{})=]\s*$/u.test(line) || /\bfrom\b/u.test(line)) return [];
  const out: string[] = [];
  const following = lines.slice(index + 1, index + 5);
  for (const continuation of following) {
    out.push(continuation.trimEnd());
    if (/[;{)]\s*$/u.test(continuation)) break;
  }
  return out;
}

/**
 * The body of a declaration whose members are its signature.
 *
 * @param index - The `export` line.
 * @param opensAt - The line the declaration's head ends on: the `export` line itself, or the last line
 * of a wrapped signature (`export interface Long<\n  T,\n> {`). The body is read from there.
 * @remarks `export enum SubscriptionModules {` on its own names the type and nothing else: the model
 * cannot tell whether the `SubscriptionModules.CORE` in the diff exists. Functions and classes are
 * left out on purpose -- their bodies are implementation, not surface.
 * @returns The body with its closing brace, elided past {@link MEMBER_LINES_KEPT}; `[]` for anything
 * that is not a member declaration opening a block.
 */
function memberBlockOf(lines: readonly string[], index: number, opensAt: number): string[] {
  if (!MEMBER_DECLARATION.test(lines[index] ?? "")) return [];
  if (!/\{\s*$/u.test(lines[opensAt] ?? "")) return [];
  const body: string[] = [];
  let depth = 1;
  const following = lines.slice(opensAt + 1);
  for (const next of following) {
    depth += braceDepthChange(next);
    if (depth > 0 && body.length >= MEMBER_LINES_KEPT) {
      body.push("  // ...", "}");
      break;
    }
    body.push(next.trimEnd());
    if (depth <= 0) break;
  }
  return body;
}

function documentBlockAbove(lines: readonly string[], index: number): string[] {
  const block: string[] = [];
  for (let at = index - 1; at >= 0; at -= 1) {
    const line = (lines[at] ?? "").trimEnd();
    if (line.trim() === "" || !/^\s*(?:\/\*\*|\*|\/\/)/u.test(line)) break;
    block.unshift(line);
    if (line.trimStart().startsWith("/**")) break;
  }
  return block.slice(-JSDOC_LINES_KEPT);
}
