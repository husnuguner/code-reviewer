/**
 * A patch read by side. The one place pre-context parses diff text: languages are handed lines, never a
 * patch, so no language re-learns what a hunk looks like.
 * @packageDocumentation
 */

import { type PatchSides } from "../../ports/language";

/**
 * A patch's lines by side, markers stripped: what the change wrote, what it removed, and the context git
 * printed around it. Diff and hunk headers belong to none of them.
 */
export function patchSides(patch: string): PatchSides {
  const added: string[] = [];
  const removed: string[] = [];
  const kept: string[] = [];
  for (const line of patch.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) added.push(line.slice(1));
    else if (line.startsWith("-")) removed.push(line.slice(1));
    else if (line.startsWith(" ")) kept.push(line.slice(1));
  }
  return { added, removed, kept };
}
