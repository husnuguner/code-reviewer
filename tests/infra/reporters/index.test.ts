/**
 * The renderings `--format` may name, exercised through the registry rather
 * than through their classes.
 *
 * This is the path the command line actually takes: `--format` is validated
 * against these names before any container exists, and the composition root
 * builds through the same registry. A format that was declared but not
 * registered, or registered under a name the help text does not mention,
 * would be selectable nowhere or documented wrongly -- and nothing else in
 * the suite looks at the registry at all.
 */

import { describe, expect, it } from "bun:test";

import { type SummaryRecord } from "../../../src/core/ports/review-reporter";
import { type ReportContext } from "../../../src/core/reporting/format-registry";
import { ValueError } from "../../../src/core/util/errors";
import {
  BUILTIN_REPORT_FORMATS,
  builtinReportFormatRegistry,
} from "../../../src/infra/reporters/index";

const SUMMARY: SummaryRecord = {
  type: "summary",
  base: "main",
  branch: "HEAD",
  files_changed: 2,
  files_reviewed: 1,
  findings: 1,
  files_with_findings: 1,
  anchors: { exact: 1 },
  unanchored: 0,
  refuted: 0,
  capped: 0,
  skipped: {},
};

/** A context that collects instead of writing anywhere. */
function sink(): { context: ReportContext; lines: string[]; summaries: string[] } {
  const lines: string[] = [];
  const summaries: string[] = [];
  return {
    lines,
    summaries,
    context: {
      write: (text) => {
        lines.push(text);
      },
      summary: (markdown) => {
        summaries.push(markdown);
      },
    },
  };
}

const FINDING = {
  type: "finding",
  path: "src/a.ts",
  line: 12,
  start_line: null,
  anchor: "exact",
  severity: "bug",
  body: "Null check missing.",
  example: "",
  skills: [],
};

/** One finding and the closing record, as a run produces them. */
function run(reporter: { report: (record: never) => void }): void {
  reporter.report(FINDING as never);
  reporter.report(SUMMARY as never);
}

describe("the built-in report formats", () => {
  const registry = builtinReportFormatRegistry();

  it("registers text, ndjson and github, with text first", () => {
    // The order is the contract: `--format`'s default is the first name, and
    // `--help` lists them in this order.
    expect(registry.names()).toEqual(["text", "ndjson", "github"]);
    expect(BUILTIN_REPORT_FORMATS.map((format) => format.name)).toEqual(registry.names());
  });

  it("describes every format it accepts, so --help cannot drift from it", () => {
    const described = registry.describe();
    for (const name of registry.names()) expect(described).toContain(`'${name}'`);
  });

  it("names the formats that exist when asked for one that does not", () => {
    expect(() => registry.build("xml", sink().context)).toThrow(ValueError);
    expect(() => registry.build("xml", sink().context)).toThrow(/'text'/u);
  });

  it("builds a reporter for every registered name", () => {
    for (const name of registry.names()) {
      expect(() => registry.build(name, sink().context)).not.toThrow();
    }
  });
});

describe("what each format writes", () => {
  const registry = builtinReportFormatRegistry();

  it("text holds everything back until the run is over, then reports it", () => {
    const { context, lines } = sink();
    const reporter = registry.build("text", context);
    // A human report opens with counts it cannot know until the last file,
    // so a finding on its own must produce nothing at all.
    reporter.report(FINDING as never);
    expect(lines).toEqual([]);
    reporter.report(SUMMARY);
    expect(lines.join("\n")).toContain("=== Branch review: HEAD vs main ===");
    expect(lines.join("\n")).toContain("Null check missing.");
  });

  it("ndjson writes one parseable record per line, as it goes", () => {
    const { context, lines } = sink();
    const reporter = registry.build("ndjson", context);
    run(reporter);
    expect(lines).toHaveLength(2);
    expect(lines.map((line) => (JSON.parse(line) as { type: string }).type)).toEqual([
      "finding",
      "summary",
    ]);
  });

  it("github annotates as it goes and writes the summary at the end", () => {
    const { context, lines, summaries } = sink();
    const reporter = registry.build("github", context);
    run(reporter);
    expect(lines[0]).toMatch(/^::error file=src\/a\.ts,line=12/u);
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toContain("## Code review");
  });

  it("github writes no summary outside a runner, and still annotates", () => {
    // `GITHUB_STEP_SUMMARY` is absent on a laptop; that is not an error.
    const lines: string[] = [];
    const reporter = registry.build("github", {
      write: (text) => {
        lines.push(text);
      },
      summary: null,
    });
    expect(() => {
      run(reporter);
    }).not.toThrow();
    expect(lines[0]).toContain("::error ");
  });
});
