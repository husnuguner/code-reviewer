# Context

The domain vocabulary of this repo. Glossary only — no implementation detail,
no configuration keys, no file layout. If a term here and the code disagree,
one of them is wrong and it is worth finding out which.

## Project

A **named, reviewable target**: one checkout, together with the review rules
that apply to it. A Project is what `--project <name>` selects, and exactly
one Project is in scope for a run.

A Project is not the repository itself. The same repository reviewed under two
different rule sets is two Projects.

A Project names no hosting system and no credential. This reviewer reads local
git, so what identifies a Project's target is a path on disk (`local-path`,
defaulting to the current directory) — which is also why a CI job needs no
Project at all: it has already checked the code out.

## Report

**What a run produces, and the end of its responsibility.** A Report is the
findings plus the tallies that make them accountable: how each was anchored,
how many verification refuted, how many the volume policy withheld, how many
arrived under a severity that had to be overruled, how many files were shown
only part of their diff, how many never came back at all, and what happened to
every file that was not reviewed.

The tallies are answerable, not decorative: what a run reviewed, what failed
and what it skipped add up to what changed, and every per-finding tally counts
the findings that were reported rather than a wider set nobody sees. A number
that mixes two populations is a number a reader cannot check.

A Report is not a comment, and the reviewer does not become one. Turning a
finding into a comment on a change request is a downstream reader's job (a CI
bot reading the NDJSON), which is what keeps the process that reads untrusted
diff text away from anything that can write. Three renderings exist — text,
NDJSON, GitHub Actions annotations — and they say the same thing.

## Repository

The **hosting-side repository a Report is posted to**, identified as
`owner/name` on GitHub.

Deliberately absent from the review itself. The reviewer reads a checkout and
knows no Repository; only the CI bot that turns a Report into review comments
needs one, because only it talks to a hosting system. When a Repository
appears in this codebase it is therefore a posting concern, never a reviewing
one — and a change that gives the reviewer a Repository is a change that has
crossed the one line this design draws.

## Selection

The **decision of which changed files a run reviews, and why each of the
others it does not**. Taken for the whole change set before anything is
prompted, from the change set and the project's settings alone.

A Selection is not a filter applied on the way past. Every file of the change
set comes out of it carrying an outcome, so a file that was not reviewed is a
file with a stated reason rather than a file nobody mentioned.

It answers only what is knowable before the work begins. Whether a model
replied, whether a Finding survived Verification, whether a call failed — none
of that is scope, and a Selection that claimed to know it could not be trusted
by the run that acts on it.

There is exactly one Selection per run, and both the run and its preview read
that one. Two computations of the same scope are two answers, and the cheap
one would eventually start lying about the expensive one.

## Volume policy

**How many findings one file is allowed to report.** Not a judgement about
whether a finding is right — Verification answers that — but about how much of
a right answer a reader can absorb. When it bites, the most severe survive.

What it withholds is **counted**, never hidden. A cap whose effect nobody can
measure is a cap nobody can trust, so a run states how many findings it kept
back for this reason alongside how many it reported.

## Finding

One **defensible problem in changed code**, carrying its own severity and the
evidence that locates it. A Finding is produced per file, is anchored to a line
before it can be posted, and survives review even when no line could be
established — an unanchored Finding is reported, not discarded.

Its severity is the reviewer's vocabulary, not the model's invention. A value
the vocabulary has not got costs the Finding nothing — it is kept — but it is
overruled to the mildest severity, and the claim it made travels with it so
the overruling can be counted rather than quietly rewriting how a reader ranks
it.

A Finding is not a comment. It may become one downstream, and the volume
policy may decide it is not even reported.

## Verification

The **second judgement a Finding must survive: whether the diff it came from
refutes it.** Verification is asked of the changed file's own diff and the
Findings written from it, and it can do exactly one thing — remove. It never
rewrites a Finding, re-rates it, or moves it.

Verification is not filtering. Volume, severity and duplication are the
posting policy's business; verification answers only "is this false", and
only where the diff itself settles the question. "I cannot tell" is a
survival, not a removal — the cost of deleting a true Finding is silent and
the cost of keeping a false one is a few seconds, so the doubt is spent on
keeping.

A Finding it removes is **refuted**. A run reports how many were, because a
second judgement nobody measures is a second judgement nobody can trust.

## Skill

One **file of review guidelines scoped to a set of path globs**. A Skill
applies to a changed file when one of its globs matches that file's path;
matching Skills are injected into that file's review in addition to the
standing lenses. A file matching no Skill is still reviewed.

Skills belong to the **repository whose code they govern**, not to the
reviewer. They are that repository's own stated conventions, so they are
versioned with the code and a change to a convention can travel in the same
change as the code that follows it. The reviewer ships none of its own.

A Project with no Skills is not misconfigured: it is reviewed by the Lenses
alone.

## Lens

One of the **standing review concerns** applied to every changed file
regardless of path: correctness, security, performance, readability. Lenses are
universal where Skills are conditional.

## Anchor

The **decision of which line a Finding is posted on**, and the record of how
that decision was reached. Derived from two independent signals — the line the
model reported and the code it quoted — so that one being wrong does not cost
the Finding.

Both signals are read against the diff the model was actually shown. A diff too
large to show in full is cut at a hunk boundary, and the lines a Finding may
anchor to are the lines that survived that cut: a reviewer that allowed more
would be inviting a Finding about code it never sent.
