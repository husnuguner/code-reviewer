/**
 * The built-in format providers, ready to register.
 *
 * To add a rendering -- SARIF, JUnit, a webhook POST -- write its reporter
 * beside these, extend `FormatProvider` in `providers/<name>.ts`, and list an
 * instance here. Nothing else changes: the command line validates `--format`
 * against the registry's names and generates its help from these
 * descriptions, and the composition root builds through it. There is no
 * `switch` on the format anywhere, which is the point: a fourth rendering
 * cannot be half-added.
 *
 * The order here is the order `--help` lists them in, so the default comes
 * first.
 */

import { type FormatProvider, FormatProviderRegistry } from "./format-provider";
import { GithubFormat } from "./github/provider";
import { NdjsonFormat } from "./ndjson/provider";
import { TextFormat } from "./text/provider";

export const BUILTIN_FORMAT_PROVIDERS: readonly FormatProvider[] = [
  new TextFormat(),
  new NdjsonFormat(),
  new GithubFormat(),
];

export function builtinFormatProviders(): FormatProviderRegistry {
  return new FormatProviderRegistry(BUILTIN_FORMAT_PROVIDERS);
}
