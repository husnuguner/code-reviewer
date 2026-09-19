/**
 * A comma-separated list of severities, or `none`; shared by `--fail-on` and `--request-changes-on`.
 * @packageDocumentation
 */

import { SEVERITIES, type Severity } from "../../core/review/severity";
import { type OptionParser, choice, listOf } from "../command-line";

/** Parses `bug,security` (case-insensitive) or `none` into canonical severities. */
export const severityList: OptionParser<Severity[]> = listOf(
  choice(SEVERITIES, { label: "severities", caseInsensitive: true }),
  { none: "none" },
);
