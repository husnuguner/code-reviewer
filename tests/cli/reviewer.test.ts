/**
 * The `reviewer` command line: which command a set of arguments names, and
 * that every flag parses as documented.
 */

import { describe, expect, it } from "bun:test";

import { COMMENT } from "../../src/cli/commands/comment/command";
import { INIT } from "../../src/cli/commands/init/command";
import { REVIEW } from "../../src/cli/commands/review/command";
import { UsageError, parseArguments } from "../../src/cli/reviewer";
import { argumentsOf, parsedBy } from "../helpers/command-line";

const review = parsedBy(REVIEW);

describe("naming the command", () => {
  it("reviews unless told otherwise", () => {
    expect(parseArguments([]).command).toBe("review");
    expect(parseArguments(["--preview"]).command).toBe("review");
    expect(parseArguments(["review", "--base", "develop"]).command).toBe("review");
  });

  it("knows init", () => {
    expect(parseArguments(["init"]).command).toBe("init");
    expect(parseArguments(["init", "--config", "/c.yaml"]).command).toBe("init");
  });

  it("no longer knows the project commands", () => {
    expect(() => parseArguments(["projects"])).toThrow(UsageError);
    expect(() => parseArguments(["add", "x"])).toThrow(UsageError);
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
    // `comment` settles its logging at the parse, having no container to
    // build one from; what it carries is the decision, not the flag.
    expect(
      argumentsOf(COMMENT, ["comment", "--findings", "f", "--repo", "a/b", "--pr", "1", "-v"])
        .logging.level,
    ).toBe("debug");
  });
});

describe("the logging flags", () => {
  it("live on the root, so every command takes them in the same place", () => {
    expect(review(["-q"]).quiet).toBe(true);
    expect(argumentsOf(INIT, ["init", "-q"]).quiet).toBe(true);
    expect(argumentsOf(INIT, ["--log-level", "error", "init"]).logLevel).toBe("error");
  });

  it("read --log-level whatever its case, and 'warning' as 'warn'", () => {
    expect(review(["--log-level", "DEBUG"]).logLevel).toBe("debug");
    expect(review(["--log-level", "warn"]).logLevel).toBe("warn");
  });

  it("refuse a level and a format neither the logger knows", () => {
    expect(() => parseArguments(["--log-level", "chatty"])).toThrow(/Allowed levels are/u);
    expect(() => parseArguments(["--log-format", "xml"])).toThrow(/Allowed log formats are/u);
  });

  it("spell --no-color as color: false, and leave the terminal to decide otherwise", () => {
    expect(review(["--no-color"]).color).toBe(false);
    expect(review([]).color).toBe(true);
  });
});

describe("the review flags", () => {
  it("default every flag off", () => {
    expect(review([])).toEqual({
      config: null,
      verbose: false,
      quiet: false,
      logLevel: null,
      // Not `text`: the shape is decided from the environment at the point
      // a logger is built, so the parsed flag stays undecided.
      logFormat: "auto",
      // Commander's shape for `--no-color`: on until the flag is given.
      color: true,
      // The current checkout: a CI build sits on a detached commit, so the
      // common case must not need a branch name.
      branch: "HEAD",
      base: "main",
      // A branch review until a run asks for the working tree instead.
      uncommitted: false,
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
    expect(review(["--uncommitted"]).uncommitted).toBe(true);
    // The only flag that is on until refused: there is no `--verify`.
    expect(review(["--no-verify"]).verify).toBe(false);
  });

  it("refuse --uncommitted beside --base or --branch, which it would otherwise silently ignore", () => {
    // One question or the other: the working tree against HEAD, or a branch
    // against a base. A base named with --uncommitted was never used, and a
    // flag that does nothing is a flag the operator misread.
    expect(() => parseArguments(["--uncommitted", "--base", "develop"])).toThrow(UsageError);
    expect(() => parseArguments(["--uncommitted", "--base", "develop"])).toThrow(
      /'--uncommitted' cannot be used with option '--base/u,
    );
    expect(() => parseArguments(["--uncommitted", "--branch", "feat"])).toThrow(UsageError);
    // The defaults of --base and --branch do not count as naming them.
    expect(review(["--uncommitted"]).base).toBe("main");
  });

  it("name the config file, the language, the skills and the exclusions", () => {
    const arguments_ = review([
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

describe("the config-file flags", () => {
  it("take --config on every command that opens the config files", () => {
    expect(argumentsOf(INIT, ["init", "--config", "/c.yaml"]).config).toBe("/c.yaml");
    expect(review(["--config", "/c.yaml"]).config).toBe("/c.yaml");
  });

  it("no longer take --project", () => {
    expect(() => parseArguments(["--project", "app"])).toThrow(UsageError);
  });
});
