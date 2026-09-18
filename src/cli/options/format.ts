/**
 * The renderings `--format` may name.
 *
 * Built once, at module scope, because the command line is parsed before any
 * container exists: `--format` has to be validated against the same registry
 * the composition root later builds through, or the two could disagree about
 * what a valid format is.
 */

import { builtinFormatProviders } from "../../providers/reporting/builtin";
import { type ReportFormat } from "../container";

export const REPORT_FORMATS = builtinFormatProviders();

/** The rendering a run takes when `--format` is not given: the first registered. */
export const DEFAULT_FORMAT: ReportFormat = REPORT_FORMATS.defaultName();
