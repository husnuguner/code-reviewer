/**
 * The pre-context as one prompt block: three sections sharing one budget, most valuable first. Nothing
 * here knows a language.
 * @packageDocumentation
 */

import { cutToLength } from "../../util/text";

import { type RelatedRelation, type ReviewContext } from "./types";

/** One block of the rendered context: its heading and the items under it. */
interface Section {
  readonly title: string;
  readonly items: readonly string[];
}

/** The section as it reads whole. */
function sectionText({ title, items }: Section): string {
  return [title, ...items].join("\n");
}

/**
 * How many code points each section may take.
 *
 * @remarks An equal share each, with whatever a section does not need handed on to the ones that do,
 * most valuable first. A first-come budget would let one long block of imported signatures spend the
 * whole allowance and leave the related diffs -- the cheapest answer to "was the counterpart
 * updated?" -- out of the prompt entirely.
 * @returns One allowance per section, summing to at most `budget`.
 */
function allowances(wanted: readonly number[], budget: number): number[] {
  const even = Math.floor(budget / Math.max(1, wanted.length));
  const granted = wanted.map((want) => Math.min(want, even));
  let spare = budget - granted.reduce((sum, value) => sum + value, 0);
  for (const [index, want] of wanted.entries()) {
    const extra = Math.min(want - (granted[index] ?? 0), spare);
    if (extra <= 0) continue;
    granted[index] = (granted[index] ?? 0) + extra;
    spare -= extra;
  }
  return granted;
}

/**
 * As much of a section as its allowance fits, on an item boundary.
 *
 * @returns The section, or `""` when not even its first item fits.
 */
function fitSection(section: Section, allowance: number): string {
  const kept: string[] = [];
  let used = section.title.length;
  for (const item of section.items) {
    if (used + 1 + item.length > allowance) break;
    kept.push(item);
    used += 1 + item.length;
  }
  return kept.length === 0 ? "" : sectionText({ title: section.title, items: kept });
}

/**
 * Renders the context as one prompt block, most valuable first.
 *
 * @param maxChars - The cap on the whole block. Sections share it; within one, items are dropped on
 * their own boundary, and only a first section that cannot fit at all is cut mid-item.
 * @returns The block, or `""` when there is nothing to say.
 */
export function renderContext(context: ReviewContext, maxChars: number): string {
  const sections: Section[] = [
    {
      title:
        "Definitions of modules this file imports (exported signatures at the head; for understanding only):",
      items: context.definitions.map(
        (d) => `--- ${d.path} (imported as ${d.specifier})\n${d.signatures}`,
      ),
    },
    {
      title:
        "Other files that mention exported symbols this change touches (a signature change may break them):",
      items: context.usages.map((u) => `- ${u.symbol}: ${u.paths.join(", ")}`),
    },
    {
      title: "Related files changed in the same change set (their diffs; for understanding only):",
      items: context.related.map(
        (r) => `--- ${r.path}${RELATION_LABEL[r.relation]}\n\`\`\`diff\n${r.patch}\n\`\`\``,
      ),
    },
  ].filter(({ items }) => items.length > 0);
  if (sections.length === 0) return "";
  const separators = 2 * (sections.length - 1);
  const shares = allowances(
    sections.map((entry) => sectionText(entry).length),
    Math.max(0, maxChars - separators),
  );
  const out = sections.flatMap((entry, index) => {
    const text = fitSection(entry, shares[index] ?? 0);
    return text === "" ? [] : [text];
  });
  return out.length === 0
    ? cutToLength(sectionText(sections[0] as Section), maxChars)
    : out.join("\n\n");
}

/** How each relation is announced, so the model knows why it is being shown the diff. */
const RELATION_LABEL: Record<RelatedRelation, string> = {
  imports: " (this file imports it)",
  "imported-by": " (it imports this file)",
  sibling: "",
};
