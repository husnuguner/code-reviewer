/**
 * The built-in repository providers, ready to register.
 *
 * To add a hosting system -- GitLab, Bitbucket, Gerrit -- give it a folder
 * beside `github/` with its `ReviewPoster` client and a `RepositoryProvider`
 * subclass, and list an instance here. Nothing else changes: `reviewer
 * comment` validates `--provider` against this registry's names, generates
 * its help from these descriptions, reads the token from the variable each
 * host names, and builds through the registry. There is no
 * `if (provider === "github")` anywhere.
 *
 * The order here is the order `--help` lists them in, so the default comes
 * first.
 */

import { GithubProvider } from "./github/provider";
import {
  type RepositoryProvider as RepoProvider,
  RepositoryProviderRegistry as RepoProviderRegistry,
} from "./repository-provider";

export const BUILTIN_REPOSITORY_PROVIDERS: readonly RepoProvider[] = [new GithubProvider()];

export function builtinRepositoryProviders(): RepoProviderRegistry {
  return new RepoProviderRegistry(BUILTIN_REPOSITORY_PROVIDERS);
}
