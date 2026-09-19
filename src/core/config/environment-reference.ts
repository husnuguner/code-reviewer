/**
 * A setting that reads the environment: `${NAME}` anywhere in a string value of `config.yaml`, with
 * dotenv-expand's rules (`${NAME:-default}`, `\${` for a literal). Anything else is the value itself.
 * @packageDocumentation
 */

import { expand } from "dotenv-expand";

import { ConfigFileError } from "../util/errors";
import { type JsonValue, isPlainObject } from "../util/json";
import { show } from "../util/text";

/** Spelled like a variable's name: `ANTHROPIC_API_KEY`. What a key itself never looks like. */
const VARIABLE_NAME = /^[A-Z_][A-Z0-9_]*$/u;

/** Whether a value asks the environment for anything. */
export function hasReference(value: string): boolean {
  return value.includes("${");
}

/**
 * Expands every `${...}` in the string leaves of a file's values.
 *
 * @param values - The file's content as read.
 * @param lookup - The environment plus the `.env` layers, names uppercased.
 * @returns A copy with each reference replaced by the variable's value. A reference the environment cannot
 * answer is left as written, so the run can name it once it knows whether the setting is needed at all.
 */
export function expandReferences(
  values: Readonly<Record<string, unknown>>,
  lookup: Readonly<Record<string, string | undefined>>,
): Record<string, unknown> {
  // dotenv-expand writes into the object it is given; a copy keeps it off the process environment.
  const processEnvironment: Record<string, string> = {};
  for (const [name, variable] of Object.entries(lookup)) {
    if (variable !== undefined) processEnvironment[name] = variable;
  }
  const expandOne = (value: string): string => {
    if (!hasReference(value)) return value;
    const expanded = expand({ parsed: { value }, processEnv: { ...processEnvironment } }).parsed?.[
      "value"
    ];
    return expanded === undefined || expanded.trim() === "" ? value : expanded;
  };
  const walk = (node: JsonValue): JsonValue => {
    if (typeof node === "string") return expandOne(node);
    if (Array.isArray(node)) return node.map(walk);
    return isPlainObject(node)
      ? Object.fromEntries(Object.entries(node).map(([key, child]) => [key, walk(child)]))
      : node;
  };
  return Object.fromEntries(
    Object.entries(values).map(([key, child]) => [key, walk(child as JsonValue)]),
  );
}

/**
 * Refuses a secret written as a bare variable name: a key never looks like `ANTHROPIC_API_KEY`, so the writer
 * meant to read the variable and forgot the `${}`.
 *
 * @throws {@link ConfigFileError} naming the spelling that reads the variable.
 */
export function rejectBareVariableName(value: string, what: string): void {
  const spelled = value.trim();
  if (!VARIABLE_NAME.test(spelled)) return;
  throw new ConfigFileError(
    `${what} is ${show(spelled)}, which is spelled like a variable's name, not a key. To read the variable, write \${${spelled}}.`,
  );
}
