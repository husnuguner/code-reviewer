/**
 * `runComment` end to end against a fake hosting system registered for the
 * test: what it asks the host, in what order, and what it then posts. The
 * GitHub client's own reading of the wire is `providers/repository/github`'s
 * test; here the poster is a recorder.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runComment } from "../../../../src/cli/commands/comment/run";
import { REPOSITORIES } from "../../../../src/cli/options/repository";
import {
  type PostingResult,
  type ReviewPoster,
  type ReviewSubmission,
  type ReviewTarget,
} from "../../../../src/core/ports/review-poster";
import { type PostedComment } from "../../../../src/core/posting/review-payload";
import { resolveLogSettings } from "../../../../src/providers/logging/log-settings";
import { RepositoryProvider } from "../../../../src/providers/repository/repository-provider";

/** Records what the command asked and sent; answers `posted` to the listing. */
class RecordingPoster implements ReviewPoster {
  readonly asked: ReviewTarget[] = [];
  readonly submitted: ReviewSubmission[] = [];

  constructor(private readonly posted: PostedComment[]) {}

  postedComments(target: ReviewTarget): Promise<PostedComment[]> {
    this.asked.push(target);
    return Promise.resolve(this.posted);
  }

  submit(submission: ReviewSubmission): Promise<PostingResult> {
    this.submitted.push(submission);
    return Promise.resolve({ inline: submission.comments.length, superseded: 0 });
  }
}

/** A hosting system whose every poster is the one recorder the test holds. */
class FakeHost extends RepositoryProvider {
  readonly name = "fake-host";
  readonly description = "a recorder";
  readonly tokenVariable = "FAKE_HOST_TOKEN";
  poster = new RecordingPoster([]);

  create(): ReviewPoster {
    return this.poster;
  }
}

const host = new FakeHost();
const root = mkdtempSync(join(tmpdir(), "reviewer-comment-"));
const findings = join(root, "findings.ndjson");
const SILENT = resolveLogSettings({ level: "silent" }, { environment: {} });

/** The closing record, incremental or not, with `failed` files. */
function summary(isIncremental: boolean, failed = 0): string {
  return JSON.stringify({
    type: "summary",
    base: "abc123",
    branch: "HEAD",
    incremental: isIncremental,
    files_changed: 1,
    files_reviewed: 1,
    failed,
    findings: 2,
    files_with_findings: 1,
    anchors: { exact: 2 },
    unanchored: 0,
    refuted: 0,
    capped: 0,
    mislabelled: 0,
    bypassed: 0,
    skipped: {},
    policy_changed: [],
    bypass_regions: [],
    bypass_added: [],
  });
}

function record(line: number, body: string): string {
  return JSON.stringify({
    type: "finding",
    path: "src/a.ts",
    line,
    start_line: null,
    anchor: "exact",
    severity: "bug",
    body,
    example: "",
    skills: [],
  });
}

beforeAll(() => {
  REPOSITORIES.register(host);
  process.env["FAKE_HOST_TOKEN"] = "t";
  writeFileSync(findings, `${record(12, "First.")}\n${record(40, "Second.")}\n`);
});

afterAll(() => {
  delete process.env["FAKE_HOST_TOKEN"];
  rmSync(root, { recursive: true, force: true });
});

const arguments_ = {
  findings,
  provider: "fake-host",
  repo: "acme/app",
  pr: 7,
  maxInline: 50,
  requestChangesOn: [],
  supersede: false,
  allowDuplicates: false,
  baseUrl: null,
  identity: null,
  dryRun: false,
};

describe("runComment", () => {
  it("asks the host what is already posted, then posts only what is not", async () => {
    host.poster = new RecordingPoster([{ path: "src/a.ts", line: 12, start_line: null }]);
    expect(await runComment(arguments_, SILENT)).toBe(0);
    expect(host.poster.asked).toEqual([{ repository: "acme/app", pullNumber: 7 }]);
    const [submission] = host.poster.submitted;
    expect(submission?.comments.map((comment) => comment.line)).toEqual([40]);
    expect(submission?.body).toContain("1 already posted inline by an earlier review");
  });

  it("does not ask when duplicates are allowed, and posts everything", async () => {
    host.poster = new RecordingPoster([{ path: "src/a.ts", line: 12, start_line: null }]);
    await runComment({ ...arguments_, allowDuplicates: true }, SILENT);
    expect(host.poster.asked).toEqual([]);
    expect(host.poster.submitted[0]?.comments.map((comment) => comment.line)).toEqual([12, 40]);
  });

  it("posts everything when the host has nothing of ours", async () => {
    host.poster = new RecordingPoster([]);
    await runComment(arguments_, SILENT);
    expect(host.poster.submitted[0]?.comments).toHaveLength(2);
    expect(host.poster.submitted[0]?.body).not.toContain("already posted");
  });

  it("never supersedes a run that did not finish, and says so first in the body", async () => {
    // A review job that died before its summary leaves a partial (or empty) file behind, and the
    // comment job still runs. Posting it as clean and lifting an earlier block would turn a crash into
    // an approval of sorts.
    const partial = join(root, "partial.ndjson");
    writeFileSync(partial, "");
    host.poster = new RecordingPoster([]);
    expect(await runComment({ ...arguments_, findings: partial, supersede: true }, SILENT)).toBe(0);
    const [submission] = host.poster.submitted;
    expect(submission?.supersede).toBe(false);
    expect(submission?.body).toContain("Review incomplete");
    expect(submission?.body).not.toContain("No issues found in the reviewed files.");
  });

  it("never supersedes a run that could not review a file", async () => {
    const failed = join(root, "failed.ndjson");
    writeFileSync(failed, `${summary(false, 1)}\n`);
    host.poster = new RecordingPoster([]);
    await runComment({ ...arguments_, findings: failed, supersede: true }, SILENT);
    const [submission] = host.poster.submitted;
    expect(submission?.supersede).toBe(false);
    expect(submission?.body).toContain("1 file(s) could not be reviewed");
  });

  it("supersedes when asked on a full run, but never on an incremental one", async () => {
    const full = join(root, "full.ndjson");
    writeFileSync(full, `${record(12, "First.")}\n${summary(false)}\n`);
    host.poster = new RecordingPoster([]);
    await runComment({ ...arguments_, findings: full, supersede: true }, SILENT);
    expect(host.poster.submitted[0]?.supersede).toBe(true);

    const incremental = join(root, "incremental.ndjson");
    writeFileSync(incremental, `${record(12, "First.")}\n${summary(true)}\n`);
    host.poster = new RecordingPoster([]);
    await runComment({ ...arguments_, findings: incremental, supersede: true }, SILENT);
    expect(host.poster.submitted[0]?.supersede).toBe(false);
    expect(host.poster.submitted[0]?.body).toContain("Only the commits since `abc123`");
  });

  it("neither asks nor posts on a dry run", async () => {
    host.poster = new RecordingPoster([{ path: "src/a.ts", line: 12, start_line: null }]);
    const written: string[] = [];
    const original = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk: string | Uint8Array): boolean => {
      written.push(String(chunk));
      return true;
    };
    try {
      await runComment({ ...arguments_, dryRun: true }, SILENT);
    } finally {
      process.stdout.write = original;
    }
    expect(host.poster.asked).toEqual([]);
    expect(host.poster.submitted).toEqual([]);
    // Without a host to ask, the dry run shows both findings.
    expect(written.join("")).toContain("--- src/a.ts:12");
    expect(written.join("")).toContain("--- src/a.ts:40");
  });
});
