/**
 * `fetch` as this program calls it: with a `URL`, never a string.
 *
 * The type is the guard. A string can come from anywhere; a `URL` is produced
 * by a client's own allowlist check, so nothing that skipped the check can
 * reach the network -- the compiler says so.
 *
 * It lives here rather than beside the one client that declares one because
 * the decorator in this directory is typed `FetchLike -> FetchLike`: a
 * wrapper that widened the signature back to `RequestInfo` would quietly undo
 * the guarantee it was wrapped around, and having both halves name one type
 * is what makes that impossible rather than merely unlikely.
 */
export type FetchLike = (input: URL, init: RequestInit) => Promise<Response>;
