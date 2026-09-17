# Skill library

Review skills for the reviewer to apply on top of its four built-in lenses.
A skill is one Markdown file: a YAML frontmatter with a `name` (its id) and an
optional `description`, then the guidance text that is injected into the review
prompt for the files it applies to.

    ---
    name: medusa-route
    description: Review MedusaJS 2.x API route files.
    ---
    Guidance text for matching files.

## Where they live

Wherever the catalogue's `skills.path` points: a directory on the reviewer's
machine (`~/.config/reviewer/skills`, the usual choice -- read the same way in
every flow) or, with a relative path, inside the reviewed repository (PR review
reads it at the PR's head commit, branch review from the local checkout). This
folder is the library you copy from.

## Which files a skill reviews

The mapping lives in the reviewer's catalogue, on the project (the directory
is usually shared through `defaults.skills.path`):

    "skills": {
      "mappings": {
        "medusa-route": ["src/api/**/route.ts"],
        "medusa-links": []          // present, but switched off
      }
    }

A skill mapped nowhere never applies, and the run says so. The files carry no
scope of their own -- `applies_to` in a frontmatter is not read -- so the
mapping is the one place to look. The complete mapping for this library is in
[`docs/config.example.yaml`](../config.example.yaml).

## Medusa (`medusa/`)

| `medusa-auth` | Review MedusaJS 2.x route authentication, actor identity, and ownership handling for security correctness. |
| `medusa-conventions` | Cross-layer backend conventions — mutation method, enums, MedusaError codes, export style, layer dependency direction, DRY gate. Applies to every backend TS file alongside its layer skill. |
| `medusa-links` | Review MedusaJS 2.x module link definitions for file layout, cascade/filterable/isList options, ordering, and lifecycle management. |
| `medusa-model` | Review MedusaJS 2.x DML models, relation-vs-pointer choice, indexes, enums, DTO triplets, and migration safety. |
| `medusa-module` | Review MedusaJS 2.x module layout, module service, helper services, pure utils, state machine, and medusa-config wiring. |
| `medusa-provider` | Review MedusaJS 2.x provider contracts, default implementations, loaders, provider facade services, and their medusa-config wiring. |
| `medusa-route` | Review MedusaJS 2.x API route files — handler shape, input sources, workflow-for-writes, reads, status codes, response envelope, and errors. |
| `medusa-scheduled-job` | Review MedusaJS 2.x scheduled jobs — file and config shape, schedule source, tuning constants, batching, alerting, and error handling. |
| `medusa-subscriber` | Review MedusaJS 2.x event subscribers and PubSub handlers — file shape, reliability, idempotency, skip-vs-fail semantics, and event naming. |
| `medusa-validation` | Review MedusaJS 2.x Zod validation schemas, list params/configs, and the middleware registry entries that bind them to routes. |
| `medusa-workflow` | Review MedusaJS 2.x workflows and steps — naming, step verbs, composition-body legality, compensation shapes, entity locks, and the pitfalls tsc misses. |

This README has no frontmatter, so the loader ignores it.
