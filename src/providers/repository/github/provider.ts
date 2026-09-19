/**
 * `github`: GitHub and GitHub Enterprise. The one place a network transport is handed to a poster;
 * `withRetry` wraps the transport so the client's allowlist and error handling stay untouched.
 * @packageDocumentation
 */

import { type ReviewPoster } from "../../../core/ports/review-poster";
import { type FetchLike } from "../../http/fetch-like";
import { withRetry } from "../../http/retrying-fetch";
import {
  RepositoryProvider as RepoProvider,
  type RepositorySettings as RepoSettings,
} from "../repository-provider";

import { GithubReviewClient } from "./client";

/** The platform's `fetch`, named once; the client's `URL`-only signature is the real guard. */
// eslint-disable-next-line unicorn/no-unnecessary-global-this -- named on purpose
const platformFetch: FetchLike = (input, init) => globalThis.fetch(input, init);

/** The GitHub hosting system. */
export class GithubProvider extends RepoProvider {
  readonly name = "github";
  readonly description = "GitHub and GitHub Enterprise (base-url https://host/api/v3)";
  readonly tokenVariable = "GITHUB_TOKEN";

  create(settings: RepoSettings): ReviewPoster {
    return new GithubReviewClient({
      token: settings.token,
      ...(settings.baseUrl !== null && { baseUrl: settings.baseUrl }),
      ...(settings.logger !== undefined && { logger: settings.logger }),
      fetch: withRetry(platformFetch, {
        ...(settings.logger !== undefined && { logger: settings.logger }),
      }),
    });
  }
}
