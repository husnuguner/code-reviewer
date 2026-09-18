/**
 * The reviewed repository beyond the diff, read from local git at one ref.
 *
 * `git show <ref>:<path>` and `git grep` pin every answer to the ref (the
 * branch under review), not to whatever the working tree happens to have
 * checked out -- so branch review reads the code it is judging.
 *
 * Because the ref is fixed for the run, every answer is immutable, and this
 * adapter is built once for the whole review: it therefore answers twice from
 * memory rather than twice from git. Two memos, for the two ways the
 * per-file gathering repeats itself:
 *
 * - **The ref's path list**, read once. Module resolution probes a dozen
 *   candidate paths per import (`./x` -> `./x.ts`, `./x/index.ts`, ...), and
 *   all but one miss; a miss answered from the list costs no subprocess at
 *   all, which is where most of the probing went.
 * - **What was already read or searched.** A change set's files import the
 *   same modules and touch the same symbols, so the same `show` and the same
 *   `grep` would otherwise run once per changed file.
 */

import { type CodeContext, type CodeSearchHit } from "../../core/ports/code-context";
import { type Logger, NULL_LOGGER } from "../../core/ports/logger";
import { errorMessage } from "../../core/util/errors";

import { type GitRunner, runGit } from "./local-git";

/** Files whose text is memoised; past this the memo stops growing. */
const MEMOISED_FILES = 256;

/** Hits memoised per needle; a request for more than this bypasses the memo. */
const MEMOISED_HITS = 256;

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
    // A limit past what the memo keeps has to ask git, or it would be served
    // a truncated answer.
    if (limit > MEMOISED_HITS) {
      const fresh = await this.grep(needle);
      return fresh.slice(0, limit);
    }
    const memoised = this.searches.get(needle) ?? this.memoisedGrep(needle);
    this.searches.set(needle, memoised);
    const hits = await memoised;
    return hits.slice(0, limit);
  }

  /** The file at the ref, skipping git entirely for a path the ref does not have. */
  private async read(path: string): Promise<string | null> {
    const paths = await this.paths();
    if (paths !== null && !paths.has(path)) return null;
    try {
      return await this.run(this.root, ["show", `${this.reference}:${path}`]);
    } catch (error) {
      // A missing path is the common case (module resolution probes several).
      this.log.debug(`no ${path} at ${this.reference}: ${errorMessage(error)}`);
      return null;
    }
  }

  /**
   * Every path the ref tracks, read once. `null` when the listing failed --
   * the caller then probes git as it did before, so a repository this cannot
   * list is slower, never wrong.
   */
  private paths(): Promise<ReadonlySet<string> | null> {
    this.trackedPaths ??= this.listPaths();
    return this.trackedPaths;
  }

  private async listPaths(): Promise<ReadonlySet<string> | null> {
    try {
      // -z: NUL-separated and unquoted, so a path with a space or a quote in
      // it arrives as git stores it rather than as git would print it.
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

  private async grep(needle: string): Promise<CodeSearchHit[]> {
    let out: string;
    try {
      // -F: literal; -n: line numbers; -I: skip binaries; -w: whole word so
      // `id` does not match `identity`. `--` ends the options, in case a
      // needle starts with a dash.
      out = await this.run(this.root, [
        "grep",
        "-n",
        "-F",
        "-I",
        "-w",
        "--",
        needle,
        this.reference,
      ]);
    } catch (error) {
      // git grep exits 1 for "no match"; the runner reports that as a failure.
      this.log.debug(`no match for ${needle} at ${this.reference}: ${errorMessage(error)}`);
      return [];
    }
    return parseGrep(out, this.reference);
  }
}

/** `<ref>:<path>:<line>:<text>` rows into hits. */
export function parseGrep(output: string, reference: string): CodeSearchHit[] {
  const prefix = `${reference}:`;
  const hits: CodeSearchHit[] = [];
  for (const row of output.split("\n")) {
    if (!row.startsWith(prefix)) continue;
    const rest = row.slice(prefix.length);
    const match = /^(.+?):(\d+):(.*)$/u.exec(rest);
    if (match?.[1] === undefined || match[2] === undefined) continue;
    hits.push({ path: match[1], line: Number(match[2]), text: match[3] ?? "" });
  }
  return hits;
}
