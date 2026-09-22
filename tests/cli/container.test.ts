/**
 * The composition root's view of the checkout: which repository is reviewed, and where its review
 * policy lives inside it. Built against a real git repository; nothing here calls a model.
 */

import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { type RunRequest, buildContainer } from "../../src/cli/container";
import { resolveLogSettings } from "../../src/providers/logging/log-settings";
import { git } from "../helpers/git";

/**
 * A scratch area: a checkout carrying `.review/` (config, prompts, skills), a copy of that `.review/`
 * outside it, and a config home nothing else writes to.
 */
function scratch(): { repo: string; copy: string; xdg: string } {
  const root = mkdtempSync(join(tmpdir(), "reviewer-container-"));
  const repo = join(root, "repo");
  const review = join(repo, ".review");
  mkdirSync(join(review, "skills"), { recursive: true });
  mkdirSync(join(review, "prompts"), { recursive: true });
  mkdirSync(join(repo, "src", "deep"), { recursive: true });
  writeFileSync(join(review, "config.yaml"), "version: 1\nskills:\n  path: skills\n");
  writeFileSync(join(review, "skills", "api.md"), "---\nname: api\n---\nrule\n");
  writeFileSync(join(review, "prompts", "prompts.md"), "");
  git(repo, "init", "-q", "-b", "main");
  const copy = join(root, "policy-copy");
  mkdirSync(join(copy, ".review", "skills"), { recursive: true });
  writeFileSync(join(copy, ".review", "config.yaml"), "version: 1\nskills:\n  path: skills\n");
  const xdg = join(root, "xdg");
  mkdirSync(xdg, { recursive: true });
  return { repo, copy, xdg };
}

function request(over: Partial<RunRequest>): RunRequest {
  return {
    configFile: null,
    logging: resolveLogSettings(),
    overrides: {},
    requiresModel: false,
    format: "text",
    outFile: null,
    ...over,
  };
}

describe("the checkout the composition root reviews", () => {
  it("is the repository owning the .review/ it found, however deep the run started", () => {
    const s = scratch();
    const { cradle } = buildContainer(
      request({ cwd: join(s.repo, "src", "deep"), environment: { XDG_CONFIG_HOME: s.xdg } }),
    );
    expect(cradle.checkoutRoot).toBe(s.repo);
    expect(cradle.policyPaths).toEqual([
      ".review/config.yaml",
      ".review/prompts",
      ".review/skills",
    ]);
  });

  it("is the repository around cwd when the config file was named and lies elsewhere", () => {
    // How a CI runner reads the base branch's policy: a copy outside the checkout, named with --config.
    // The reviewed repository is still the one the run started in, and its own .review/ stays policy.
    const s = scratch();
    const { cradle } = buildContainer(
      request({
        configFile: join(s.copy, ".review", "config.yaml"),
        cwd: join(s.repo, "src", "deep"),
        environment: { XDG_CONFIG_HOME: s.xdg },
      }),
    );
    expect(cradle.checkoutRoot).toBe(s.repo);
    // The named file, its prompts and its skills are outside the checkout, so they are not paths in it;
    // `.review` itself is always policy (see `policyChanges`).
    expect(cradle.policyPaths).toEqual([]);
  });

  it("takes a skills path the command line gave, spelled from the checkout root", () => {
    const s = scratch();
    const { cradle } = buildContainer(
      request({
        cwd: s.repo,
        environment: { XDG_CONFIG_HOME: s.xdg },
        overrides: { skillsPath: "ci/skills/" },
      }),
    );
    expect(cradle.policyPaths).toEqual([".review/config.yaml", ".review/prompts", "ci/skills"]);
  });
});
