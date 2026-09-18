/**
 * One setting may stay out of the file: a secret spelled as the *name* of the
 * environment variable that holds it.
 *
 * `llm.api-key` is the one such setting today. Resolving it is configuration's
 * business rather than the catalogue's: the catalogue only carries what was
 * written, and it is the resolver -- which has the environment and the `.env`
 * files in hand -- that turns a name into a value.
 */

import { CatalogError } from "../util/errors";
import { show } from "../util/text";

/** Spelled like an environment variable: `LLM_API_KEY`, `ANTHROPIC_API_KEY`. */
const ENVIRONMENT_NAME = /^[A-Z_][A-Z0-9_]*$/u;

/**
 * A secret setting, resolved: a value spelled like an environment variable
 * is the *name* of the variable holding the secret and is read from `lookup`;
 * anything else is the secret itself.
 *
 * `lookup` matters: the documented home for a secret is the `.env` beside the
 * catalogue, whose values the settings loader reads without exporting them to
 * the process environment. A caller that passes only the process environment
 * would reject a correctly placed value.
 *
 * A named variable that is not set is an error, not an empty secret: the
 * operator described an intent the environment does not satisfy, and failing
 * now beats a confusing 401 later. `environmentFile` names where the value
 * should have been, for the message.
 *
 * The one exception is a flow that will never send the secret. `--preview`
 * decides scope and calls nobody, and a pre-flight that refused to run
 * without a key it would never use would be a pre-flight nobody could run
 * before they had one. With `isRequired` false, an unset variable resolves
 * to `""` and the run that does need it fails at *its* boundary instead.
 */
export function resolveSecret(
  value: string,
  lookup: Readonly<Record<string, string | undefined>>,
  what: string,
  environmentFile: string,
  isRequired = true,
): string {
  const spelled = value.trim();
  if (!ENVIRONMENT_NAME.test(spelled)) return spelled;
  const resolved = (lookup[spelled] ?? "").trim();
  if (resolved === "" && isRequired) {
    throw new CatalogError(
      `${what} names ${show(spelled)}, which is not set. Put it in ${environmentFile} or export it.`,
    );
  }
  return resolved;
}
