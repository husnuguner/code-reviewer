/**
 * What the operator asked of the logs: which source wins, and what each
 * convention (`NO_COLOR`, `RUNNER_DEBUG`, `FORCE_COLOR`) is worth against
 * the others.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import {
  type LoggingFlags,
  SECRET_MASK,
  redact,
  resolveLogSettings,
  secretsFrom,
} from "../../../src/providers/logging/log-settings";

/** Settings from flags and an environment, without colour support unless said. */
function settle(
  flags: LoggingFlags = {},
  environment: Record<string, string | undefined> = {},
  isColorSupported = false,
): ReturnType<typeof resolveLogSettings> {
  return resolveLogSettings(flags, { environment, isColorSupported });
}

describe("how loud a run is", () => {
  it("says INFO when nobody asked for anything", () => {
    expect(settle().level).toBe("info");
    expect(settle().detailed).toBe(false);
  });

  it("reads -v as debug and -q as warnings upward", () => {
    expect(settle({ verbose: true }).level).toBe("debug");
    expect(settle({ quiet: true }).level).toBe("warn");
  });

  it("lets --log-level outrank both shorthands", () => {
    expect(settle({ level: "error", verbose: true, quiet: true }).level).toBe("error");
  });

  it("resolves -v -q to quiet, because a script that asked for quiet must not be flooded", () => {
    expect(settle({ verbose: true, quiet: true }).level).toBe("warn");
  });

  it("reads no REVIEWER_LOG_LEVEL: the level is the command line's to say", () => {
    // A variable of that name is not a convention this tool owns; it is ignored like any other.
    expect(settle({}, { REVIEWER_LOG_LEVEL: "error" }).level).toBe("info");
  });

  it("takes a runner's own debug switch as the request for debug that it is", () => {
    expect(settle({}, { RUNNER_DEBUG: "1" }).level).toBe("debug");
    expect(settle({}, { ACTIONS_STEP_DEBUG: "true" }).level).toBe("debug");
    // ...but not over an explicit request for quiet.
    expect(settle({ quiet: true }, { RUNNER_DEBUG: "1" }).level).toBe("warn");
  });

  it("turns the record around a message on exactly when the level is debug", () => {
    expect(settle({ verbose: true }).detailed).toBe(true);
    expect(settle({}, { RUNNER_DEBUG: "1" }).detailed).toBe(true);
    expect(settle({ level: "info" }).detailed).toBe(false);
  });
});

describe("the shape of a line", () => {
  it("is text off a runner and workflow commands on one", () => {
    expect(settle().format).toBe("text");
    expect(settle({}, { GITHUB_ACTIONS: "true" }).format).toBe("github");
  });

  it("lets the flag override what was inferred", () => {
    expect(settle({ format: "json" }, { GITHUB_ACTIONS: "true" }).format).toBe("json");
    expect(settle({ format: "text" }, { GITHUB_ACTIONS: "true" }).format).toBe("text");
  });

  it("reads no REVIEWER_LOG_FORMAT: the shape is the flag's or the surroundings'", () => {
    expect(settle({}, { REVIEWER_LOG_FORMAT: "json" }).format).toBe("text");
  });
});

describe("colour", () => {
  it("follows what the process supports when nothing says otherwise", () => {
    expect(settle({}, {}, true).color).toBe(true);
    expect(settle({}, {}, false).color).toBe(false);
  });

  it("lets --no-color and --color outrank what the process supports", () => {
    expect(settle({ color: false }, {}, true).color).toBe(false);
    expect(settle({ color: true }, {}, false).color).toBe(true);
  });

  it("never colours a shape that is parsed or coloured by someone else", () => {
    expect(settle({ format: "json" }, {}, true).color).toBe(false);
    expect(settle({ format: "github" }, {}, true).color).toBe(false);
  });
});

/** The variables picocolors reads; cleared before each case and restored after. */
const COLOR_VARIABLES = ["NO_COLOR", "FORCE_COLOR", "TERM", "CI"] as const;

describe("picocolors' verdict, which colour follows by default", () => {
  const saved: Partial<Record<(typeof COLOR_VARIABLES)[number], string | undefined>> = {};
  let generation = 0;

  beforeEach(() => {
    for (const name of COLOR_VARIABLES) {
      saved[name] = process.env[name];
      Reflect.deleteProperty(process.env, name);
    }
  });

  afterEach(() => {
    for (const name of COLOR_VARIABLES) {
      if (saved[name] === undefined) Reflect.deleteProperty(process.env, name);
      else process.env[name] = saved[name];
    }
  });

  /** Whether colour is on for `process.env` as it stands, picocolors re-evaluated by a cache-busting import. */
  async function isColored(environment: Record<string, string>): Promise<boolean> {
    Object.assign(process.env, environment);
    const fresh = (await import(`picocolors?case=${++generation}`)) as {
      default: { isColorSupported: boolean };
    };
    return settle({}, {}, fresh.default.isColorSupported).color;
  }

  it("honours NO_COLOR when non-empty, above FORCE_COLOR", async () => {
    expect(await isColored({ NO_COLOR: "1", FORCE_COLOR: "1" })).toBe(false);
    expect(await isColored({ NO_COLOR: "0", FORCE_COLOR: "1" })).toBe(false);
    // Empty is unset, which is what no-color.org asks for.
    expect(await isColored({ NO_COLOR: "", FORCE_COLOR: "1" })).toBe(true);
  });

  it("reads any non-empty FORCE_COLOR, even 0, as forcing colour on", async () => {
    expect(await isColored({ FORCE_COLOR: "1" })).toBe(true);
    expect(await isColored({ FORCE_COLOR: "0" })).toBe(true);
  });

  it("refuses a dumb terminal unless colour is forced or the run is on CI", async () => {
    expect(await isColored({ TERM: "dumb" })).toBe(false);
    expect(await isColored({ TERM: "dumb", FORCE_COLOR: "1" })).toBe(true);
    expect(await isColored({ TERM: "dumb", CI: "true" })).toBe(true);
  });
});

describe("secrets", () => {
  it("collects the values of variables whose name says they hold one", () => {
    const found = secretsFrom({
      ANTHROPIC_API_KEY: "sk-ant-abcdefgh",
      GITHUB_TOKEN: "ghp_0123456789",
      LLM_BASE_URL: "http://127.0.0.1:1234/v1",
    });
    expect(found).toContain("sk-ant-abcdefgh");
    expect(found).toContain("ghp_0123456789");
    expect(found).not.toContain("http://127.0.0.1:1234/v1");
  });

  it("leaves a value too short to be a secret alone, so paths are not corrupted", () => {
    // Masking "ts" would rewrite every path in every log line.
    expect(secretsFrom({ MY_TOKEN: "ts" })).toEqual([]);
  });

  it("orders longest first, so a prefix cannot mask its way out of a longer secret", () => {
    const found = secretsFrom({ A_TOKEN: "abcdefgh", B_TOKEN: "abcdefghijkl" });
    expect(found[0]).toBe("abcdefghijkl");
  });

  it("masks every occurrence, wherever in the message it landed", () => {
    const secrets = secretsFrom({ LLM_API_KEY: "sk-secret-value" });
    expect(redact("auth failed for sk-secret-value (sk-secret-value)", secrets)).toBe(
      `auth failed for ${SECRET_MASK} (${SECRET_MASK})`,
    );
  });

  it("is what settled settings carry, so every rendering redacts the same values", () => {
    expect(settle({}, { LLM_API_KEY: "sk-secret-value" }).secrets).toEqual(["sk-secret-value"]);
  });
});
