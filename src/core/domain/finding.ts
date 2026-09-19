/**
 * One review finding. Field names are the NDJSON wire spelling.
 * @packageDocumentation
 */

import { type AnchorOutcome } from "../review/anchor";

/** One defensible problem in changed code, with the evidence that locates it. */
export interface Finding {
  /** The commentable line, or `null` when none could be established. */
  readonly line: number | null;
  /** `bug`, `security`, `performance` or `readability`. */
  readonly severity: string;
  /** The comment text. */
  readonly body: string;
  /** A short fix snippet (code only), or `""`. */
  readonly example: string;
  /** First line of a multi-line anchor; `null` for a single line. */
  readonly start_line: number | null;
  /** How the line was decided. */
  readonly anchor: AnchorOutcome;
  /** The model's verbatim quote used to place the finding. */
  readonly existing_code: string;
  /** The severity the model named when it is outside the vocabulary; `""` otherwise. */
  readonly severity_claimed: string;
}

/**
 * Builds a finding with defaults for the optional fields.
 *
 * @param fields - `line`, `severity` and `body`, plus any override.
 * @returns A finding anchored `exact` with no example, quote or claimed severity unless given.
 */
export function finding(
  fields: Pick<Finding, "line" | "severity" | "body"> & Partial<Finding>,
): Finding {
  return {
    example: "",
    start_line: null,
    anchor: "exact",
    existing_code: "",
    severity_claimed: "",
    ...fields,
  };
}
