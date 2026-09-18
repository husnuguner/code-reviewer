/**
 * Finding a repository's standing instructions: the directory beside the
 * catalogue, what it reads out of it, and the file it cannot read.
 */

import { describe, expect, it } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  PROMPTS_DIR_NAME,
  promptsDirectory,
  readProjectPrompts,
} from "../../../src/providers/assets/project-prompts";

/** A throwaway `prompts/` directory holding the named files. */
function scratch(files: Readonly<Record<string, string>>): string {
  const root = mkdtempSync(join(tmpdir(), "reviewer-prompts-"));
  const directory = join(root, PROMPTS_DIR_NAME);
  mkdirSync(directory, { recursive: true });
  for (const [name, text] of Object.entries(files)) {
    const file = join(directory, name);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text, "utf8");
  }
  return directory;
}

function recordingLogger(lines: string[]): Parameters<typeof readProjectPrompts>[1] {
  const record =
    (level: string) =>
    (message: string): void => {
      lines.push(`${level}: ${message}`);
    };
  const logger = {
    child: () => logger,
    debug: record("debug"),
    info: record("info"),
    warn: record("warn"),
    error: record("error"),
  };
  return logger;
}

describe("where the standing instructions are", () => {
  it("is `prompts/` beside the catalogue, whichever catalogue is in force", () => {
    // Not a setting: the directory follows the catalogue, so a repository's
    // rules are in its own .review/ and a machine-wide catalogue's are in
    // the config home. Nothing has to name either.
    expect(promptsDirectory("/repo/.review/config.yaml")).toBe("/repo/.review/prompts");
    expect(promptsDirectory("/home/me/.config/reviewer/config.yaml")).toBe(
      "/home/me/.config/reviewer/prompts",
    );
  });
});

describe("the project's prompt files", () => {
  it("reads every *.md under the directory, nested ones included, in path order", () => {
    const directory = scratch({
      "b.md": "Second.",
      "a.md": "First.",
      "api/errors.md": "Nested.",
      "notes.txt": "Not Markdown.",
    });
    expect(readProjectPrompts(directory)).toEqual([
      { label: "prompts/a.md", text: "First." },
      { label: "prompts/api/errors.md", text: "Nested." },
      { label: "prompts/b.md", text: "Second." },
    ]);
  });

  it("labels each file by its path, so the model is told where a rule came from", () => {
    const directory = scratch({ "security.md": "Never log a token." });
    expect(readProjectPrompts(directory)[0]?.label).toBe("prompts/security.md");
  });

  it("adds nothing for the empty file init writes", () => {
    const directory = scratch({ "prompts.md": "" });
    expect(readProjectPrompts(directory)).toEqual([]);
  });

  it("treats a missing directory as nothing to add, not as a failure", () => {
    // The ordinary case for a repository that carries no rules of its own.
    const absent = join(tmpdir(), "reviewer-prompts-absent-dir");
    expect(readProjectPrompts(absent)).toEqual([]);
    expect(readProjectPrompts("")).toEqual([]);
  });

  // Permissions do not stop root, so the one case that needs an unreadable
  // file states that condition rather than failing in a container.
  it.skipIf(process.getuid?.() === 0)(
    "warns about a file it cannot read and keeps the rest",
    () => {
      const directory = scratch({ "a.md": "Kept.", "b.md": "Unreadable." });
      chmodSync(join(directory, "b.md"), 0o000);
      const lines: string[] = [];
      const instructions = readProjectPrompts(directory, recordingLogger(lines));
      // Losing a repository's instructions degrades the review; losing the
      // review because one file is unreadable is worse -- so it is a warning,
      // and the surviving file still reaches the model.
      expect(instructions).toEqual([{ label: "prompts/a.md", text: "Kept." }]);
      expect(lines.some((line) => line.startsWith("warn:") && line.includes("b.md"))).toBe(true);
    },
  );
});
