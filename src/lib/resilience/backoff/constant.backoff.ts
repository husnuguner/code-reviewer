/**
 * The same wait, every time.
 *
 * Its own factory and its own chain: `next()` returns itself, because a
 * constant sequence has nothing to carry forward. `new ConstantBackoff(0)` is
 * also how a policy spells "retry immediately" without special-casing the
 * absence of a backoff.
 */

import { type IBackoff } from "./backoff.abstraction";

export class ConstantBackoff implements IBackoff<unknown> {
  constructor(readonly duration: number) {}

  next(): IBackoff<unknown> {
    return this;
  }
}
