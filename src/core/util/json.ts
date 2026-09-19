/**
 * JSON as a type, and the predicates that narrow an unvalidated decoded value.
 * @packageDocumentation
 */

import { errorMessage } from "./errors";

/** A JSON scalar. */
export type JsonPrimitive = string | number | boolean | null;
/** Any decoded JSON value. */
export type JsonValue = JsonPrimitive | JsonValue[] | JsonObject;
/** A decoded JSON object. */
export interface JsonObject {
  readonly [key: string]: JsonValue;
}

/**
 * Decodes text as JSON.
 *
 * @param text - The document.
 * @param onError - Builds the error to throw from the parser's message.
 * @returns The decoded value.
 * @throws Whatever `onError` returns when `text` is not JSON.
 */
export function decodeJson(text: string, onError: (detail: string) => Error): JsonValue {
  try {
    return JSON.parse(text) as JsonValue;
  } catch (error) {
    throw onError(errorMessage(error));
  }
}

/** Whether a JSON value is an object (not an array, not `null`). */
export function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return isPlainObject(value);
}

/** Whether a JSON value is an array. */
export function isJsonArray(value: JsonValue | undefined): value is JsonValue[] {
  return Array.isArray(value);
}

/** Whether a value is a key/value object: not an array, not `null`. */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Whether a value is a safe whole number.
 *
 * @remarks Does not coerce: `true` and `"7"` are not integers.
 */
export function isInteger(value: unknown): value is number {
  return Number.isSafeInteger(value);
}

/**
 * Whether the source supplied something here.
 *
 * @remarks Unlike `Boolean()`, an empty array or object counts as nothing supplied.
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

/** The value's type name as a message should spell it: `null`, `array`, or `typeof`. */
export function typeNameOf(value: unknown): string {
  if (value === null) return "null";
  return Array.isArray(value) ? "array" : typeof value;
}
