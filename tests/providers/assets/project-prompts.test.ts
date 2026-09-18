/**
 * Reading a repository's standing instructions off the disk: order, the
 * empty file `init` leaves behind, and the path that is not there.
 */

import { describe, expect, it } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readProjectPrompts } from "../../../src/providers/assets/project-prompts";

function scratch(files: Readonly<Record<string, string>>): (name: string) => string {
  const root = mkdtempSync(join(tmpdir(), "reviewer-prompts-"));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(root, name), text, "utf8");
  return (name: string) => join(root, name);
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

describe("the project's prompt files", () => {
  it("joins them in the order the catalogue named them", () => {
    const path = scratch({ "a.md": "First.", "b.md": "Second." });
    expect(readProjectPrompts([path("b.md"), path("a.md")])).toBe("Second.\n\nFirst.");
  });

  it("adds nothing for the empty file init writes", () => {
    const path = scratch({ "prompts.md": "" });
    expect(readProjectPrompts([path("prompts.md")])).toBe("");
  });

  it("names nothing at all as nothing, so a project without prompts composes the old prompt", () => {
    expect(readProjectPrompts([])).toBe("");
  });

  it("warns about a path it cannot read and keeps the rest", () => {
    const path = scratch({ "a.md": "Kept." });
    const lines: string[] = [];
    const text = readProjectPrompts([path("missing.md"), path("a.md")], recordingLogger(lines));
    // Losing a project's instructions degrades the review; losing the review
    // because one path was mistyped is worse -- so it is a warning, not an
    // error, and the surviving file still reaches the model.
    expect(text).toBe("Kept.");
    expect(lines.some((line) => line.startsWith("warn:") && line.includes("missing.md"))).toBe(
      true,
    );
  });
});
