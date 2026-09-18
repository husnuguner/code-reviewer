/**
 * `actions/comment/action.yml` is a second statement of one interface: every
 * input it takes is a flag of `reviewer comment`, forwarded unchanged. Two
 * tables stating one thing drift unless something holds them together, and
 * this file is that something -- a flag added to the command, or an input
 * added to the wrapper, fails here until the other one follows.
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { parse as parseYaml } from "yaml";

import { COMMENT } from "../../../../src/cli/commands/comment/command";
import { DEFAULT_REPOSITORY } from "../../../../src/cli/options/repository";
import { MAX_INLINE } from "../../../../src/core/posting/review-payload";
import { sortedByCodePoint } from "../../../../src/core/util/text";

// Up out of tests/cli/commands/comment/ to the repository root.
const ROOT = join(import.meta.dirname, "..", "..", "..", "..");
const ACTION = join(ROOT, "actions", "comment", "action.yml");

interface ActionInput {
  readonly description?: string;
  readonly required?: boolean;
  readonly default?: string;
}

const source = readFileSync(ACTION, "utf8");
const action = parseYaml(source) as { inputs: Record<string, ActionInput> };
const inputs = action.inputs;

/**
 * The two inputs that are not flags: the credential (the command reads it
 * from the environment, never from the command line) and the toolchain the
 * composite steps set up before the command exists.
 */
const NOT_FLAGS = ["token", "bun-version"];

/** The long flags `reviewer comment` accepts, as commander knows them. */
function commandFlags(): string[] {
  const built = COMMENT.build(() => {
    throw new Error("no command line is parsed here; only the options are read");
  });
  return built.options.flatMap((option) =>
    option.long === undefined ? [] : [option.long.replace(/^--/, "")],
  );
}

describe("actions/comment/action.yml", () => {
  it("takes one input per flag of the command, and nothing else", () => {
    expect(sortedByCodePoint(Object.keys(inputs))).toEqual(
      sortedByCodePoint([...commandFlags(), ...NOT_FLAGS]),
    );
  });

  it("forwards every input it declares", () => {
    const steps = source.slice(source.indexOf("\nruns:"));
    for (const name of Object.keys(inputs)) {
      expect(steps).toContain(`inputs.${name}`);
    }
  });

  it("defaults to what the command defaults to", () => {
    expect(inputs["provider"]?.default).toBe(DEFAULT_REPOSITORY);
    expect(inputs["max-inline"]?.default).toBe(String(MAX_INLINE));
    // The command's spelled-out "never", and its two false-by-default flags.
    expect(inputs["request-changes-on"]?.default).toBe("none");
    expect(inputs["supersede"]?.default).toBe("false");
    expect(inputs["dry-run"]?.default).toBe("false");
  });

  it("requires the one thing that can write, and nothing else", () => {
    const required = Object.entries(inputs)
      .filter(([, input]) => input.required === true)
      .map(([name]) => name);
    expect(required).toEqual(["token"]);
  });
});
