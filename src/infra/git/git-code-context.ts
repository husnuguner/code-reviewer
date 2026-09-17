/**
 * The reviewed repository beyond the diff, read from local git at one ref.
 *
 * `git show <ref>:<path>` and `git grep` pin every answer to the ref (the
 * branch under review), not to whatever the working tree happens to have
 * checked out -- so branch review reads the code it is judging.
 */

import { type CodeContext, type CodeSearchHit } from "../../core/ports/code-context";
import { type Logger, NULL_LOGGER } from "../../core/ports/logger";
import { errorMessage } from "../../core/util/errors";

import { type GitRunner, runGit } from "./local-git";

export class GitCodeContext implements CodeContext {
  private readonly log: Logger;

  constructor(
    private readonly root: string,
    private readonly reference: string,
    private readonly run: GitRunner = runGit,
    logger: Logger = NULL_LOGGER,
  ) {
    this.log = logger.child("git.context");
  }

  async readFile(path: string): Promise<string | null> {
    try {
      return await this.run(this.root, ["show", `${this.reference}:${path}`]);
    } catch (error) {
      // A missing path is the common case (module resolution probes several).
      this.log.debug(`no ${path} at ${this.reference}: ${errorMessage(error)}`);
      return null;
    }
  }

  async search(needle: string, limit: number): Promise<CodeSearchHit[]> {
    if (needle.trim() === "" || limit <= 0) return [];
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
    return parseGrep(out, this.reference).slice(0, limit);
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
