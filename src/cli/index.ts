/**
 * The `reviewer` executable.
 *
 * Exit codes: 0 on success, 1 for a refused `init`/empty `projects` or a usage
 * error, 2 for a configuration or working-tree problem the operator can fix.
 * An unexpected error keeps its stack trace: that one is ours to fix.
 */

import { main } from "./run";

process.exitCode = await main(process.argv.slice(2));
