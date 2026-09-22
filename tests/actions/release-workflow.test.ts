/**
 * The Release workflow's step scripts, run under the shell the GitHub runner
 * gives them. The workflow runs after every green Check on main, so its gate
 * is the step that matters: most commits release nothing and must say so
 * quietly; a commit whose package.json names an unreleased version must be
 * released with its changelog section, and refused when the section is
 * missing. The gate is run here against this checkout too, so a version bump
 * without its section fails `bun run check` before it reaches main.
 */

import { describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parse as parseYaml } from "yaml";

import { runStep, workflowStep } from "../helpers/action-step";
import { git } from "../helpers/git";

// Up out of tests/actions/ to the repository root.
const ROOT = join(import.meta.dirname, "..", "..");
const WORKFLOW = join(ROOT, ".github", "workflows", "release.yml");
const CHECK_WORKFLOW = join(ROOT, ".github", "workflows", "check.yml");

/** The gate's environment, with the notes file under `notes`. */
function gateEnvironment(notes: string): Record<string, string> {
  return { GH_TOKEN: "test-token", NOTES: join(notes, "release-notes.md") };
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

/** `gh release view` answering as the stub is told: exit 0 is "released", 1 is "no such release". */
const RELEASED = 0;
const UNRELEASED = 1;

describe(".github/workflows/release.yml, the gate", () => {
  const { run } = workflowStep(WORKFLOW, "release", "Decide whether this commit is a release");

  it("releases a version no Release has, and hands on its changelog section as the notes", () => {
    const checkout = checkoutAt("0.0.11", {
      "v0.0.11": NOTES_0_0_11,
      "v0.0.10": "\nThe previous release's notes.\n",
    });
    const step = runStep(run, {
      env: gateEnvironment(checkout),
      cwd: checkout,
      stub: "gh",
      stubExit: UNRELEASED,
    });
    expect(step.stderr).toBe("");
    expect(step.exitCode).toBe(0);
    expect(step.calls).toEqual([["release", "view", "v0.0.11", "--json", "tagName"]]);
    expect(step.outputs["release"]).toBe("yes");
    expect(step.outputs["tag"]).toBe("v0.0.11");
    expect(step.stdout).toContain("Release: yes (v0.0.11 has no Release");

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

  it("releases nothing when the version's Release exists, which is most pushes", () => {
    const checkout = checkoutAt("0.0.11", { "v0.0.11": NOTES_0_0_11 });
    const step = runStep(run, {
      env: gateEnvironment(checkout),
      cwd: checkout,
      stub: "gh",
      stubExit: RELEASED,
    });
    expect(step.exitCode).toBe(0);
    expect(step.stdout).toBe("Release: no (v0.0.11 is released).\n");
    expect(step.outputs).toEqual({ release: "no", tag: "v0.0.11" });
  });

  it("releases nothing from a version that is not X.Y.Z, and warns, without asking GitHub", () => {
    for (const version of ["0.0.11-rc.1", "1.0", "next"]) {
      const checkout = checkoutAt(version, { [`v${version}`]: NOTES_0_0_11 });
      const step = runStep(run, {
        env: gateEnvironment(checkout),
        cwd: checkout,
        stub: "gh",
        stubExit: UNRELEASED,
      });
      expect(step.exitCode).toBe(0);
      expect(step.stdout).toContain(
        `::warning::package.json says '${version}', which is not X.Y.Z`,
      );
      expect(step.outputs).toEqual({ release: "no", tag: `v${version}` });
      expect(step.calls).toEqual([]);
    }
  });

  it("fails when the unreleased version has no changelog section", () => {
    const checkout = checkoutAt("0.0.11", { "v0.0.10": "\nThe previous release's notes.\n" });
    const step = runStep(run, {
      env: gateEnvironment(checkout),
      cwd: checkout,
      stub: "gh",
      stubExit: UNRELEASED,
    });
    expect(step.exitCode).toBe(1);
    expect(step.stdout).toContain("::error::docs/changelog.md has no '## v0.0.11' section");
    expect(step.outputs).toEqual({});
  });

  it("fails when the section is there but says nothing", () => {
    const checkout = checkoutAt("0.0.11", {
      "v0.0.11": "\n\n",
      "v0.0.10": "\nThe previous release's notes.\n",
    });
    const step = runStep(run, {
      env: gateEnvironment(checkout),
      cwd: checkout,
      stub: "gh",
      stubExit: UNRELEASED,
    });
    expect(step.exitCode).toBe(1);
    expect(step.stdout).toContain("::error::docs/changelog.md has no '## v0.0.11' section");
    expect(step.outputs).toEqual({});
  });

  it("takes the last section too, which no later heading closes", () => {
    const checkout = checkoutAt("0.0.11", {
      "v0.0.12": "\nUnreleased.\n",
      "v0.0.11": NOTES_0_0_11,
    });
    const step = runStep(run, {
      env: gateEnvironment(checkout),
      cwd: checkout,
      stub: "gh",
      stubExit: UNRELEASED,
    });
    expect(step.exitCode).toBe(0);
    const text = readFileSync(step.outputs["notes"] ?? "", "utf8");
    expect(text).toContain("- A fix.");
    expect(text).not.toContain("Unreleased");
  });

  it("matches the heading whole, so `## v0.0.1` is not `## v0.0.11`", () => {
    const checkout = checkoutAt("0.0.1", {
      "v0.0.11": "\nThe wrong release.\n",
      "v0.0.1": "\nThe first release.\n",
    });
    const step = runStep(run, {
      env: gateEnvironment(checkout),
      cwd: checkout,
      stub: "gh",
      stubExit: UNRELEASED,
    });
    expect(step.exitCode).toBe(0);
    const text = readFileSync(step.outputs["notes"] ?? "", "utf8");
    expect(text).toContain("The first release.");
    expect(text).not.toContain("The wrong release.");
  });

  it("would release this checkout: docs/changelog.md has a section for package.json's version", () => {
    const { version } = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
      version: string;
    };
    const notes = mkdtempSync(join(tmpdir(), "reviewer-release-notes-"));
    const step = runStep(run, {
      env: gateEnvironment(notes),
      cwd: ROOT,
      stub: "gh",
      stubExit: UNRELEASED,
    });
    expect(step.stdout).toContain(`Release: yes (v${version} has no Release`);
    expect(step.exitCode).toBe(0);
  });
});

/** What one git command prints, trimmed. */
function gitOutput(root: string, ...arguments_: string[]): string {
  const result = Bun.spawnSync(["git", ...arguments_], { cwd: root, stdout: "pipe" });
  return result.stdout.toString().trim();
}

/**
 * A bare `origin` and a clone of it with one commit, the way the runner's
 * checkout stands when the tag step runs.
 */
function clonedCheckout(): { origin: string; work: string; sha: string } {
  const root = mkdtempSync(join(tmpdir(), "reviewer-tag-step-"));
  const origin = join(root, "origin.git");
  const work = join(root, "work");
  git(root, "init", "-q", "--bare", "-b", "main", origin);
  git(root, "clone", "-q", origin, work);
  git(work, "config", "user.email", "t@example.com");
  git(work, "config", "user.name", "Test");
  writeFileSync(join(work, "a.ts"), "1\n");
  git(work, "add", "-A");
  git(work, "commit", "-qm", "release: v0.0.11");
  git(work, "push", "-q", "origin", "main");
  return { origin, work, sha: gitOutput(work, "rev-parse", "HEAD") };
}

describe(".github/workflows/release.yml, the tag step", () => {
  const { run } = workflowStep(WORKFLOW, "release", "Tag the commit");

  it("tags the commit the Check passed on, annotated, and pushes only that tag", () => {
    const { origin, work, sha } = clonedCheckout();
    const step = runStep(run, { env: { TAG: "v0.0.11", SHA: sha }, cwd: work });
    expect(step.exitCode).toBe(0);
    expect(step.stdout).toContain(`v0.0.11 -> ${sha.slice(0, 7)}.`);
    expect(gitOutput(origin, "cat-file", "-t", "v0.0.11")).toBe("tag");
    expect(gitOutput(origin, "rev-parse", "v0.0.11^{commit}")).toBe(sha);
    expect(gitOutput(origin, "tag", "--list")).toBe("v0.0.11");
  });

  it("keeps a tag an earlier run already put here, and pushes nothing", () => {
    const { origin, work, sha } = clonedCheckout();
    git(work, "tag", "-a", "v0.0.11", "-m", "v0.0.11", sha);
    git(work, "push", "-q", "origin", "refs/tags/v0.0.11");
    const before = gitOutput(origin, "rev-parse", "v0.0.11");
    const step = runStep(run, { env: { TAG: "v0.0.11", SHA: sha }, cwd: work });
    expect(step.exitCode).toBe(0);
    expect(step.stdout).toContain("v0.0.11 already points here; not tagged again.");
    expect(gitOutput(origin, "rev-parse", "v0.0.11")).toBe(before);
  });

  it("refuses to release a version whose tag sits on another commit", () => {
    const { origin, work, sha } = clonedCheckout();
    writeFileSync(join(work, "b.ts"), "2\n");
    git(work, "add", "-A");
    git(work, "commit", "-qm", "more");
    const head = gitOutput(work, "rev-parse", "HEAD");
    git(work, "push", "-q", "origin", "main");
    // The version was tagged by hand on the earlier commit; main has moved on.
    git(work, "tag", "-a", "v0.0.11", "-m", "v0.0.11", sha);
    git(work, "push", "-q", "origin", "refs/tags/v0.0.11");
    const step = runStep(run, { env: { TAG: "v0.0.11", SHA: head }, cwd: work });
    expect(step.exitCode).toBe(1);
    expect(step.stdout).toContain(
      `::error::v0.0.11 already exists at ${sha.slice(0, 7)}, which is not this commit (${head.slice(0, 7)}).`,
    );
    expect(gitOutput(origin, "rev-parse", "v0.0.11^{commit}")).toBe(sha);
  });
});

describe(".github/workflows/release.yml, the publish step", () => {
  const { run } = workflowStep(WORKFLOW, "release", "Publish the release");

  it("creates the release from the tag and the notes the gate wrote", () => {
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

describe(".github/workflows/release.yml, what it waits on", () => {
  it("runs after the workflow check.yml is named, so renaming one renames both", () => {
    const release = parseYaml(readFileSync(WORKFLOW, "utf8")) as {
      on: { workflow_run: { workflows: readonly string[]; types: readonly string[] } };
    };
    const check = parseYaml(readFileSync(CHECK_WORKFLOW, "utf8")) as { name: string };
    expect(release.on.workflow_run.workflows).toEqual([check.name]);
    expect(release.on.workflow_run.types).toEqual(["completed"]);
  });

  it("gates every releasing step on the gate's answer", () => {
    const workflow = parseYaml(readFileSync(WORKFLOW, "utf8")) as {
      jobs: { release: { steps: readonly { name: string; if?: string }[] } };
    };
    const releasing = workflow.jobs.release.steps.filter(
      (step) => !["Check out", "Decide whether this commit is a release"].includes(step.name),
    );
    expect(releasing.map((step) => step.name)).toEqual([
      "Tag the commit",
      "Publish the release",
      "Move the major tag",
    ]);
    for (const step of releasing) {
      expect(step.if).toBe("steps.gate.outputs.release == 'yes'");
    }
  });
});
