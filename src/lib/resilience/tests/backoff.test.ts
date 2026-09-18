/**
 * How long a policy waits, and why two clients do not wait the same.
 *
 * The exponential windows are a table, because they are pure arithmetic over
 * one injected random; the chain's own behaviour -- that a factory is
 * reusable and a walk is not shared -- is asserted below it, because that is
 * the part a table cannot show.
 *
 * The table is written here rather than loaded from `tests/fixtures/`, and
 * that is the same decision as this folder's existence: `lib/` is meant to be
 * liftable out of this repository whole. A library whose tests only run
 * inside one application's harness is a library that has not been shown to
 * stand on its own.
 */

import { describe, expect, it } from "bun:test";

import {
  ConstantBackoff,
  ExponentialBackoff,
  type IBackoffFactory,
  fullJitter,
  noJitter,
} from "../index";

interface WindowCase {
  readonly name: string;
  readonly baseMs: number;
  readonly maxMs: number;
  readonly attempt: number;
  readonly random: number;
  readonly expected: number;
}

/**
 * One row per claim about the schedule; `random` pins where in the window.
 *
 * Mutable by necessity: `it.each` takes only a mutable table.
 */
const WINDOWS: WindowCase[] = [
  {
    name: "the first window spans zero to the base",
    baseMs: 500,
    maxMs: 20_000,
    attempt: 1,
    random: 1,
    expected: 500,
  },
  {
    name: "the window starts at zero",
    baseMs: 500,
    maxMs: 20_000,
    attempt: 1,
    random: 0,
    expected: 0,
  },
  {
    name: "it is uniform across the window",
    baseMs: 500,
    maxMs: 20_000,
    attempt: 1,
    random: 0.5,
    expected: 250,
  },
  {
    name: "the window doubles each attempt",
    baseMs: 500,
    maxMs: 20_000,
    attempt: 2,
    random: 1,
    expected: 1000,
  },
  { name: "and keeps doubling", baseMs: 500, maxMs: 20_000, attempt: 3, random: 1, expected: 2000 },
  {
    name: "a quarter of the fourth window",
    baseMs: 500,
    maxMs: 20_000,
    attempt: 4,
    random: 0.25,
    expected: 1000,
  },
  {
    name: "the last window under the cap",
    baseMs: 500,
    maxMs: 20_000,
    attempt: 6,
    random: 1,
    expected: 16_000,
  },
  { name: "the cap bites", baseMs: 500, maxMs: 20_000, attempt: 7, random: 1, expected: 20_000 },
  {
    name: "and keeps biting, however many attempts",
    baseMs: 500,
    maxMs: 20_000,
    attempt: 20,
    random: 1,
    expected: 20_000,
  },
  {
    name: "waits are whole milliseconds",
    baseMs: 333,
    maxMs: 20_000,
    attempt: 1,
    random: 0.5,
    expected: 167,
  },
  {
    name: "a cap below the base wins",
    baseMs: 5000,
    maxMs: 1000,
    attempt: 1,
    random: 1,
    expected: 1000,
  },
  { name: "a zero base never waits", baseMs: 0, maxMs: 20_000, attempt: 5, random: 1, expected: 0 },
];

/** The `attempt`-th wait of a chain, by walking it. */
function walkTo(factory: IBackoffFactory<unknown>, attempt: number): number {
  let step = factory.next(undefined);
  for (let index = 1; index < attempt; index++) step = step.next(undefined);
  return step.duration;
}

describe("the exponential windows", () => {
  it.each(WINDOWS)("$name", (windowCase) => {
    const backoff = new ExponentialBackoff({
      initialDelay: windowCase.baseMs,
      maxDelay: windowCase.maxMs,
      generator: fullJitter,
      random: () => windowCase.random,
    });
    expect(walkTo(backoff, windowCase.attempt)).toBe(windowCase.expected);
  });
});

describe("jitter", () => {
  it("spreads clients across the window rather than lining them up on it", () => {
    // The point of full jitter: two clients failing at the same instant must
    // not wake at the same instant. Without it both would wait exactly 500ms.
    expect(fullJitter(500, () => 0.1)).not.toBe(fullJitter(500, () => 0.9));
  });

  it("leaves the window alone when asked not to jitter", () => {
    expect(noJitter(500, () => 0.1)).toBe(500);
  });
});

describe("the chain", () => {
  it("is reusable: two walks of one factory do not share a position", () => {
    const factory = new ExponentialBackoff({
      initialDelay: 100,
      generator: noJitter,
    });
    // A factory handed to two executions must start both at the first window,
    // or the second caller would inherit the first one's impatience.
    expect(walkTo(factory, 1)).toBe(100);
    expect(walkTo(factory, 1)).toBe(100);
    expect(walkTo(factory, 3)).toBe(400);
  });

  it("is immutable: stepping a wait does not change the wait it came from", () => {
    const first = new ExponentialBackoff({ initialDelay: 100, generator: noJitter }).next();
    const second = first.next(undefined);
    expect(first.duration).toBe(100);
    expect(second.duration).toBe(200);
  });
});

describe("a constant backoff", () => {
  it("answers the same wait for ever, and is its own chain", () => {
    const backoff = new ConstantBackoff(42);
    expect(backoff.duration).toBe(42);
    expect(backoff.next().next(undefined).duration).toBe(42);
  });

  it("spells 'retry immediately' as zero", () => {
    expect(new ConstantBackoff(0).duration).toBe(0);
  });
});
