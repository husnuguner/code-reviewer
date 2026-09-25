/**
 * The Definitions block: the exported surface of the local modules a file imports. The language reads the
 * imports, resolves them and extracts the surface; this module decides how many, in what order, and never
 * through a credential file.
 * @packageDocumentation
 */

import { type ChangedFile } from "../../domain/changed-file";
import { type CodeContext } from "../../ports/code-context";
import { type ImportSyntax, type ModuleResolution, type ModuleSurface } from "../../ports/language";
import { type Logger } from "../../ports/logger";
import { errorMessage } from "../../util/errors";
import { isSecretPath } from "../guards";

import { importsOf } from "./imports";
import { type DefinitionContext } from "./types";

/**
 * Import specifiers tried per Definitions slot. A miss is cheap (the ref's path list is read once), and
 * without a margin one unresolvable import at the top of a file pushes a real module out of the block.
 */
const DEFINITION_CANDIDATES_PER_SLOT = 2;

/** What {@link gatherDefinitions} needs. */
export interface DefinitionRequest {
  readonly file: ChangedFile;
  readonly language: ImportSyntax & ModuleResolution & ModuleSurface;
  /** Already guarded: it never reads a credential file. */
  readonly context: CodeContext;
  readonly maxDefinitions: number;
  /** Code points per module's surface. */
  readonly maxCharsEach: number;
  /** Bounds the port calls in flight. */
  readonly schedule: <T>(task: () => Promise<T>) => Promise<T>;
  readonly log: Logger;
}

/**
 * The first `maxDefinitions` imports that resolve, in import order.
 *
 * @remarks A specifier naming a credential file takes no slot, and twice the cap is tried, so one that
 * resolves to nothing (a package path, a deleted file) does not cost a real module its place. A port call
 * that fails costs that one module.
 */
export async function gatherDefinitions(request: DefinitionRequest): Promise<DefinitionContext[]> {
  const { file, language, maxDefinitions } = request;
  const specifiers = importsOf(language, file)
    .filter((specifier) => !isSecretPath(language.resolve(file.path, specifier).path))
    .slice(0, maxDefinitions * DEFINITION_CANDIDATES_PER_SLOT);
  const found = await Promise.all(
    specifiers.map((specifier) => request.schedule(async () => definitionOf(request, specifier))),
  );
  return found.filter((item) => item !== null).slice(0, maxDefinitions);
}

/** One import's surface, or `null` when it resolves to nothing readable. */
async function definitionOf(
  request: DefinitionRequest,
  specifier: string,
): Promise<DefinitionContext | null> {
  const { file, language, context } = request;
  try {
    const candidates = language
      .resolve(file.path, specifier)
      .candidates.filter((path) => path !== file.path);
    for (const path of candidates) {
      const text = await context.readFile(path);
      if (text !== null) {
        return { specifier, path, signatures: language.signatures(text, request.maxCharsEach) };
      }
    }
    return null;
  } catch (error) {
    request.log.debug(
      `context: could not resolve ${specifier} from ${file.path}: ${errorMessage(error)}`,
    );
    return null;
  }
}
