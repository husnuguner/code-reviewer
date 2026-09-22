# Review skills

Each Markdown file here is one **skill**: a set of review guidelines for a
part of this codebase. When a changed file's path matches a skill's globs,
that skill's text goes into the model's prompt for that file, on top of the
four standing lenses (bug, security, performance, readability). A file that
matches no skill is still reviewed -- by the lenses alone.

A skill:

```markdown
---
name: api-rules
description: Rules for HTTP route files.
---

- Every route validates its input with a schema before reading it.
- `req.body` is never read directly; use the validated payload.
- Authorisation happens in middleware, not inside the handler.
```

`name` is the id. Which files it reviews is decided in `../config.yaml`, not
here, in two tables that add up:

```yaml
skills:
  path: skills # beside config.yaml
  defaults: # the baseline: the skills every matching file is held to
    - globs: ["**/*.ts", "**/*.tsx"]
      skills: [typescript-base]
  mappings: # the extras: skill -> the globs only it reviews
    api-rules: ["src/api/**/*.ts"]
```

`src/api/route.ts` is held to both. A skill named in neither table never
applies. `[]` in `mappings` switches one off, baseline included, without
deleting it. This README is not a skill (no frontmatter) and is ignored.

Keep a skill short and concrete: it is read by a model for every matching
file, and a long one is cut at `skills.max-chars`.
