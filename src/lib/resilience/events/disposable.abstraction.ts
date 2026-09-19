/**
 * What every subscription hands back.
 * @packageDocumentation
 */

/** Something that can be undone. */
export interface IDisposable {
  /** Undoes the subscription. Safe to call more than once. */
  dispose(): void;
}
