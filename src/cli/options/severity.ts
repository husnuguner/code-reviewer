/**
 * A comma-separated list of severities, or `none`.
 *
 * Shared by every flag that gates on severity (`--fail-on`,
 * `--request-changes-on`), so "which words are allowed" is decided once, and
 * decided by the vocabulary rather than by a parser of its own. Spelling is
 * forgiven; what comes back is canonical.
 */

import { SEVERITIES, type Severity } from "../../core/review/severity";
import { type OptionParser, choice, listOf } from "../command-line";

export const severityList: OptionParser<Severity[]> = listOf(
  choice(SEVERITIES, { label: "severities", caseInsensitive: true }),
  { none: "none" },
);
