/**
 * The renderings `--format` may name; built at module scope so parse-time validation and the
 * composition root use one registry.
 * @packageDocumentation
 */

import { builtinFormatProviders } from "../../providers/reporting/builtin";
import { type ReportFormat } from "../container";

/** The format registry. */
export const REPORT_FORMATS = builtinFormatProviders();

/** The rendering when `--format` is not given: the first registered. */
export const DEFAULT_FORMAT: ReportFormat = REPORT_FORMATS.defaultName();
