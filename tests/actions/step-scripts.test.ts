/**
 * The composite actions' step scripts, run under the shell the GitHub runner
 * actually gives them: `bash --noprofile --norc -e -o pipefail`.
 *
 * Every optional input of these actions defaults to the empty string, so the
 * ordinary call -- a key, a base ref, nothing else -- leaves most guards
 * declining. Errexit is on before the script's first line, and a guard that
 * declines inside a helper function makes that function return 1: the step
 * then ends with exit 1 and no output at all, before the command is ever
 * spawned. That is invisible in review and unreadable in the log, so it is
 * asserted here: with nothing but the required inputs, the step must reach
 * the command.
 */

import { describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runStep, stepScript } from "../helpers/action-step";
import { git } from "../helpers/git";

// Up out of tests/actions/ to the repository root.
const ROOT = join(import.meta.dirname, "..", "..");
const REVIEW_ACTION = join(ROOT, "actions", "review", "action.yml");
const COMMENT_ACTION = join(ROOT, "actions", "comment", "action.yml");

/** The Review step's environment when every optional input is left empty. */
function reviewEnvironment(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    LLM_API_KEY: "test-key",
    IN_PROVIDER: "",
    IN_MODEL: "",
    IN_BASE_URL: "",
    IN_LANGUAGE: "",
    IN_SKILLS_PATH: "",
    IN_EXCLUDE: "",
    IN_MAX_FINDINGS: "",
    IN_VERIFY: "",
    IN_LOG_LEVEL: "",
    REVIEWER_CONFIG: "",
    FAIL_ON: "none",
    OUT_FILE: "code-review.ndjson",
    PREVIEW: "false",
    ANNOTATIONS: "false",
    REVIEWER: "/action/src/cli/main.ts",
    BASE_REF: "pre-prod",
    SINCE: "",
    ...overrides,
  };
}

/** The Post step's environment at the action's declared defaults. */
function commentEnvironment(overrides: Record<string, string> = {}): Record<string, string> {
  const root = mkdtempSync(join(tmpdir(), "reviewer-findings-"));
  const findings = join(root, "code-review.ndjson");
  writeFileSync(findings, `${JSON.stringify({ type: "finding" })}\n`);
  return {
    GITHUB_TOKEN: "test-token",
    PROVIDER: "github",
    FINDINGS: findings,
    REPO: "owner/repo",
    PR: "1",
    MAX_INLINE: "50",
    REQUEST_CHANGES_ON: "none",
    SUPERSEDE: "false",
    ALLOW_DUPLICATES: "false",
    BASE_URL: "",
    IDENTITY: "",
    DRY_RUN: "false",
    POSTER: "/action/src/cli/main.ts",
    ...overrides,
  };
}

describe("actions/review/action.yml, the Review step", () => {
  const { run } = stepScript(REVIEW_ACTION, "Review");

  it("reaches the reviewer when every optional input is empty", () => {
    const step = runStep(run, { env: reviewEnvironment(), stub: "bun" });

    expect(step.calls).toHaveLength(1);
    expect(step.calls[0]).toEqual([
      "--no-env-file",
      "/action/src/cli/main.ts",
      "review",
      "--base",
      "origin/pre-prod",
      "--fail-on",
      "none",
      "--log-format",
      "github",
      "--format",
      "ndjson",
      "--out",
      "code-review.ndjson",
    ]);
    expect(step.exitCode).toBe(0);
  });

  it("names the step's outputs even when the review found nothing", () => {
    const step = runStep(run, { env: reviewEnvironment(), stub: "bun" });

    expect(step.outputs).toEqual({
      "findings-file": "code-review.ndjson",
      findings: "0",
    });
  });

  it("reports the reviewer's own exit status, having written the outputs", () => {
    const step = runStep(run, { env: reviewEnvironment(), stub: "bun", stubExit: 3 });

    expect(step.exitCode).toBe(3);
    expect(step.outputs["findings-file"]).toBe("code-review.ndjson");
  });

  it("passes the optional flags it is given", () => {
    const step = runStep(run, {
      env: reviewEnvironment({
        REVIEWER_CONFIG: ".review/config.yaml",
        ANNOTATIONS: "true",
        IN_LOG_LEVEL: "debug",
      }),
      stub: "bun",
    });

    expect(step.calls[0]).not.toContain("--project");
    expect(step.calls[0]).toContain("--config");
    expect(step.calls[0]).toContain(".review/config.yaml");
    // The level travels as a flag: the reviewer reads no REVIEWER_LOG_LEVEL.
    expect(step.calls[0]).toContain("--log-level");
    expect(step.calls[0]).toContain("debug");
    expect(step.exitCode).toBe(0);
  });

  it("adds the exclude input's globs as --exclude flags, one each, to the repository's own", () => {
    // Exported as REVIEW_EXCLUDE_PATHS it replaced the repository's settings.exclude.
    const step = runStep(run, {
      env: reviewEnvironment({ IN_EXCLUDE: "**/*.snap, dist/**\n  vendor/**  \n" }),
      stub: "bun",
    });
    const call = step.calls[0] ?? [];
    const globs = call.flatMap((argument, index) =>
      call[index - 1] === "--exclude" ? [argument] : [],
    );
    expect(globs).toEqual(["**/*.snap", "dist/**", "vendor/**"]);
    expect(step.exitCode).toBe(0);
  });

  it("stops at the preview, which spawns the reviewer with no output file", () => {
    const step = runStep(run, {
      env: reviewEnvironment({ PREVIEW: "true" }),
      stub: "bun",
    });

    expect(step.calls[0]).toContain("--preview");
    expect(step.calls[0]).not.toContain("--out");
    expect(step.exitCode).toBe(0);
  });

  it("reviews since the range step's commit when it named one, still naming the base branch", () => {
    // The base decides which bypass markers the pull request added: an earlier push's marker is a
    // context line to this diff, and still not merged.
    const since = "a".repeat(40);
    const step = runStep(run, { env: reviewEnvironment({ SINCE: since }), stub: "bun" });

    expect(step.calls[0]).toContain("--since");
    expect(step.calls[0]).toContain(since);
    const call = step.calls[0] ?? [];
    expect(call[call.indexOf("--base") + 1]).toBe("origin/pre-prod");
    expect(step.exitCode).toBe(0);
  });
});

/**
 * A pull request checkout after two pushes: `main` as `origin/main`, then on `feature` a first commit
 * (the head the previous run saw) and a second (the head now). `sibling` is a commit off `main` that
 * `feature` never had, for the force-push case.
 */
function twoPushes(): {
  workspace: string;
  before: string;
  head: string;
  sibling: string;
} {
  const workspace = mkdtempSync(join(tmpdir(), "reviewer-range-step-"));
  git(workspace, "init", "-q", "-b", "main");
  git(workspace, "config", "user.email", "t@example.com");
  git(workspace, "config", "user.name", "Test");
  writeFileSync(join(workspace, "a.ts"), "1\n");
  git(workspace, "add", "-A");
  git(workspace, "commit", "-qm", "base");
  git(workspace, "update-ref", "refs/remotes/origin/main", "main");
  git(workspace, "checkout", "-q", "-b", "sibling");
  writeFileSync(join(workspace, "s.ts"), "s\n");
  git(workspace, "add", "-A");
  git(workspace, "commit", "-qm", "sibling");
  const sibling = revParse(workspace, "HEAD");
  git(workspace, "checkout", "-q", "main");
  git(workspace, "checkout", "-q", "-b", "feature");
  writeFileSync(join(workspace, "b.ts"), "2\n");
  git(workspace, "add", "-A");
  git(workspace, "commit", "-qm", "first push");
  const before = revParse(workspace, "HEAD");
  writeFileSync(join(workspace, "c.ts"), "3\n");
  git(workspace, "add", "-A");
  git(workspace, "commit", "-qm", "second push");
  const head = revParse(workspace, "HEAD");
  return { workspace, before, head, sibling };
}

function revParse(workspace: string, reference: string): string {
  const result = Bun.spawnSync(["git", "rev-parse", reference], { cwd: workspace, stdout: "pipe" });
  return result.stdout.toString().trim();
}

/** The range step's environment for a synchronize event with `incremental: true`. */
function rangeEnvironment(
  workspace: string,
  before: string,
  overrides: Record<string, string> = {},
): Record<string, string> {
  return {
    GITHUB_WORKSPACE: workspace,
    INCREMENTAL: "true",
    EVENT_NAME: "pull_request",
    EVENT_ACTION: "synchronize",
    BEFORE: before,
    BASE_REF: "main",
    ...overrides,
  };
}

describe("actions/review/action.yml, the range step", () => {
  const { run } = stepScript(REVIEW_ACTION, "Resolve the range");

  it("narrows to the commits since the previous head on an ordinary push", () => {
    const { workspace, before } = twoPushes();
    const step = runStep(run, { env: rangeEnvironment(workspace, before), stub: "bun" });
    expect(step.exitCode).toBe(0);
    expect(step.outputs).toEqual({
      range: "since",
      reason: `only the commits after ${before.slice(0, 7)}`,
      since: before,
    });
  });

  it("reviews the whole range when incremental is off, whatever the event", () => {
    const { workspace, before } = twoPushes();
    const step = runStep(run, {
      env: rangeEnvironment(workspace, before, { INCREMENTAL: "false" }),
      stub: "bun",
    });
    expect(step.outputs).toEqual({ range: "full", reason: "incremental is off", since: "" });
  });

  it("reviews the whole range on any event but a synchronize", () => {
    const { workspace, before } = twoPushes();
    for (const [name, action] of [
      ["pull_request", "opened"],
      ["pull_request", "reopened"],
      ["pull_request", "ready_for_review"],
      ["workflow_dispatch", ""],
    ] as const) {
      const step = runStep(run, {
        env: rangeEnvironment(workspace, before, { EVENT_NAME: name, EVENT_ACTION: action }),
        stub: "bun",
      });
      expect(step.outputs["range"]).toBe("full");
      expect(step.outputs["reason"]).toContain(`event ${name}/${action === "" ? "none" : action}`);
      expect(step.outputs["since"]).toBe("");
    }
  });

  it("reviews the whole range when the event carries no usable previous head", () => {
    const { workspace, before } = twoPushes();
    for (const bad of ["", "0000000000000000000000000000000000000000".slice(0, 39), "not-a-sha"]) {
      const step = runStep(run, {
        env: rangeEnvironment(workspace, before, { BEFORE: bad }),
        stub: "bun",
      });
      expect(step.outputs).toEqual({
        range: "full",
        reason: "no previous head on the event",
        since: "",
      });
    }
  });

  it("reviews the whole range when the previous head is not in the checkout", () => {
    const { workspace, before } = twoPushes();
    const unknown = "f".repeat(40);
    const step = runStep(run, {
      env: rangeEnvironment(workspace, before, { BEFORE: unknown }),
      stub: "bun",
    });
    expect(step.outputs["range"]).toBe("full");
    expect(step.outputs["reason"]).toBe(
      `previous head ${unknown.slice(0, 7)} is not in the checkout (force-push, or a shallow clone)`,
    );
  });

  it("reviews the whole range after a force-push, when the previous head is no ancestor", () => {
    const { workspace, sibling } = twoPushes();
    const step = runStep(run, {
      env: rangeEnvironment(workspace, sibling),
      stub: "bun",
    });
    expect(step.outputs["range"]).toBe("full");
    expect(step.outputs["reason"]).toBe(
      `previous head ${sibling.slice(0, 7)} is not an ancestor of HEAD (force-push)`,
    );
  });

  it("reviews the whole range when nothing was added since the previous head", () => {
    const { workspace, head } = twoPushes();
    const step = runStep(run, { env: rangeEnvironment(workspace, head), stub: "bun" });
    expect(step.outputs["range"]).toBe("full");
    expect(step.outputs["reason"]).toBe("HEAD is the previous head; nothing was added");
  });

  it("reviews the whole range when the base branch was merged in since the previous head", () => {
    const { workspace, before } = twoPushes();
    // main moves on, and the pull request merges it: since..HEAD would now carry main's own work.
    git(workspace, "checkout", "-q", "main");
    writeFileSync(join(workspace, "m.ts"), "m\n");
    git(workspace, "add", "-A");
    git(workspace, "commit", "-qm", "main moves");
    git(workspace, "update-ref", "refs/remotes/origin/main", "main");
    git(workspace, "checkout", "-q", "feature");
    git(workspace, "merge", "-q", "--no-edit", "main");
    const step = runStep(run, { env: rangeEnvironment(workspace, before), stub: "bun" });
    expect(step.outputs["range"]).toBe("full");
    expect(step.outputs["reason"]).toBe(
      `the base branch was merged or rebased in since ${before.slice(0, 7)}`,
    );
  });
});

/**
 * A checkout the way the runner leaves it: the pull request's commit checked out, the base branch
 * fetched as `origin/main`. `main` carries a strict `.review/`; the pull request loosens it.
 *
 * @param hasBasePolicy - Whether `main` carries a `.review/` at all.
 */
function pullRequestCheckout(hasBasePolicy = true): { workspace: string; temporary: string } {
  const root = mkdtempSync(join(tmpdir(), "reviewer-policy-step-"));
  const workspace = join(root, "workspace");
  mkdirSync(workspace);
  git(workspace, "init", "-q", "-b", "main");
  git(workspace, "config", "user.email", "t@example.com");
  git(workspace, "config", "user.name", "Test");
  if (hasBasePolicy) {
    mkdirSync(join(workspace, ".review", "skills"), { recursive: true });
    writeFileSync(
      join(workspace, ".review", "config.yaml"),
      "version: 1\nsettings: { exclude: [] }\n",
    );
    writeFileSync(join(workspace, ".review", "skills", "strict.md"), "---\nname: strict\n---\n");
  }
  writeFileSync(join(workspace, "a.ts"), "1\n");
  git(workspace, "add", "-A");
  git(workspace, "commit", "-qm", "base");
  // The runner has `origin/main`, not a local `main`, for the base.
  git(workspace, "update-ref", "refs/remotes/origin/main", "main");
  git(workspace, "checkout", "-q", "-b", "feature");
  mkdirSync(join(workspace, ".review", "skills"), { recursive: true });
  writeFileSync(
    join(workspace, ".review", "config.yaml"),
    'version: 1\nsettings: { exclude: ["**"] }\n',
  );
  writeFileSync(join(workspace, ".review", "skills", "loose.md"), "---\nname: loose\n---\n");
  git(workspace, "add", "-A");
  git(workspace, "commit", "-qm", "loosen");
  const temporary = join(root, "runner-temp");
  mkdirSync(temporary);
  return { workspace, temporary };
}

/** The policy step's environment for a checkout. */
function policyEnvironment(
  checkout: { workspace: string; temporary: string },
  overrides: Record<string, string> = {},
): Record<string, string> {
  return {
    GITHUB_WORKSPACE: checkout.workspace,
    POLICY_REF: "base",
    CONFIG_INPUT: "",
    SKILLS_INPUT: "",
    BASE_REF: "main",
    POLICY_DIR: join(checkout.temporary, "review-policy"),
    ...overrides,
  };
}

describe("actions/review/action.yml, the policy step", () => {
  const { run } = stepScript(REVIEW_ACTION, "Read the policy from the base branch");

  it("copies the base branch's .review/ out of the checkout and names its config", () => {
    const checkout = pullRequestCheckout();
    const step = runStep(run, { env: policyEnvironment(checkout), stub: "bun" });

    expect(step.exitCode).toBe(0);
    const config = step.outputs["config"] ?? "";
    expect(config).toBe(join(checkout.temporary, "review-policy", ".review", "config.yaml"));
    // The base's rules, not the pull request's; the base's skill, not the pull request's.
    expect(readFileSync(config, "utf8")).toContain("exclude: []");
    expect(
      existsSync(join(checkout.temporary, "review-policy", ".review", "skills", "strict.md")),
    ).toBe(true);
    expect(
      existsSync(join(checkout.temporary, "review-policy", ".review", "skills", "loose.md")),
    ).toBe(false);
    // The checkout itself is left as the pull request made it.
    expect(readFileSync(join(checkout.workspace, ".review", "config.yaml"), "utf8")).toContain(
      '["**"]',
    );
    expect(step.stdout).toContain("as origin/main has it");
  });

  it("writes an empty policy when the base branch has none, so the pull request's is not found", () => {
    const checkout = pullRequestCheckout(false);
    const step = runStep(run, { env: policyEnvironment(checkout), stub: "bun" });

    expect(step.exitCode).toBe(0);
    const config = step.outputs["config"] ?? "";
    expect(readFileSync(config, "utf8")).toBe("version: 1\n");
    expect(step.stdout).toContain("carries no .review/");
  });

  it("leaves the checkout's own policy in force when asked for head", () => {
    const checkout = pullRequestCheckout();
    const step = runStep(run, {
      env: policyEnvironment(checkout, { POLICY_REF: "head" }),
      stub: "bun",
    });

    expect(step.exitCode).toBe(0);
    expect(step.outputs["config"]).toBe("");
    expect(existsSync(join(checkout.temporary, "review-policy"))).toBe(false);
  });

  it("passes a named config file through untouched", () => {
    const checkout = pullRequestCheckout();
    const step = runStep(run, {
      env: policyEnvironment(checkout, { CONFIG_INPUT: "ci/review.yaml" }),
      stub: "bun",
    });

    expect(step.exitCode).toBe(0);
    expect(step.outputs["config"]).toBe("ci/review.yaml");
    expect(existsSync(join(checkout.temporary, "review-policy"))).toBe(false);
  });

  it("reads a skills-path input from the base branch too, not from the pull request", () => {
    // `skills-path: .review/skills` was taken from the checkout, so a pull request's rewritten skill
    // was applied under a policy otherwise read from the base.
    const checkout = pullRequestCheckout();
    const step = runStep(run, {
      env: policyEnvironment(checkout, { SKILLS_INPUT: ".review/skills" }),
      stub: "bun",
    });

    expect(step.exitCode).toBe(0);
    const skills = step.outputs["skills-path"] ?? "";
    expect(skills).toBe(join(checkout.temporary, "review-policy", ".review", "skills"));
    expect(existsSync(join(skills, "strict.md"))).toBe(true);
    expect(existsSync(join(skills, "loose.md"))).toBe(false);
  });

  it("reads a skills directory outside .review/ from the base branch as well", () => {
    const checkout = pullRequestCheckout();
    git(checkout.workspace, "checkout", "-q", "main");
    mkdirSync(join(checkout.workspace, "docs", "review-skills"), { recursive: true });
    writeFileSync(
      join(checkout.workspace, "docs", "review-skills", "base.md"),
      "---\nname: base\n---\n",
    );
    git(checkout.workspace, "add", "-A");
    git(checkout.workspace, "commit", "-qm", "skills elsewhere");
    git(checkout.workspace, "update-ref", "refs/remotes/origin/main", "main");
    git(checkout.workspace, "checkout", "-q", "feature");
    const step = runStep(run, {
      env: policyEnvironment(checkout, { SKILLS_INPUT: "./docs/review-skills/" }),
      stub: "bun",
    });

    expect(step.exitCode).toBe(0);
    const skills = step.outputs["skills-path"] ?? "";
    expect(skills).toBe(join(checkout.temporary, "review-policy", "docs", "review-skills"));
    expect(existsSync(join(skills, "base.md"))).toBe(true);
  });

  it("names an empty skills directory when the base branch has none", () => {
    const checkout = pullRequestCheckout();
    const step = runStep(run, {
      env: policyEnvironment(checkout, { SKILLS_INPUT: "nowhere/skills" }),
      stub: "bun",
    });

    expect(step.exitCode).toBe(0);
    expect(step.outputs["skills-path"]).toBe(
      join(checkout.temporary, "review-policy", "nowhere", "skills"),
    );
    expect(step.stdout).toContain("carries no nowhere/skills");
  });

  it("passes an absolute skills-path through, and the checkout's own under head", () => {
    const checkout = pullRequestCheckout();
    const absolute = runStep(run, {
      env: policyEnvironment(checkout, { SKILLS_INPUT: "/opt/skills" }),
      stub: "bun",
    });
    expect(absolute.outputs["skills-path"]).toBe("/opt/skills");
    const head = runStep(run, {
      env: policyEnvironment(checkout, { POLICY_REF: "head", SKILLS_INPUT: ".review/skills" }),
      stub: "bun",
    });
    expect(head.outputs["skills-path"]).toBe(".review/skills");
  });

  it("refuses a skills-path that climbs out of the repository", () => {
    const checkout = pullRequestCheckout();
    const step = runStep(run, {
      env: policyEnvironment(checkout, { SKILLS_INPUT: "../elsewhere" }),
      stub: "bun",
    });

    expect(step.exitCode).toBe(1);
    expect(step.stdout).toContain("::error::skills-path must stay inside the repository");
  });

  it("refuses a policy-ref it does not know", () => {
    const checkout = pullRequestCheckout();
    const step = runStep(run, {
      env: policyEnvironment(checkout, { POLICY_REF: "origin/develop" }),
      stub: "bun",
    });

    expect(step.exitCode).toBe(1);
    expect(step.stdout).toContain("::error::policy-ref must be 'base' or 'head'");
  });
});

describe("actions/comment/action.yml, the Post step", () => {
  const { run } = stepScript(COMMENT_ACTION, "Post the review");

  it("reaches the poster at the action's defaults", () => {
    const step = runStep(run, { env: commentEnvironment(), stub: "bun" });

    expect(step.calls).toHaveLength(1);
    expect(step.calls[0]).toContain("comment");
    expect(step.calls[0]).not.toContain("--supersede");
    expect(step.calls[0]).not.toContain("--dry-run");
    expect(step.calls[0]).not.toContain("--base-url");
    expect(step.calls[0]).not.toContain("--identity");
    expect(step.calls[0]).not.toContain("--allow-duplicates");
    expect(step.exitCode).toBe(0);
  });

  it("passes the flags its true-valued inputs ask for", () => {
    const step = runStep(run, {
      env: commentEnvironment({
        SUPERSEDE: "true",
        ALLOW_DUPLICATES: "true",
        DRY_RUN: "true",
        BASE_URL: "https://github.example.com/api/v3",
        IDENTITY: "review-bot[bot]",
      }),
      stub: "bun",
    });

    const call = step.calls[0] ?? [];
    expect(call[call.indexOf("--identity") + 1]).toBe("review-bot[bot]");
    expect(step.calls[0]).toContain("--supersede");
    expect(step.calls[0]).toContain("--allow-duplicates");
    expect(step.calls[0]).toContain("--dry-run");
    expect(step.calls[0]).toContain("--base-url");
    expect(step.exitCode).toBe(0);
  });

  it("says so and stops when there is no findings file", () => {
    const step = runStep(run, {
      env: commentEnvironment({ FINDINGS: "/nowhere/code-review.ndjson" }),
      stub: "bun",
    });

    expect(step.calls).toHaveLength(0);
    expect(step.stdout).toContain("::notice::");
    expect(step.exitCode).toBe(0);
  });
});
