/**
 * The Usages block: who else mentions an export the change touches. The language says which names are
 * exported and which hits could be callers; the repository search itself needs no language.
 * @packageDocumentation
 */

import { type ChangedFile } from "../../domain/changed-file";
import { type CodeContext } from "../../ports/code-context";
import { type ExportSyntax, type UsageScope } from "../../ports/language";
import { type Logger } from "../../ports/logger";
import { errorMessage } from "../../util/errors";
import { sortedByCodePoint } from "../../util/text";

import { patchSides } from "./patch-sides";
import { changedSymbols } from "./symbols";
import { type UsageContext } from "./types";

/** Hits requested per path listed: a symbol's hits cluster in few files, and the file itself is dropped. */
const HITS_PER_LISTED_PATH = 4;

/** What {@link gatherUsages} needs. */
export interface UsageRequest {
  readonly file: ChangedFile;
  readonly language: ExportSyntax & UsageScope;
  /** Already guarded: it never lists a credential file. */
  readonly context: CodeContext;
  readonly maxSymbols: number;
  readonly maxUsagesPerSymbol: number;
  /** Bounds the port calls in flight. */
  readonly schedule: <T>(task: () => Promise<T>) => Promise<T>;
  readonly log: Logger;
}

/**
 * The users of the highest-ranked `maxSymbols` changed exports, in rank order.
 *
 * @remarks Names every file has are not searched for (the log says which); a search that fails costs that
 * one symbol.
 */
export async function gatherUsages(request: UsageRequest): Promise<UsageContext[]> {
  const { file, language } = request;
  const changed = changedSymbols(patchSides(file.patch), language);
  const skipped = changed.filter((symbol) => language.unsearchableSymbols.has(symbol));
  if (skipped.length > 0) {
    request.log.debug(
      `context ${file.path}: not searched for, every file has them: ${skipped.join(", ")}.`,
    );
  }
  const searchable = changed
    .filter((symbol) => !language.unsearchableSymbols.has(symbol))
    .slice(0, request.maxSymbols);
  const found = await Promise.all(
    searchable.map((symbol) => request.schedule(async () => usageOf(request, symbol))),
  );
  return found.filter((item) => item !== null);
}

/** One symbol's users, or `null` when it has none worth listing. */
async function usageOf(request: UsageRequest, symbol: string): Promise<UsageContext | null> {
  const { file, language, maxUsagesPerSymbol } = request;
  try {
    const hits = await request.context.search(symbol, maxUsagesPerSymbol * HITS_PER_LISTED_PATH);
    const paths = sortedByCodePoint(
      new Set(
        hits
          .map((hit) => hit.path)
          .filter((path) => path !== file.path && language.isPossibleUser(path)),
      ),
    );
    return paths.length === 0 ? null : { symbol, paths: paths.slice(0, maxUsagesPerSymbol) };
  } catch (error) {
    request.log.debug(`context: search for ${symbol} failed: ${errorMessage(error)}`);
    return null;
  }
}
