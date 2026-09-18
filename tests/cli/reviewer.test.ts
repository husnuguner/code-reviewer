/**
 * The `reviewer` command line: which command a set of arguments names, and
 * that every flag parses as documented.
 */

import { describe, expect, it } from "bun:test";

import { ADD, INIT, PROJECTS } from "../../src/cli/commands/catalog";
import { COMMENT } from "../../src/cli/commands/comment";
import { REVIEW } from "../../src/cli/commands/review";
import { UsageError, parseArguments } from "../../src/cli/reviewer";
import { argumentsOf, parsedBy } from "../helpers/command-line";

const review = parsedBy(REVIEW);
const add = parsedBy(ADD);

describe("naming the command", () => {
  it("reviews unless told otherwise", () => {
    expect(parseArguments([]).command).toBe("review");
    expect(parseArguments(["--preview"]).command).toBe("review");
    expect(parseArguments(["review", "--base", "develop"]).command).toBe("review");
  });

  it("knows the catalogue commands", () => {
    expect(parseArguments(["init"]).command).toBe("init");
    expect(parseArguments(["projects", "--config", "/c.json"]).command).toBe("projects");
    expect(parseArguments(["add", "x"]).command).toBe("add");
  });

  it("knows the poster", () => {
    expect(
      parseArguments(["comment", "--findings", "f.ndjson", "--repo", "acme/app", "--pr", "7"])
        .command,
    ).toBe("comment");
  });

  it("rejects an unknown command", () => {
    expect(() => parseArguments(["frobnicate"])).toThrow(UsageError);
  });

  it("takes -v before or after the command name, for every command", () => {
    expect(review(["-v"]).verbose).toBe(true);
    expect(review(["--verbose", "--base", "x"]).verbose).toBe(true);
    expect(review([]).verbose).toBe(false);
    expect(argumentsOf(INIT, ["-v", "init"]).verbose).toBe(true);
    expect(argumentsOf(INIT, ["init", "-v"]).verbose).toBe(true);
    expect(
      argumentsOf(COMMENT, ["comment", "--findings", "f", "--repo", "a/b", "--pr", "1", "-v"])
        .verbose,
    ).toBe(true);
  });
});

describe("the review flags", () => {
  it("default every flag off", () => {
    expect(review([])).toEqual({
      config: null,
      verbose: false,
      project: null,
      // The current checkout: a CI build sits on a detached commit, so the
      // common case must not need a branch name.
      branch: "HEAD",
      base: "main",
      format: "text",
      out: null,
      preview: false,
      lang: null,
      skillsPath: null,
      exclude: [],
      failOn: [],
      verify: true,
    });
  });

  it("turn on", () => {
    expect(review(["--preview"]).preview).toBe(true);
    // The only flag that is on until refused: there is no `--verify`.
    expect(review(["--no-verify"]).verify).toBe(false);
  });

  it("name the project, the catalogue, the language, the skills and the exclusions", () => {
    const arguments_ = review([
      "--project",
      "app",
      "--config",
      "/c.yaml",
      "--lang",
      "tr",
      "--skills-path",
      ".review/skills",
      "--exclude",
      "**/*.md",
      "--exclude",
      "**/*.lock",
    ]);
    expect(arguments_.project).toBe("app");
    expect(arguments_.config).toBe("/c.yaml");
    expect(arguments_.lang).toBe("tr");
    expect(arguments_.skillsPath).toBe(".review/skills");
    expect(arguments_.exclude).toEqual(["**/*.md", "**/*.lock"]);
  });

  it("name the refs, the format and the record file", () => {
    const arguments_ = review([
      "--branch",
      "feature/x",
      "--base",
      "develop",
      "--format",
      "ndjson",
      "--out",
      "findings.ndjson",
    ]);
    expect(arguments_.branch).toBe("feature/x");
    expect(arguments_.base).toBe("develop");
    expect(arguments_.format).toBe("ndjson");
    expect(arguments_.out).toBe("findings.ndjson");
  });

  it("read --fail-on as a severity list, and 'none' as no gate", () => {
    expect(review(["--fail-on", "bug,security"]).failOn).toEqual(["bug", "security"]);
    expect(review(["--fail-on", "none"]).failOn).toEqual([]);
    expect(() => parseArguments(["--fail-on", "urgent"])).toThrow(/Allowed severities are/u);
  });

  it("refuse a format the registry does not know", () => {
    expect(() => parseArguments(["--format", "xml"])).toThrow(
      /Allowed formats are text, ndjson, github/u,
    );
  });
});

describe("the catalogue flags", () => {
  it("parse 'add' with a name and the two scaffolding flags", () => {
    const arguments_ = add(["add", "my-app", "--path", "/src/app", "--skills", "rules"]);
    expect(arguments_.name).toBe("my-app");
    expect(arguments_.path).toBe("/src/app");
    expect(arguments_.skills).toBe("rules");
    // The default is inside the reviewed repository, which is what CI reads.
    expect(add(["add", "x"]).skills).toBe(".review/skills");
  });

  it("refuse 'add' without a name", () => {
    expect(() => parseArguments(["add"])).toThrow(UsageError);
  });

  it("take --config on every command that opens the catalogue", () => {
    expect(argumentsOf(INIT, ["init", "--config", "/c.yaml"]).config).toBe("/c.yaml");
    expect(argumentsOf(PROJECTS, ["projects", "--config", "/c.yaml"]).config).toBe("/c.yaml");
    expect(add(["add", "x", "--config", "/c.yaml"]).config).toBe("/c.yaml");
    expect(review(["--config", "/c.yaml"]).config).toBe("/c.yaml");
  });
});
