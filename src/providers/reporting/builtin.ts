/**
 * The built-in format providers. To add a rendering: extend `FormatProvider` and list an instance here.
 * @packageDocumentation
 */

import { type FormatProvider, FormatProviderRegistry } from "./format-provider";
import { GithubFormat } from "./github/provider";
import { NdjsonFormat } from "./ndjson/provider";
import { TextFormat } from "./text/provider";

/** In `--help` order; the first is the default. */
export const BUILTIN_FORMAT_PROVIDERS: readonly FormatProvider[] = [
  new TextFormat(),
  new NdjsonFormat(),
  new GithubFormat(),
];

/** A registry of the built-in format providers. */
export function builtinFormatProviders(): FormatProviderRegistry {
  return new FormatProviderRegistry(BUILTIN_FORMAT_PROVIDERS);
}
