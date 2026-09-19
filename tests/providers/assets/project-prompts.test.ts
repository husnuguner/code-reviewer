/**
 * Finding the standing instructions: the directory beside a config file, what it reads out of it, the
 * file it cannot read, and which of the two directories is in force.
 */

import { describe, expect, it } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  PROMPTS_DIR_NAME,
  promptsDirectory,
  readProjectPrompts,
  readStandingInstructions,
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
  it("is `prompts/` beside a config file, in either home", () => {
    // Not a setting: the directory follows the config file, so a repository's
    // rules are in its own .review/ and the machine's are in the config home.
    // Nothing has to name either.
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

/** The repository's `prompts/`, holding the named files. */
const repo = (files: Readonly<Record<string, string>>): string => scratch(files);
/** The machine's `prompts/`, with one house-style file. */
const machine = (): string => scratch({ "house-style.md": "Prefer early returns." });

describe("which prompts directory is in force", () => {
  it("reads the repository's when it says anything, and never the machine's alongside", () => {
    const lines: string[] = [];
    const instructions = readStandingInstructions(
      repo({ "prompts.md": "This service exposes a REST API." }),
      machine(),
      recordingLogger(lines),
    );
    expect(instructions).toEqual([
      { label: "prompts/prompts.md", text: "This service exposes a REST API." },
    ]);
    expect(lines.some((line) => line.includes("Standing instructions:"))).toBe(true);
  });

  it("falls back to the machine's when the repository's files are all empty", () => {
    // `reviewer init` writes an empty prompts.md; a directory of empty files
    // says nothing, so it does not shadow the machine's house style.
    const lines: string[] = [];
    const instructions = readStandingInstructions(
      repo({ "prompts.md": "" }),
      machine(),
      recordingLogger(lines),
    );
    expect(instructions).toEqual([
      { label: "prompts/house-style.md", text: "Prefer early returns." },
    ]);
    expect(lines.some((line) => line.includes("says nothing"))).toBe(true);
  });

  it("falls back to the machine's when the repository has no prompts directory, or no .review/ at all", () => {
    const expected = [{ label: "prompts/house-style.md", text: "Prefer early returns." }];
    const absent = join(tmpdir(), "reviewer-prompts-absent-dir");
    expect(readStandingInstructions(absent, machine())).toEqual(expected);
    expect(readStandingInstructions(null, machine())).toEqual(expected);
  });

  it("adds nothing when neither says anything", () => {
    const absent = join(tmpdir(), "reviewer-prompts-absent-dir");
    expect(readStandingInstructions(repo({ "prompts.md": "" }), absent)).toEqual([]);
    expect(readStandingInstructions(null, absent)).toEqual([]);
  });
});
