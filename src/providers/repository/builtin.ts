/**
 * The built-in repository providers. To add a host: a folder beside `github/` with its client and a
 * `RepositoryProvider` subclass, and an instance here.
 * @packageDocumentation
 */

import { GithubProvider } from "./github/provider";
import {
  type RepositoryProvider as RepoProvider,
  RepositoryProviderRegistry as RepoProviderRegistry,
} from "./repository-provider";

/** In `--help` order; the first is the default. */
export const BUILTIN_REPOSITORY_PROVIDERS: readonly RepoProvider[] = [new GithubProvider()];

/** A registry of the built-in repository providers. */
export function builtinRepositoryProviders(): RepoProviderRegistry {
  return new RepoProviderRegistry(BUILTIN_REPOSITORY_PROVIDERS);
}
