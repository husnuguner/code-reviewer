#!/usr/bin/env -S bun --no-env-file
/**
 * The `review-comment` executable.
 *
 * `--no-env-file` for the same reason as `reviewer`: the token arrives in the
 * real environment, and a `.env` in the working directory must not be able
 * to stand in for it.
 *
 * Exit codes: 0 on success, 1 for a usage error, 2 for something the operator
 * can fix (an unreadable findings file, a missing token, a refusal from the
 * hosting system). An unexpected error keeps its stack trace: that one is
 * ours to fix.
 */

import { main } from "./comment";

process.exitCode = await main(process.argv.slice(2));
