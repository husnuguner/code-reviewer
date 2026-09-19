/**
 * A secret setting spelled as the name of the environment variable that holds it.
 * @packageDocumentation
 */

import { ConfigFileError } from "../util/errors";
import { show } from "../util/text";

/** Spelled like an environment variable: `LLM_API_KEY`, `ANTHROPIC_API_KEY`. */
const ENVIRONMENT_NAME = /^[A-Z_][A-Z0-9_]*$/u;

/**
 * Resolves a secret setting.
 *
 * @param value - The setting as written: a variable name, or the secret itself.
 * @param lookup - The environment plus the `.env` layers.
 * @param what - The setting's name, for the message.
 * @param environmentFile - Where the value should have been, for the message.
 * @param isRequired - `false` for a flow that never sends the secret; an unset name then resolves to `""`.
 * @returns The secret.
 * @throws {@link ConfigFileError} when a required named variable is not set.
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
    throw new ConfigFileError(
      `${what} names ${show(spelled)}, which is not set. Put it in ${environmentFile} or export it.`,
    );
  }
  return resolved;
}
