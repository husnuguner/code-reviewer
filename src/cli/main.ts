#!/usr/bin/env -S bun --no-env-file
/**
 * The `reviewer` executable: the process entry, and nothing else.
 *
 * `--no-env-file`: Bun would otherwise read the working directory's `.env`
 * into the process environment before this line runs. The reviewer reads
 * `.env` files itself, in a stated order (see `providers/config/environment-files`), and
 * the working directory it runs in is the checkout under review. The same
 * flag keeps a `.env` from standing in for `comment`'s token.
 *
 * Exit codes: 0 on success, 1 for a usage error or a refused `init`/empty
 * `projects`, 2 for a problem the operator can fix (configuration, working
 * tree, a hosting system's refusal), 3 when a review found something
 * `--fail-on` named. An unexpected error keeps its stack trace: that one is
 * ours to fix.
 */

import { main } from "./reviewer";

process.exitCode = await main(process.argv.slice(2));
