#!/usr/bin/env -S bun --no-env-file
/**
 * The `reviewer` executable.
 *
 * `--no-env-file`: Bun would otherwise read the working directory's `.env`
 * into the process environment before this line runs. The reviewer reads
 * `.env` files itself, in a stated order (see `infra/config/loader`), and
 * the working directory it runs in is the checkout under review.
 *
 * Exit codes: 0 on success, 1 for a refused `init`/empty `projects` or a usage
 * error, 2 for a configuration or working-tree problem the operator can fix.
 * An unexpected error keeps its stack trace: that one is ours to fix.
 */

import { main } from "./run";

process.exitCode = await main(process.argv.slice(2));
