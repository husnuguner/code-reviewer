/**
 * The `CodeContext` port over local git at one ref (`git show`, `git grep`). Built once per run and
 * memoised: the ref's path list, and every read and search.
 * @packageDocumentation
 */

import { type CodeContext, type CodeSearchHit } from "../../core/ports/code-context";
import { type Logger, NULL_LOGGER } from "../../core/ports/logger";
import { errorMessage } from "../../core/util/errors";

import { type GitRunner, runGit } from "./local-git";

/** Files whose text is memoised; past this the memo stops growing. */
const MEMOISED_FILES = 256;

/** Hits memoised per needle; a request for more bypasses the memo. */
const MEMOISED_HITS = 256;

/** Matches `git grep` reports per file: caps the pipe, not which files are reported. */
const MAX_MATCHES_PER_FILE = 8;

/** Reads and searches the repository at a fixed ref. */
export class GitCodeContext implements CodeContext {
  private readonly log: Logger;
  /** The ref's paths, read on first use; `null` when `ls-tree` failed. */
  private trackedPaths: Promise<ReadonlySet<string> | null> | null = null;
  private readonly readFiles = new Map<string, Promise<string | null>>();
  private readonly searches = new Map<string, Promise<CodeSearchHit[]>>();

  constructor(
    private readonly root: string,
    private readonly reference: string,
    private readonly run: GitRunner = runGit,
    logger: Logger = NULL_LOGGER,
  ) {
    this.log = logger.child("git.context");
  }

  async readFile(path: string): Promise<string | null> {
    const memoised = this.readFiles.get(path);
    if (memoised !== undefined) return memoised;
    const pending = this.read(path);
    if (this.readFiles.size < MEMOISED_FILES) this.readFiles.set(path, pending);
    return pending;
  }

  async search(needle: string, limit: number): Promise<CodeSearchHit[]> {
    if (needle.trim() === "" || limit <= 0) return [];
    if (limit > MEMOISED_HITS) {
      const fresh = await this.grep(needle);
      return fresh.slice(0, limit);
    }
    const memoised = this.searches.get(needle) ?? this.memoisedGrep(needle);
    this.searches.set(needle, memoised);
    const hits = await memoised;
    return hits.slice(0, limit);
  }

  /** The file at the ref; a path the ref does not have skips git entirely. */
  private async read(path: string): Promise<string | null> {
    const paths = await this.paths();
    if (paths !== null && !paths.has(path)) return null;
    try {
      return await this.run(this.root, ["show", `${this.reference}:${path}`]);
    } catch (error) {
      this.log.debug(`no ${path} at ${this.reference}: ${errorMessage(error)}`);
      return null;
    }
  }

  /** Every path the ref tracks, read once; `null` when listing failed (then git is probed directly). */
  private paths(): Promise<ReadonlySet<string> | null> {
    this.trackedPaths ??= this.listPaths();
    return this.trackedPaths;
  }

  private async listPaths(): Promise<ReadonlySet<string> | null> {
    try {
      const out = await this.run(this.root, ["ls-tree", "-r", "-z", "--name-only", this.reference]);
      const paths = new Set(out.split("\0").filter((path) => path !== ""));
      this.log.debug(`${paths.size} path(s) at ${this.reference}`);
      return paths;
    } catch (error) {
      this.log.debug(`could not list ${this.reference}: ${errorMessage(error)}`);
      return null;
    }
  }

  private async memoisedGrep(needle: string): Promise<CodeSearchHit[]> {
    const hits = await this.grep(needle);
    return hits.slice(0, MEMOISED_HITS);
  }

  /** `git grep -nzFIw -m N -- needle ref`; exit 1 (no match) reads as `[]`. */
  private async grep(needle: string): Promise<CodeSearchHit[]> {
    let out: string;
    try {
      out = await this.run(this.root, [
        "grep",
        "-n",
        "-z",
        "-F",
        "-I",
        "-w",
        "-m",
        String(MAX_MATCHES_PER_FILE),
        "--",
        needle,
        this.reference,
      ]);
    } catch (error) {
      this.log.debug(`no match for ${needle} at ${this.reference}: ${errorMessage(error)}`);
      return [];
    }
    return parseGrep(out, this.reference);
  }
}

/**
 * Parses `git grep -z` rows (`<ref>:<path>\0<line>\0<text>`) into hits.
 *
 * @remarks NUL-separated so a path containing `:<digits>:` cannot be misread; a ref cannot contain a
 * colon, so the prefix is split off by length.
 */
export function parseGrep(output: string, reference: string): CodeSearchHit[] {
  const prefix = `${reference}:`;
  const hits: CodeSearchHit[] = [];
  for (const row of output.split("\n")) {
    if (!row.startsWith(prefix)) continue;
    const [path, line, ...text] = row.slice(prefix.length).split("\0");
    if (path === undefined || path === "" || line === undefined || !/^\d+$/u.test(line)) continue;
    hits.push({ path, line: Number(line), text: text.join("\0") });
  }
  return hits;
}
