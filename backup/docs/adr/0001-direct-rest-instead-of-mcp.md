# Talk to repo providers over REST/GraphQL, not MCP

The reviewer once reached GitHub through the official `github-mcp-server` over
stdio, restricted to an eight-tool allowlist. Supporting a second repo provider
forced the question, and MCP lost it: Bitbucket has no equivalent server we
would want to depend on, and no general-purpose official CLI either, so a
second provider meant writing REST regardless. We call each provider's own
HTTP API directly -- the platform `fetch` behind one shared transport
(`infra/repo-providers/http.ts`) that owns authentication headers, retry,
`Retry-After` handling and paging -- which makes every provider the same
shape and removes Docker from the prerequisites of reading a diff.

## Considered options

- **Keep MCP.** Rejected: it made a _second_ provider a different kind of
  problem than the first, and it never carried the weight we hoped -- the
  cursor-paging loop in `review_comments` was ours either way.
- **Shell out to each vendor's CLI (`gh`, `glab`).** Tempting, because `gh`
  brings authentication, retries, SSO and rate-limit handling for free.
  Rejected on two counts: Bitbucket has no such CLI, so the strategy collapses
  at the second provider; and `gh` resolves credentials from its own keyring,
  which would make the `token_env` indirection in `config.json` true only
  sometimes. A process spawn per API call is also the wrong shape for a run
  that fetches file contents file by file.
- **A vendor SDK per provider (Octokit, `@gitbeaker/rest`).** Rejected for the
  same reason as the CLIs, in a milder form: each brings its own retry and
  paging behaviour, so the two providers would not fail the same way. The
  hexagonal port keeps this reversible -- swapping Octokit in behind the
  GitHub adapter would touch one file.

## Consequences

The eight-tool allowlist was a real safety property, and it is gone: the MCP
server enforced it _outside_ our process, so a bug in our code still could
not perform an unauthorised GitHub operation. The equivalent guarantee now
comes from token scope -- a fine-grained PAT limited to _pull requests: write_
and _contents: read_ -- which GitHub enforces server-side. That is arguably a
stronger boundary, but it is no longer enforced by us, and the README's
security claim says so plainly. The shared transport adds one guard of its
own: it refuses to call any origin other than the provider's configured base
URL and its derived GraphQL endpoint.
