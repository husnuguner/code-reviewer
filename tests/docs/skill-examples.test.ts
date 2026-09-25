/**
 * A skill example in the documentation is copied into `.review/skills/` as it stands, so it has to be a
 * skill the parser accepts. The README's once was not: a formatter had put a blank line inside its
 * frontmatter, and a copied file was silently not a skill.
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { FrontmatterSkillParser } from "../../src/core/skills/parser";

// Up out of tests/docs/ to the repository root.
const ROOT = join(import.meta.dirname, "..", "..");

const PAGES = ["README.md", join("docs", "configuration.md")];

/** Every ```markdown fence whose text opens a frontmatter block: the pages' skill examples. */
function skillExamples(text: string): string[] {
  return text
    .matchAll(/```markdown\n([^]*?)```/gu)
    .map((match) => match[1] ?? "")
    .filter((body) => body.includes("\nname:") || body.startsWith("---"))
    .toArray();
}

describe("the skill examples in the documentation", () => {
  it.each(PAGES)("%s shows skills the parser accepts, as written", (page) => {
    const examples = skillExamples(readFileSync(join(ROOT, page), "utf8"));
    expect(examples.length).toBeGreaterThan(0);
    const parser = new FrontmatterSkillParser();
    for (const example of examples) {
      const skill = parser.parse(example, page);
      expect(skill?.name).toBe("api-conventions");
    }
  });
});
