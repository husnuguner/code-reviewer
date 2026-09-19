/**
 * `init` through the real file store: it prints what the fixtures froze, writes what it promises, and
 * leaves what is there alone.
 */

import { describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { initConfigFile } from "../../../src/core/config/init";
import { type ConfigDirectory } from "../../../src/core/ports/config-directory";
import { type ConsoleOutput } from "../../../src/core/ports/console";
import { shippedFile } from "../../../src/providers/assets/shipped-files";
import { FsConfigDirectory } from "../../../src/providers/config/config-directory";
import { loadFixture } from "../../contracts/fixtures";

function recorder(): ConsoleOutput & { text: () => string } {
  const lines: string[] = [];
  return {
    line(text = ""): void {
      lines.push(text);
    },
    text: () => lines.map((line) => `${line}\n`).join(""),
  };
}

describe("reviewer init", () => {
  const fixtures = loadFixture("commands");
  const expected = (name: string): { code: number; out: string } =>
    fixtures.find((c) => c.name === name)?.expected as { code: number; out: string };

  it("outside a checkout, writes the machine's file once, without a policy file, and refuses to overwrite", () => {
    const root = mkdtempSync(join(tmpdir(), "reviewer-init-"));
    const path = join(root, "nested", "config.yaml");
    const files: ConfigDirectory = new FsConfigDirectory(path, "<CONFIG_HOME>");
    expect(files.home).toBe("machine");
    const placeholders = (text: string): string => text.replaceAll(path, "<CONFIG_PATH>");
    const starter = {
      config: shippedFile("templates/config.yaml"),
      skillsReadme: "what a skill is",
    };
    const out = recorder();
    expect(initConfigFile(files, out, starter)).toBe(expected("init/writes_skeleton").code);
    expect(placeholders(out.text())).toBe(expected("init/writes_skeleton").out);
    expect(readFileSync(path, "utf8")).toBe(starter.config);
    // The policy is the reviewer's own: `init` installs no copy to edit, so
    // there is no file here whose drift could silently drop a hard rule.
    expect(existsSync(join(root, "nested", "prompts"))).toBe(false);
    // Skills describe a repository; the machine gets no folder for them.
    expect(existsSync(join(root, "nested", "skills"))).toBe(false);

    const again = recorder();
    expect(initConfigFile(files, again, starter)).toBe(expected("init/refuses_existing").code);
    expect(placeholders(again.text())).toBe(expected("init/refuses_existing").out);
  });

  it("inside a repository, writes the repository's own .review/ with everything CI needs", () => {
    const repo = mkdtempSync(join(tmpdir(), "reviewer-repo-"));
    const files: ConfigDirectory = new FsConfigDirectory(
      join(repo, ".review", "config.yaml"),
      "<HOME>",
    );
    expect(files.home).toBe("repo");
    const out = recorder();
    const code = initConfigFile(files, out, {
      config: shippedFile("templates/repo-config.yaml"),
      skillsReadme: "what a skill is",
    });

    expect(code).toBe(0);
    // The whole setup, in one committed folder: config, standing instructions
    // and skills. The policy is not among them -- it ships with the reviewer
    // and is not replaceable; prompts.md is added to it, and is written
    // EMPTY, so a repository that says nothing adds nothing.
    expect(readFileSync(join(repo, ".review", "config.yaml"), "utf8")).toContain("version: 1");
    expect(readFileSync(join(repo, ".review", "prompts", "prompts.md"), "utf8")).toBe("");
    expect(readFileSync(join(repo, ".review", "skills", "README.md"), "utf8")).toBe(
      "what a skill is",
    );
    // A project-specific key may live in .review/.env; committing it is the
    // one mistake init must make impossible by default.
    expect(readFileSync(join(repo, ".review", ".gitignore"), "utf8")).toContain(".env");
    expect(out.text()).toContain("Commit .review/");
    // The model is the machine's business; the next steps say so rather than ask for a key here.
    expect(out.text()).toContain("<HOME>/config.yaml names it");
  });

  it("leaves an existing sidecar alone", () => {
    const repo = mkdtempSync(join(tmpdir(), "reviewer-repo-"));
    const files = new FsConfigDirectory(join(repo, ".review", "config.yaml"), "<HOME>");
    files.writeSidecar("prompts/prompts.md", "already here");
    initConfigFile(files, recorder(), { config: "version: 1\n", skillsReadme: "" });
    expect(readFileSync(join(repo, ".review", "prompts", "prompts.md"), "utf8")).toBe(
      "already here",
    );
  });
});
