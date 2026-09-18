/**
 * The review policy is files the operator owns: named in the catalogue,
 * resolved beside it, concatenated in order, and never silently missing.
 */

import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";


import { ConfigError } from "../../../src/core/config/config";
import { systemPrompt } from "../../../src/core/review/prompts";
import { readReviewPolicy, resolvePromptPath } from "../../../src/infra/prompts/policy-files";
import { shippedFile } from "../../../src/infra/shipped-files";

function home(): string {
  const root = mkdtempSync(join(tmpdir(), "reviewer-prompts-"));
  mkdirSync(join(root, "prompts"));
  writeFileSync(join(root, "prompts", "system.md"), "  Be strict.\n", "utf8");
  writeFileSync(join(root, "prompts", "extra.md"), "Mind the migrations.\n", "utf8");
  writeFileSync(join(root, "prompts", "empty.md"), "\n", "utf8");
  return root;
}

describe("review policy files", () => {
  it("joins the named files in order, trimmed, blanks dropped", () => {
    const root = home();
    const policy = readReviewPolicy(
      ["prompts/system.md", "prompts/empty.md", "prompts/extra.md"],
      root,
    );
    expect(policy).toBe("Be strict.\n\nMind the migrations.");
  });

  it("means the shipped policy when no file is named", () => {
    expect(readReviewPolicy([], home())).toBeUndefined();
  });

  it("refuses a file that cannot be read", () => {
    const root = home();
    const attempt = (): unknown => readReviewPolicy(["prompts/missing.md"], root);
    expect(attempt).toThrow(ConfigError);
    expect(attempt).toThrow(/prompts names .*missing\.md, which cannot be read/u);
  });

  it("takes relative paths from the catalogue's directory and expands ~", () => {
    expect(resolvePromptPath("prompts/system.md", "/cfg")).toBe("/cfg/prompts/system.md");
    expect(resolvePromptPath("/abs/p.md", "/cfg")).toBe("/abs/p.md");
    expect(resolvePromptPath("~/p.md", "/cfg")).toMatch(/^\/.*\/p\.md$/u);
    expect(resolvePromptPath("~/p.md", "/cfg")).not.toContain("~");
  });

  it("ships a policy and a contract that compose into the system prompt", () => {
    const prompt = systemPrompt(
      shippedFile("prompts/system.md"),
      shippedFile("prompts/output-contract.md"),
    );
    expect(prompt.startsWith("You are a precise, senior software engineer")).toBe(true);
    expect(prompt).toContain('"severity": "bug|security|performance|readability"');
    expect(prompt).not.toContain("{{severities}}");
  });
});
