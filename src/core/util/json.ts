/**
 * JSON as a type: what a decoded document can be, and nothing else.
 *
 * Payloads from a hosting provider or a model arrive untyped; naming the shape
 * they *can* take lets the adapters that decode them say so honestly, and the
 * narrowing helpers here turn one into a record or a list at the point where
 * the code knows what it expects.
 */

import { errorMessage } from "./errors";
import { isDict } from "./py";

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
  return isDict(value);
}

export function isJsonArray(value: JsonValue | undefined): value is JsonValue[] {
  return Array.isArray(value);
}
