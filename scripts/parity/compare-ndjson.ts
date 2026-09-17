/**
 * Compare two NDJSON branch-review outputs record for record, ignoring order.
 *
 * Usage: `npx tsx scripts/parity/compare-ndjson.ts a.ndjson b.ndjson`
 * Exits 0 when every record (findings and summary) is semantically identical.
 */

import { readFileSync } from "node:fs";

interface Record_ {
  readonly type: string;
  readonly path?: string;
  readonly line?: number | null;
  readonly severity?: string;
  readonly body?: string;
}

/** One NDJSON line as a record, or a plain refusal naming the offending line. */
function parseRecord(line: string, path: string, index: number): Record_ {
  try {
    return JSON.parse(line) as Record_;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${path}:${index + 1}: not JSON: ${detail}\n`);
    process.exit(2);
  }
}

function records(path: string): Record_[] {
  return readFileSync(path, "utf8")
    .trim()
    .split("\n")
    .filter((line) => line !== "")
    .map((line, index) => parseRecord(line, path, index));
}

function key(record: Record_): string {
  return record.type === "summary"
    ? "~summary"
    : `${record.path ?? ""}|${String(record.line)}|${record.severity ?? ""}|${record.body ?? ""}`;
}

const [left, right] = process.argv.slice(2);
if (left === undefined || right === undefined) {
  process.stderr.write("usage: compare-ndjson <a.ndjson> <b.ndjson>\n");
  process.exit(2);
}

const a = records(left).toSorted((x, y) => key(x).localeCompare(key(y)));
const b = records(right).toSorted((x, y) => key(x).localeCompare(key(y)));
let differences = 0;
for (let index = 0; index < Math.max(a.length, b.length); index++) {
  const x = JSON.stringify(a[index]);
  const y = JSON.stringify(b[index]);
  if (x === y) {
    continue;
  }

  differences++;
  process.stdout.write(`A: ${x}\nB: ${y}\n\n`);
}
process.stdout.write(
  differences === 0
    ? `IDENTICAL: ${a.length} records\n`
    : `DIFFERENT: ${differences} record(s) differ (${a.length} vs ${b.length})\n`,
);
process.exitCode = differences === 0 ? 0 : 1;
