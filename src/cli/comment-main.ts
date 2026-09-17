/**
 * The `review-comment` executable.
 *
 * Exit codes: 0 on success, 1 for a usage error, 2 for something the operator
 * can fix (an unreadable findings file, a missing token, a refusal from the
 * hosting system). An unexpected error keeps its stack trace: that one is
 * ours to fix.
 */

import { main } from "./comment";

process.exitCode = await main(process.argv.slice(2));
