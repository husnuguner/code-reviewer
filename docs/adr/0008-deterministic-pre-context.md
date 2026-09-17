# The reviewer fetches context for the model; the model asks for none

## Context

A per-file review sees a patch and, for a small change, the file. Whatever
the diff does not show -- what a called function takes and returns, who else
uses a symbol whose signature changed, whether the sibling file was updated
too -- the model can only assume, and an assumed premise is where a wrong
finding comes from.

`alibaba/open-code-review` answers this with tool use: the model reads and
searches the repository during the review, over several turns. That buys
recall at the price of the two things this reviewer is built on -- one model
call per file, and a posting pipeline whose inputs are fixed before the model
speaks. The analysis is in `docs/open-code-review-d4-analiz.md`.

## Decision

The reviewer gathers context **before** the call, deterministically, and
puts it in the prompt as one more block. Three kinds, most valuable first:

1. **Definitions.** For each local module the added lines import, the
   exported signatures of that module (each `export` line with its doc
   comment), resolved with the usual TypeScript/JavaScript suffixes.
2. **Usages.** For each exported symbol the patch adds, removes or edits, the
   other files that mention it -- paths only.
3. **Related changes.** The diffs of the other changed files in the same
   directory or with the same stem.

The block is capped (`max-context-chars`, default 6000; `0` disables), cut on
a section boundary, and any failure to fetch costs that item only. The
output contract gains one sentence: such material informs the judgement and
is never the subject of a finding nor quoted in `existing_code`.

Reading is behind a new port, `CodeContext` (`readFile`, `search`), bound to
the ref under review. Two adapters: local git (`git show <ref>:<path>`,
`git grep -w <ref>`) for branch review; the repo provider for pull request
review, which reads any file at the head SHA but searches only the change
set -- a hosting API's code search indexes the default branch, and answering
about the wrong code would be worse than answering less.

## Consequences

- The review stays one call; anchoring, dedup, posting and every parity
  fixture are untouched. The heuristics are regex-level and TypeScript-first;
  other languages get the "related changes" block and little else until the
  patterns are widened.
- Pull request review sees fewer usages than branch review. The gap is
  documented and measurable; closing it (a tree listing plus selective reads,
  or a tarball at the head) is a later, measured step.
- This is the floor the hybrid "explorer + judge" design (S4 in the analysis)
  would build on: the port and the block exist; an explorer would add to the
  block, the judge call would not change.
