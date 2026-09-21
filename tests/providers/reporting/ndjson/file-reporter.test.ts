/**
 * The `--out` record file: the machine contract this tool ends at.
 *
 * What is pinned here is that the file either works or says why not. A write
 * stream reports a path it cannot open as an asynchronous `error` event, and
 * with nobody listening that is an uncaught exception -- raised only once
 * records begin to flow, which is after every model call has been paid for.
 * Losing a whole run's findings to a mistyped directory is the failure these
 * tests exist to keep out.
 */

import { describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";

import { buildContainer } from "../../../../src/cli/container";
import { type FindingRecord, type SummaryRecord } from "../../../../src/core/ports/review-reporter";
import { ReportFileError } from "../../../../src/core/util/errors";
import { resolveLogSettings } from "../../../../src/providers/logging/log-settings";
import { closeReporter } from "../../../../src/providers/reporting/closable";
import { NdjsonFileReporter } from "../../../../src/providers/reporting/ndjson/file-reporter";
import { NdjsonReporter } from "../../../../src/providers/reporting/ndjson/reporter";
import { TeeReporter } from "../../../../src/providers/reporting/tee";

const FINDING: FindingRecord = {
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

const SUMMARY: SummaryRecord = {
  type: "summary",
  base: "main",
  branch: "HEAD",
  files_changed: 1,
  files_reviewed: 1,
  failed: 0,
  findings: 1,
  files_with_findings: 1,
  anchors: { exact: 1 },
  unanchored: 0,
  refuted: 0,
  capped: 0,
  mislabelled: 0,
  skipped: {},
};

/** A fresh directory nothing else writes to. */
function temporaryDirectory(): string {
  return mkdtempSync(join(tmpdir(), "reviewer-ndjson-"));
}

/**
 * A stream that refuses every write, the way a full disk does: asynchronously,
 * once the run is already under way. Injected rather than provoked, because a
 * test cannot fill a disk.
 */
function failingStream(reason: string): Writable {
  return new Writable({
    write(_chunk, _encoding, callback): void {
      callback(new Error(reason));
    },
  });
}

describe("the --out record file", () => {
  it("writes one JSON record per line, readable as soon as it is closed", async () => {
    const path = join(temporaryDirectory(), "findings.ndjson");
    const reporter = NdjsonFileReporter.open(path);

    reporter.report(FINDING);
    reporter.report(SUMMARY);
    // No sleep: closing is what guarantees the flush, so a consumer reading
    // the file straight afterwards sees every record.
    await reporter.close();

    const lines = readFileSync(path, "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0] ?? "")).toMatchObject({ type: "finding", path: "src/a.ts" });
    expect(JSON.parse(lines[1] ?? "")).toMatchObject({ type: "summary", base: "main" });
  });

  it("truncates whatever was there, so one run is one answer", async () => {
    const path = join(temporaryDirectory(), "findings.ndjson");
    const first = NdjsonFileReporter.open(path);
    first.report(FINDING);
    first.report(SUMMARY);
    await first.close();

    const second = NdjsonFileReporter.open(path);
    second.report(SUMMARY);
    await second.close();

    expect(readFileSync(path, "utf8").trim().split("\n")).toHaveLength(1);
  });

  it("refuses a path whose directory does not exist, before a single record", () => {
    const path = join(temporaryDirectory(), "no-such-directory", "findings.ndjson");

    // A throw here, not an unhandled event later: this is the whole point.
    // `open` is synchronous, so the mistake is known before any model call.
    expect(() => NdjsonFileReporter.open(path)).toThrow(ReportFileError);
    expect(() => NdjsonFileReporter.open(path)).toThrow(/--out names .*findings\.ndjson/u);
    expect(() => NdjsonFileReporter.open(path)).toThrow(/ENOENT/u);
  });

  it("refuses a path that names a directory", () => {
    const directory = temporaryDirectory();
    expect(() => NdjsonFileReporter.open(directory)).toThrow(ReportFileError);
  });

  it("reports a write that failed late instead of crashing the process", async () => {
    // Reaching the assertions at all is half the test: an `error` event with
    // no listener would have taken the worker down with it.
    const reporter = new NdjsonFileReporter(
      failingStream("ENOSPC: no space left on device"),
      "/mnt/full/findings.ndjson",
    );

    expect(() => {
      reporter.report(FINDING);
    }).not.toThrow();

    await expect(reporter.close()).rejects.toThrow(ReportFileError);
  });

  it("names the file and the reason when a late write failed", async () => {
    const reporter = new NdjsonFileReporter(
      failingStream("ENOSPC: no space left on device"),
      "/mnt/full/findings.ndjson",
    );
    reporter.report(FINDING);

    await expect(reporter.close()).rejects.toThrow(
      /--out file \/mnt\/full\/findings\.ndjson could not be written: ENOSPC/u,
    );
  });
});

describe("closing whatever the run was given", () => {
  it("asks nothing of a rendering that owns no file", async () => {
    const lines: string[] = [];
    const reporter = new NdjsonReporter((text) => void lines.push(text));

    await expect(closeReporter(reporter)).resolves.toBeUndefined();
  });

  it("closes the file a tee'd run also wrote to", async () => {
    const path = join(temporaryDirectory(), "findings.ndjson");
    const printed: string[] = [];
    const tee = new TeeReporter([
      new NdjsonReporter((text) => void printed.push(text)),
      NdjsonFileReporter.open(path),
    ]);

    tee.report(FINDING);
    await closeReporter(tee);

    expect(printed).toHaveLength(1);
    expect(readFileSync(path, "utf8").trim().split("\n")).toHaveLength(1);
  });
});

describe("the composition root", () => {
  it("refuses an unwritable --out as the operator's error, not a stack trace", () => {
    // `main` prints one `error:` line and exits 2 for a `ReportFileError`, the
    // way it does for a config-file or a git problem; what is checked here is
    // that resolving the reporter is what raises one -- and that it happens
    // when the reporter is built, ahead of the review.
    const path = join(temporaryDirectory(), "no-such-directory", "findings.ndjson");
    const { cradle } = buildContainer({
      configFile: null,
      logging: resolveLogSettings(),
      overrides: {},
      requiresModel: false,
      format: "text",
      outFile: path,
    });

    expect(() => cradle.branchReporter).toThrow(ReportFileError);
  });
});
