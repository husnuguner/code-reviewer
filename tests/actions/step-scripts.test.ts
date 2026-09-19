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
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runStep, stepScript } from "../helpers/action-step";

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
    HEAD_REF: "HEAD",
    FAIL_ON: "none",
    OUT_FILE: "code-review.ndjson",
    PREVIEW: "false",
    ANNOTATIONS: "false",
    REVIEWER: "/action/src/cli/main.ts",
    BASE_REF: "pre-prod",
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
    BASE_URL: "",
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
      "--base",
      "origin/pre-prod",
      "--branch",
      "HEAD",
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
      }),
      stub: "bun",
    });

    expect(step.calls[0]).not.toContain("--project");
    expect(step.calls[0]).toContain("--config");
    expect(step.calls[0]).toContain(".review/config.yaml");
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
    expect(step.exitCode).toBe(0);
  });

  it("passes the flags its true-valued inputs ask for", () => {
    const step = runStep(run, {
      env: commentEnvironment({
        SUPERSEDE: "true",
        DRY_RUN: "true",
        BASE_URL: "https://github.example.com/api/v3",
      }),
      stub: "bun",
    });

    expect(step.calls[0]).toContain("--supersede");
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
