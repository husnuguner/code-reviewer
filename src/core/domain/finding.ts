/**
 * One review finding and where it may be posted.
 *
 * A finding is one defensible problem in changed code, carrying its own
 * severity and the evidence that locates it. It is produced per file, anchored
 * to a line before it can be posted, and survives review even when no line
 * could be established -- an unanchored finding is reported, not discarded.
 *
 * Field names are the wire spelling (`start_line`, `existing_code`) because a
 * finding is emitted as-is in NDJSON branch-review output.
 */

import { type AnchorOutcome } from "../review/anchor";

export interface Finding {
  /** The commentable line, or `null` when none could be established. */
  readonly line: number | null;
  readonly severity: string;
  readonly body: string;
  /** Optional short fix snippet (code only). */
  readonly example: string;
  /** Set only for a multi-line anchor: the first line of the span. */
  readonly start_line: number | null;
  /** How the line was decided; what the run counters report. */
  readonly anchor: AnchorOutcome;
  /** The model's verbatim quote that helped place the finding. */
  readonly existing_code: string;
}

/** Build a finding with the defaults an unanchored/plain finding takes. */
export function finding(
  fields: Pick<Finding, "line" | "severity" | "body"> & Partial<Finding>,
): Finding {
  return {
    example: "",
    start_line: null,
    anchor: "exact",
    existing_code: "",
    ...fields,
  };
}
