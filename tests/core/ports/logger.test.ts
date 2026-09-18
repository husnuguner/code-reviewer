/**
 * The null logger: the default every module falls back to.
 *
 * Almost nothing in `core/` is handed a logger, so nearly every log line in
 * the program is written against this object. Two of its properties are load
 * bearing and neither is obvious: it must discard rather than print, and
 * `child()` must answer with a logger rather than with nothing -- every
 * module opens with `(options.logger ?? NULL_LOGGER).child("...")`, so a
 * `child` that returned `undefined` would turn the no-logger path into a
 * crash on the first line anyone tried to log.
 */

import { describe, expect, it } from "bun:test";

import { NULL_LOGGER } from "../../../src/core/ports/logger";

describe("the null logger", () => {
  it("accepts every level without writing anywhere", () => {
    expect(() => {
      NULL_LOGGER.debug("d");
      NULL_LOGGER.info("i");
      NULL_LOGGER.warn("w");
      NULL_LOGGER.error("e");
    }).not.toThrow();
  });

  it("answers child() with itself, however deep the naming goes", () => {
    // The shape `(options.logger ?? NULL_LOGGER).child("review.x")` takes.
    expect(NULL_LOGGER.child("review")).toBe(NULL_LOGGER);
    expect(NULL_LOGGER.child("review").child("selection").child("deeper")).toBe(NULL_LOGGER);
  });

  it("stays usable after being named", () => {
    expect(() => {
      NULL_LOGGER.child("review.selection").info("skip a.ts");
    }).not.toThrow();
  });
});
