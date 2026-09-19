/**
 * `fetch` as this program calls it: with a `URL`, never a string, so only a client's own allowlist can
 * produce a destination.
 * @packageDocumentation
 */

/** A `fetch` that takes a `URL`. */
export type FetchLike = (input: URL, init: RequestInit) => Promise<Response>;
