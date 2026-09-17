/**
 * Loader for the behavioural contract fixtures in `tests/fixtures/`.
 *
 * Each fixture file freezes one module's input/output pairs. A case whose
 * `expected` is `{ error, message }` is an error contract: the call must throw
 * an error of that class name (and, when the message is asserted, with that
 * message). A case carrying `divergence` documents a behaviour this
 * implementation intentionally does not reproduce; the module's contract test
 * handles those explicitly rather than skipping them silently.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { expect } from "vitest";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");

export interface FixtureCase<I = unknown, E = unknown> {
  name: string;
  input: I;
  expected: E;
  divergence?: string;
}

export interface ErrorContract {
  error: string;
  message?: string;
}

export function loadFixture<I = unknown, E = unknown>(module: string): FixtureCase<I, E>[] {
  const raw = readFileSync(join(FIXTURES, `${module}.json`), "utf8");
  const parsed = JSON.parse(raw) as { module: string; cases: FixtureCase<I, E>[] };
  return parsed.cases;
}

export function isErrorContract(expected: unknown): expected is ErrorContract {
  return (
    typeof expected === "object" &&
    expected !== null &&
    !Array.isArray(expected) &&
    typeof (expected as { error?: unknown }).error === "string" &&
    Object.keys(expected).every((k) => k === "error" || k === "message")
  );
}

/** Cases whose names start with `prefix/`, with the prefix removed. */
export function casesUnder<I = unknown, E = unknown>(
  cases: FixtureCase[],
  prefix: string,
): FixtureCase<I, E>[] {
  const head = `${prefix}/`;
  return cases
    .filter((c) => c.name.startsWith(head))
    .map((c) => ({ ...c, name: c.name.slice(head.length) }) as FixtureCase<I, E>);
}

/**
 * Assert that `run` matches a case's expectation: equal output, or an error of
 * the expected class (message compared when `exactMessage` is set).
 */
export function expectContract(
  run: () => unknown,
  expected: unknown,
  options: { exactMessage?: boolean } = {},
): void {
  if (isErrorContract(expected)) {
    let thrown: unknown;
    try {
      run();
    } catch (error) {
      thrown = error;
    }
    expect(thrown, `expected ${expected.error} to be thrown`).toBeInstanceOf(Error);
    expect((thrown as Error).name).toBe(expected.error);
    if (options.exactMessage && expected.message !== undefined) {
      expect((thrown as Error).message).toBe(expected.message);
    }
    return;
  }
  expect(run()).toEqual(expected);
}
