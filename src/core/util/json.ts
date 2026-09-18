/**
 * JSON as a type: what a decoded document can be, and nothing else.
 *
 * Payloads from a hosting provider or a model arrive untyped; naming the shape
 * they *can* take lets the adapters that decode them say so honestly, and the
 * narrowing helpers here turn one into a record or a list at the point where
 * the code knows what it expects.
 *
 * The predicates at the foot of this module answer the questions a caller has
 * about such a value before trusting it -- is it an object, is it a whole
 * number, did the source supply anything at all, and what should a message
 * call it. They live together because they share one subject: a decoded
 * document nobody has validated yet.
 */

import { errorMessage } from "./errors";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | JsonObject;
export interface JsonObject {
  readonly [key: string]: JsonValue;
}

/** Decode text as JSON, or throw the given error when it is not JSON. */
export function decodeJson(text: string, onError: (detail: string) => Error): JsonValue {
  try {
    return JSON.parse(text) as JsonValue;
  } catch (error) {
    throw onError(errorMessage(error));
  }
}

export function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return isPlainObject(value);
}

export function isJsonArray(value: JsonValue | undefined): value is JsonValue[] {
  return Array.isArray(value);
}

/**
 * A key/value object, not an array and not `null`.
 *
 * `typeof` answers `"object"` for all three, so every caller that wants a
 * mapping has to exclude the other two; doing it here means none of them has
 * to remember. `isJsonObject` above is this same question asked of a value
 * already typed as JSON.
 */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * A whole number safe to use as a count, an index or a line number.
 *
 * `Number.isSafeInteger` refuses non-numbers without coercing them, which is
 * the point: a model answering `"line": true` or `"line": "7"` was not
 * naming a line, and a predicate that accepted either would place a finding
 * somewhere nobody asked for.
 */
export function isInteger(value: unknown): value is number {
  return Number.isSafeInteger(value);
}

/**
 * Whether the source actually supplied something here.
 *
 * `Boolean()` will not do: it calls an empty array and an empty object true,
 * and those are exactly the shapes a half-written config or a terse model
 * reply produces where a caller expects content. An empty container is
 * nothing supplied, and so is `""`, `0`, `null` and an absent key.
 */
export function hasContent(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.length > 0;
  if (typeof value === "number") return value !== 0 && !Number.isNaN(value);
  if (typeof value === "boolean") return value;
  if (typeof value === "bigint") return value !== 0n;
  if (Array.isArray(value)) return value.length > 0;
  return typeof value === "object" ? Object.keys(value).length > 0 : true;
}

/**
 * What a message should call this value's type.
 *
 * JavaScript's own words, not the JSON specification's and not Python's: the
 * operator reading "must be an object, got null" is looking at a YAML file
 * through a Node tool, and `NoneType` would name a language they are not
 * using.
 */
export function typeNameOf(value: unknown): string {
  if (value === null) return "null";
  return Array.isArray(value) ? "array" : typeof value;
}
