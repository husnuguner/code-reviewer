# Branch review reads the diff from local git

Branch review used to synthesise its diff over the network: list both trees,
compare blob SHAs, then fetch the base and head text of every changed file and
build a unified diff locally. It now runs `git merge-base` and
`git diff base...branch` in the working tree instead.

The network version cost two full tree listings plus two file fetches per
changed file, and -- worse -- it was the most provider-specific code we had.
Tree listing with blob SHAs and merge-base by commit-list intersection is code
that every new repo provider would have to reinvent in its own API. Reading
local git costs nothing per file, deletes that code, and leaves branch review
working on providers we have not implemented at all.

## Consequences

The reviewer used to need no clone: you pointed it at `owner/repo` and it
never touched a local repository. Branch review now requires a checkout and
runs against the current working directory (or `REVIEW_LOCAL_PATH`). PR review
is unaffected -- providers hand us the per-file patch in one call -- so the
primary flow keeps the remote-only property and only the local pre-PR check
gives it up.

In exchange, branch review no longer requires the branch to be _pushed_, which
was never something the use case wanted; it was an artefact of fetching the
diff from a server. Real `git diff` also brings rename detection and correct
hunk context, which our synthesised diff did not have.
