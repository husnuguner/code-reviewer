/**
 * A unified diff as the review flow reads it: files, hunks and typed lines.
 *
 * Tokenising is delegated to `parse-diff`; this module gives its output the
 * shape the rest of the review layer reasons about -- new-file line numbers on
 * every added and context line, the hunk header's section text, and the
 * file-level facts (added, removed, renamed) that decide whether a file is
 * reviewable at all -- and can render a file back to text in canonical form.
 *
 * Two inputs arrive here. A hosting provider's per-file `patch` is *headerless*
 * (it starts at the first `@@` hunk); `git diff` output carries full
 * `diff --git` headers and many files. Both parse through the same path.
 */

import parseDiff from "parse-diff";

/** The prefix character of a diff line. `\` is the no-newline marker. */
export type LineType = "+" | "-" | " " | "\\";

export interface DiffLine {
  readonly type: LineType;
  /** The line's text after its prefix, without the terminating `\n`. */
  readonly value: string;
  readonly sourceLineNo: number | null;
  readonly targetLineNo: number | null;
  /** Whether the line ends with `\n` when rendered back to text. */
  readonly terminated: boolean;
}

export interface Hunk {
  readonly sourceStart: number;
  readonly sourceLength: number;
  readonly targetStart: number;
  readonly targetLength: number;
  /** Text after the closing `@@`, e.g. the enclosing function's signature. */
  readonly sectionHeader: string;
  readonly lines: readonly DiffLine[];
}

export interface PatchedFile {
  /** The path the review reports: the target for an added or renamed file, else the source. */
  readonly path: string;
  readonly sourceFile: string;
  readonly targetFile: string;
  /** Every header line before the first hunk, verbatim (`diff --git`, `index`, `---`, `+++`, ...). */
  readonly headerLines: readonly string[];
  readonly hunks: readonly Hunk[];
  readonly isAddedFile: boolean;
  readonly isRemovedFile: boolean;
  readonly isRename: boolean;
}

const DEV_NULL = "/dev/null";
const NO_NEWLINE_MARKER = String.raw`\ No newline at end of file`;
const NO_NEWLINE_VALUE = " No newline at end of file";

// Python's `.` matches `\r`; JavaScript's does not. Every character class
// below that stands in for a Python `.` is spelled `[^\n]` for that reason.
const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?([^\n]*)/;

/** Parse a unified diff (one headerless patch or a whole `git diff`). */
export function parseUnifiedDiff(text: string): PatchedFile[] {
  return splitFileBlocks(text).flatMap((block) => parseFileBlock(block));
}

/** Render a file back to text in canonical form (normalised hunk headers). */
export function renderPatchedFile(file: PatchedFile): string {
  const header = file.headerLines.map((line) => `${line}\n`).join("");
  return header + file.hunks.map(renderHunk).join("");
}

/** The canonical `@@ -a,b +c,d @@ section` header of a hunk. */
export function hunkHeader(hunk: Hunk): string {
  const range = `@@ -${hunk.sourceStart},${hunk.sourceLength} +${hunk.targetStart},${hunk.targetLength} @@`;
  return hunk.sectionHeader ? `${range} ${hunk.sectionHeader}` : range;
}

function renderHunk(hunk: Hunk): string {
  const body = hunk.lines
    .map((line) => `${line.type}${line.value}${line.terminated ? "\n" : ""}`)
    .join("");
  return `${hunkHeader(hunk)}\n${body}`;
}

interface FileBlock {
  readonly text: string;
  readonly isTerminated: boolean;
}

/**
 * Split a multi-file diff into per-file text blocks at `diff --git` lines.
 * Text without such a header (a provider's headerless patch, or a plain
 * `---`/`+++` diff) is a single block.
 */
function splitFileBlocks(text: string): FileBlock[] {
  const lines = text.split("\n");
  const isEndsWithNewline = text.endsWith("\n");
  if (isEndsWithNewline) lines.pop();
  const blocks: string[][] = [];
  let current: string[] = [];
  for (const line of lines) {
    if (line.startsWith("diff --git ") && current.length > 0) {
      blocks.push(current);
      current = [];
    }
    current.push(line);
  }
  if (current.length > 0) blocks.push(current);
  return blocks.map((block, index) => ({
    text: `${block.join("\n")}\n`,
    isTerminated: index < blocks.length - 1 || isEndsWithNewline,
  }));
}

function parseFileBlock(block: FileBlock): PatchedFile[] {
  const headerLines: string[] = [];
  for (const line of block.text.split("\n")) {
    if (HUNK_HEADER.test(line)) break;
    headerLines.push(line);
  }
  // `split` leaves a trailing "" after the final "\n" of a hunk-less block.
  if (headerLines.at(-1) === "") headerLines.pop();

  return parseDiff(block.text).map((file) => toPatchedFile(file, headerLines, block.isTerminated));
}

function toPatchedFile(
  file: parseDiff.File,
  headerLines: readonly string[],
  isTerminated: boolean,
): PatchedFile {
  const sourceFile = file.from ?? "";
  const targetFile = file.to ?? "";
  const hunks = file.chunks.map((chunk, index) =>
    toHunk(chunk, index === file.chunks.length - 1 && !isTerminated),
  );
  // A diff without git headers still reveals an added or removed file through
  // its single hunk's empty side.
  const single = hunks.length === 1 ? hunks[0] : undefined;
  const isAddedFile =
    sourceFile === DEV_NULL ||
    file.new === true ||
    (single?.sourceStart === 0 && single.sourceLength === 0);
  const isRemovedFile =
    targetFile === DEV_NULL ||
    file.deleted === true ||
    (single?.targetStart === 0 && single.targetLength === 0);
  const isRename = sourceFile !== DEV_NULL && targetFile !== DEV_NULL && sourceFile !== targetFile;
  const path = isAddedFile || isRename ? targetFile : sourceFile;
  return {
    path,
    sourceFile,
    targetFile,
    headerLines,
    hunks,
    isAddedFile,
    isRemovedFile,
    isRename,
  };
}

function toHunk(chunk: parseDiff.Chunk, isLastLineUnterminated: boolean): Hunk {
  const match = HUNK_HEADER.exec(chunk.content);
  const sectionHeader = match?.[5] ?? "";
  const lines = chunk.changes.map((change) => toDiffLine(change));
  // The no-newline marker is always re-attached with a newline of its own;
  // only a real content line can inherit the input's missing final newline.
  const last = lines.at(-1);
  if (isLastLineUnterminated && last !== undefined && last.type !== "\\") {
    lines[lines.length - 1] = { ...last, terminated: false };
  }
  return {
    sourceStart: chunk.oldStart,
    sourceLength: chunk.oldLines,
    targetStart: chunk.newStart,
    targetLength: chunk.newLines,
    sectionHeader,
    lines,
  };
}

function toDiffLine(change: parseDiff.Change): DiffLine {
  if (change.content.startsWith(NO_NEWLINE_MARKER)) {
    return {
      type: "\\",
      value: NO_NEWLINE_VALUE + change.content.slice(NO_NEWLINE_MARKER.length),
      sourceLineNo: null,
      targetLineNo: null,
      terminated: true,
    };
  }
  switch (change.type) {
    case "add": {
      return {
        type: "+",
        value: change.content.slice(1),
        sourceLineNo: null,
        targetLineNo: change.ln,
        terminated: true,
      };
    }
    case "del": {
      return {
        type: "-",
        value: change.content.slice(1),
        sourceLineNo: change.ln,
        targetLineNo: null,
        terminated: true,
      };
    }
    case "normal": {
      // An empty context line may arrive as "" rather than " "; both mean an
      // empty line, so the leading marker is optional here.
      return {
        type: " ",
        value: change.content.startsWith(" ") ? change.content.slice(1) : change.content,
        sourceLineNo: change.ln1,
        targetLineNo: change.ln2,
        terminated: true,
      };
    }
  }
}
