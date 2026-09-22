/**
 * The Release workflow's step scripts, run under the shell the GitHub runner
 * gives them. The workflow starts from a tag someone pushed by hand, so its
 * first step is the one that matters: everything the release publishes has to
 * agree with that tag -- package.json's version, and a changelog section to
 * serve as the notes -- and a disagreement must stop the run before `gh`
 * creates anything. The same script is run here against this checkout, so a
 * version bump without its changelog section fails `bun run check` before the
 * tag exists.
 */

import { describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runStep, workflowStep } from "../helpers/action-step";

// Up out of tests/actions/ to the repository root.
const ROOT = join(import.meta.dirname, "..", "..");
const WORKFLOW = join(ROOT, ".github", "workflows", "release.yml");

/** The verify step's environment for a tag, with the notes file inside the checkout. */
function verifyEnvironment(checkout: string, tag: string): Record<string, string> {
  return { TAG: tag, NOTES: join(checkout, "release-notes.md") };
}

/**
 * A checkout as a release commit leaves it: package.json at `version`, and a
 * changelog with one section per given release, newest first, each holding the
 * text it is given (`###` subsections included, as the real one has).
 */
function checkoutAt(version: string, sections: Record<string, string>): string {
  const checkout = mkdtempSync(join(tmpdir(), "reviewer-release-"));
  writeFileSync(
    join(checkout, "package.json"),
    `${JSON.stringify({ name: "code-reviewer", version, type: "module" }, null, 2)}\n`,
  );
  mkdirSync(join(checkout, "docs"));
  const body = Object.entries(sections)
    .map(([tag, text]) => `## ${tag}\n${text}`)
    .join("\n");
  writeFileSync(
    join(checkout, "docs", "changelog.md"),
    `# Changelog\n\nOne section per release, newest first.\n\n${body}`,
  );
  return checkout;
}

const NOTES_0_0_11 =
  "\n### What's new\n\n- **A thing.** It does something.\n\n### Also\n\n- A fix.\n";

describe(".github/workflows/release.yml, the verify step", () => {
  const { run } = workflowStep(WORKFLOW, "release", "Verify the commit against the tag");

  it("passes when package.json and the changelog agree with the tag, and hands on the notes", () => {
    const checkout = checkoutAt("0.0.11", {
      "v0.0.11": NOTES_0_0_11,
      "v0.0.10": "\nThe previous release's notes.\n",
    });
    const step = runStep(run, { env: verifyEnvironment(checkout, "v0.0.11"), cwd: checkout });
    expect(step.stderr).toBe("");
    expect(step.exitCode).toBe(0);
    expect(step.stdout).toContain("Release v0.0.11: package.json agrees");

    const notes = step.outputs["notes"];
    expect(notes).toBe(join(checkout, "release-notes.md"));
    expect(existsSync(notes ?? "")).toBe(true);
    const text = readFileSync(notes ?? "", "utf8");
    // The section is the notes: its own subsections in, the heading itself and
    // the next release out.
    expect(text).toContain("### What's new");
    expect(text).toContain("- A fix.");
    expect(text).not.toContain("## v0.0.11");
    expect(text).not.toContain("previous release");
  });

  it("takes the last section too, which no later heading closes", () => {
    const checkout = checkoutAt("0.0.11", {
      "v0.0.12": "\nUnreleased.\n",
      "v0.0.11": NOTES_0_0_11,
    });
    const step = runStep(run, { env: verifyEnvironment(checkout, "v0.0.11"), cwd: checkout });
    expect(step.exitCode).toBe(0);
    const text = readFileSync(step.outputs["notes"] ?? "", "utf8");
    expect(text).toContain("- A fix.");
    expect(text).not.toContain("Unreleased");
  });

  it("refuses a tag that is not vX.Y.Z before reading anything", () => {
    const checkout = checkoutAt("0.0.11", { "v0.0.11": NOTES_0_0_11 });
    for (const tag of ["v0", "v0.0.11-rc.1", "0.0.11", "release-1"]) {
      const step = runStep(run, { env: verifyEnvironment(checkout, tag), cwd: checkout });
      expect(step.exitCode).toBe(1);
      expect(step.stdout).toContain(`::error::${tag} is not a vX.Y.Z tag`);
      expect(step.outputs).toEqual({});
    }
  });

  it("fails when package.json was not bumped to the tag's version, naming both", () => {
    const checkout = checkoutAt("0.0.10", { "v0.0.11": NOTES_0_0_11 });
    const step = runStep(run, { env: verifyEnvironment(checkout, "v0.0.11"), cwd: checkout });
    expect(step.exitCode).toBe(1);
    expect(step.stdout).toContain("::error::package.json says 0.0.10; the tag is v0.0.11.");
    expect(step.outputs).toEqual({});
  });

  it("fails when the changelog has no section for the tag", () => {
    const checkout = checkoutAt("0.0.11", { "v0.0.10": "\nThe previous release's notes.\n" });
    const step = runStep(run, { env: verifyEnvironment(checkout, "v0.0.11"), cwd: checkout });
    expect(step.exitCode).toBe(1);
    expect(step.stdout).toContain("::error::docs/changelog.md has no '## v0.0.11' section");
    expect(step.outputs).toEqual({});
  });

  it("fails when the section is there but says nothing", () => {
    const checkout = checkoutAt("0.0.11", {
      "v0.0.11": "\n\n",
      "v0.0.10": "\nThe previous release's notes.\n",
    });
    const step = runStep(run, { env: verifyEnvironment(checkout, "v0.0.11"), cwd: checkout });
    expect(step.exitCode).toBe(1);
    expect(step.stdout).toContain("::error::docs/changelog.md has no '## v0.0.11' section");
    expect(step.outputs).toEqual({});
  });

  it("passes on this checkout: docs/changelog.md has a section for package.json's version", () => {
    const { version } = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
      version: string;
    };
    const notes = mkdtempSync(join(tmpdir(), "reviewer-release-notes-"));
    const step = runStep(run, { env: verifyEnvironment(notes, `v${version}`), cwd: ROOT });
    expect(step.stdout).toContain(`Release v${version}: package.json agrees`);
    expect(step.exitCode).toBe(0);
  });

  it("matches the heading whole, so `## v0.0.1` is not `## v0.0.11`", () => {
    const checkout = checkoutAt("0.0.1", {
      "v0.0.11": "\nThe wrong release.\n",
      "v0.0.1": "\nThe first release.\n",
    });
    const step = runStep(run, { env: verifyEnvironment(checkout, "v0.0.1"), cwd: checkout });
    expect(step.exitCode).toBe(0);
    const text = readFileSync(step.outputs["notes"] ?? "", "utf8");
    expect(text).toContain("The first release.");
    expect(text).not.toContain("The wrong release.");
  });
});

describe(".github/workflows/release.yml, the publish step", () => {
  const { run } = workflowStep(WORKFLOW, "release", "Publish the release");

  it("creates the release from the verified tag and the notes the verify step wrote", () => {
    const step = runStep(run, {
      env: { GH_TOKEN: "test-token", TAG: "v0.0.11", NOTES: "/tmp/release-notes.md" },
      stub: "gh",
    });
    expect(step.exitCode).toBe(0);
    expect(step.calls).toEqual([
      [
        "release",
        "create",
        "v0.0.11",
        "--verify-tag",
        "--title",
        "v0.0.11",
        "--notes-file",
        "/tmp/release-notes.md",
      ],
    ]);
  });

  it("reports gh's failure as its own", () => {
    const step = runStep(run, {
      env: { GH_TOKEN: "test-token", TAG: "v0.0.11", NOTES: "/tmp/release-notes.md" },
      stub: "gh",
      stubExit: 1,
    });
    expect(step.exitCode).toBe(1);
  });
});

describe(".github/workflows/release.yml, the major-tag step", () => {
  const { run } = workflowStep(WORKFLOW, "release", "Move the major tag");

  it("moves the tag's major to the tag and force-pushes only that ref", () => {
    const step = runStep(run, { env: { TAG: "v0.0.11" }, stub: "git" });
    expect(step.exitCode).toBe(0);
    expect(step.calls).toEqual([
      ["tag", "-f", "v0", "v0.0.11"],
      ["push", "-f", "origin", "refs/tags/v0"],
    ]);
    expect(step.stdout).toContain("v0 -> v0.0.11.");
  });

  it("reads the major off the tag, so 1.0.0 moves v1", () => {
    const step = runStep(run, { env: { TAG: "v1.0.0" }, stub: "git" });
    expect(step.calls[0]).toEqual(["tag", "-f", "v1", "v1.0.0"]);
    expect(step.calls[1]).toEqual(["push", "-f", "origin", "refs/tags/v1"]);
  });
});
