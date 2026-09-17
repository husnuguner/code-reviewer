# The reviewer ships no skills of its own

> Amended by [ADR 0005](0005-skill-scope-in-the-catalogue.md): a project's `skills.path` may also name a directory on the reviewer's machine (typically `~/.config/reviewer/skills`), and which files a skill reviews is stated in the catalogue rather than in the skill.

We built an embedded skill library -- eleven MedusaJS files -- shipped inside
the package and loaded on every run. It is removed. Skills are read only from
the reviewed repository, at a repo-relative path named by the project
(`.review/skills`), resolved at the head of the change under review.

The library was correct while the reviewer served one repository and became
wrong the moment it served several: every project loaded every bundled skill,
and a skill applies by path glob, not by framework. `src/api/**/route.ts` is
not Medusa-exclusive, so an unrelated TypeScript repository could draw Medusa
guidance into its review. Per-project opt-in would have fixed that, but the
deeper point survives it: a review rule is the _reviewed repository's_ stated
convention, so it belongs in that repository, versioned with the code it
governs. A pull request that changes a convention can then change its rule in
the same commit, and the reviewer applies the rule as of that commit.

## Consequences

A project that names no skills path is reviewed by the four lenses alone. That
is a supported configuration, not a misconfiguration, so each run logs how
many skills were loaded and from where rather than staying silent about it.

The eleven MedusaJS skills are not deleted work: they are kept as a worked
example in `docs/example-skills/` and move into the repository whose
conventions they describe. They were always that repository's knowledge rather
than the reviewer's, which is the whole argument for this change.
