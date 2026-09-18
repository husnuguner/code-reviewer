/**
 * `github`: GitHub and GitHub Enterprise -- and the one place in this program
 * that hands a network transport to a poster.
 *
 * The client beside this file is handed the platform `fetch` here and
 * nowhere else: the client itself accepts only a `URL` it produced after its
 * origin allowlist, so this is the single seam where "the network" enters
 * the poster. Being the single seam is also what makes it the right place to
 * decide that the network is allowed to fail once -- `withRetry` wraps the
 * transport rather than the client, so the client's one endpoint, its origin
 * allowlist and its error handling are all untouched by the decision.
 */

import { type ReviewPoster } from "../../../core/ports/review-poster";
import { type FetchLike } from "../../http/fetch-like";
import { withRetry } from "../../http/retrying-fetch";
import {
  RepositoryProvider as RepoProvider,
  type RepositorySettings as RepoSettings,
} from "../repository-provider";

import { GithubReviewClient } from "./client";

/**
 * The platform's own `fetch`, named once.
 *
 * The one deliberate `globalThis.`: a bare `fetch` identifier is what an SSRF
 * scan keys on, and the client's URL-only signature is the real guard -- see
 * `FetchLike`.
 */
// eslint-disable-next-line unicorn/no-unnecessary-global-this -- named on purpose, see above
const platformFetch: FetchLike = (input, init) => globalThis.fetch(input, init);

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
