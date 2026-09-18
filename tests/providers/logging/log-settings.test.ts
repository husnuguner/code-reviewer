/**
 * What the operator asked of the logs: which source wins, and what each
 * convention (`NO_COLOR`, `RUNNER_DEBUG`, `FORCE_COLOR`) is worth against
 * the others.
 */

import { describe, expect, it } from "bun:test";

import {
  type LoggingFlags,
  SECRET_MASK,
  parseLogLevel,
  redact,
  resolveLogSettings,
  secretsFrom,
} from "../../../src/providers/logging/log-settings";

/** Settings from flags and an environment, off a terminal unless said. */
function settle(
  flags: LoggingFlags = {},
  environment: Record<string, string | undefined> = {},
  isTTY = false,
): ReturnType<typeof resolveLogSettings> {
  return resolveLogSettings(flags, { environment, isTTY });
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

  it("falls back to REVIEWER_LOG_LEVEL, which a flag still outranks", () => {
    expect(settle({}, { REVIEWER_LOG_LEVEL: "error" }).level).toBe("error");
    expect(settle({ verbose: true }, { REVIEWER_LOG_LEVEL: "error" }).level).toBe("debug");
  });

  it("ignores a level nobody defined rather than failing the run", () => {
    expect(settle({}, { REVIEWER_LOG_LEVEL: "chatty" }).level).toBe("info");
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

describe("parseLogLevel", () => {
  it("forgives case and accepts the name a Python-shaped log uses", () => {
    expect(parseLogLevel(" DEBUG ")).toBe("debug");
    expect(parseLogLevel("warning")).toBe("warn");
    expect(parseLogLevel("")).toBeNull();
    expect(parseLogLevel(undefined)).toBeNull();
  });
});

describe("the shape of a line", () => {
  it("is text off a runner and workflow commands on one", () => {
    expect(settle().format).toBe("text");
    expect(settle({}, { GITHUB_ACTIONS: "true" }).format).toBe("github");
  });

  it("lets the flag and the environment override what was inferred", () => {
    expect(settle({ format: "json" }, { GITHUB_ACTIONS: "true" }).format).toBe("json");
    expect(settle({}, { REVIEWER_LOG_FORMAT: "json" }).format).toBe("json");
    expect(settle({ format: "text" }, { GITHUB_ACTIONS: "true" }).format).toBe("text");
  });
});

describe("colour", () => {
  it("follows the terminal when nothing says otherwise", () => {
    expect(settle({}, {}, true).color).toBe(true);
    expect(settle({}, {}, false).color).toBe(false);
  });

  it("honours NO_COLOR whatever its value, and TERM=dumb", () => {
    expect(settle({}, { NO_COLOR: "1" }, true).color).toBe(false);
    expect(settle({}, { NO_COLOR: "0" }, true).color).toBe(false);
    // Empty is unset, which is what no-color.org asks for.
    expect(settle({}, { NO_COLOR: "" }, true).color).toBe(true);
    expect(settle({}, { TERM: "dumb" }, true).color).toBe(false);
  });

  it("lets FORCE_COLOR and CLICOLOR_FORCE demand colour off a terminal", () => {
    expect(settle({}, { FORCE_COLOR: "1" }, false).color).toBe(true);
    expect(settle({}, { CLICOLOR_FORCE: "1" }, false).color).toBe(true);
    expect(settle({}, { FORCE_COLOR: "0" }, false).color).toBe(false);
  });

  it("keeps NO_COLOR above FORCE_COLOR, so a preference is not overridden by a build image", () => {
    expect(settle({}, { NO_COLOR: "1", FORCE_COLOR: "1" }, true).color).toBe(false);
  });

  it("lets --no-color outrank every variable, including FORCE_COLOR", () => {
    expect(settle({ color: false }, { FORCE_COLOR: "1" }, true).color).toBe(false);
  });

  it("never colours a shape that is parsed or coloured by someone else", () => {
    expect(settle({ format: "json" }, { FORCE_COLOR: "1" }, true).color).toBe(false);
    expect(settle({ format: "github" }, { FORCE_COLOR: "1" }, true).color).toBe(false);
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
