/**
 * The same wait every time. `new ConstantBackoff(0)` spells "retry immediately".
 * @packageDocumentation
 */

import { type IBackoff } from "./backoff.abstraction";

/** A constant schedule; `next()` returns itself. */
export class ConstantBackoff implements IBackoff<unknown> {
  constructor(readonly duration: number) {}

  next(): IBackoff<unknown> {
    return this;
  }
}
