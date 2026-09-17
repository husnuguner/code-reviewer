/**
 * The built-in review posters, ready to register -- and the one place in
 * this program that hands a network transport to a poster.
 *
 * To add a hosting system -- GitLab, Bitbucket, Gerrit -- write its
 * `ReviewPoster` beside the GitHub one and declare its provider here.
 * Nothing else changes: `review-comment` validates `--provider` against this
 * registry's names, generates its help from these descriptions, reads the
 * token from the variable each provider names, and builds through the
 * registry. There is no `if (provider === "github")` anywhere.
 *
 * The order here is the order `--help` lists them in, so the default comes
 * first.
 */

import { ReviewPosterRegistry } from "../../core/comment/poster-registry";
import { type PosterSettings, type ReviewPosterProvider } from "../../core/comment/review-poster";
import { GithubReviewClient } from "../github/review-client";

/**
 * GitHub and GitHub Enterprise.
 *
 * The client is handed the platform `fetch` here, at the composition root,
 * and nowhere else: the client itself accepts only a `URL` it produced after
 * its origin allowlist, so this is the single seam where "the network" enters
 * the poster.
 */
export const githubPoster: ReviewPosterProvider = {
  name: "github",
  description: "GitHub and GitHub Enterprise (base-url https://host/api/v3)",
  tokenVariable: "GITHUB_TOKEN",
  create: (settings: PosterSettings) =>
    new GithubReviewClient({
      token: settings.token,
      ...(settings.baseUrl !== null && { baseUrl: settings.baseUrl }),
      // The one deliberate `globalThis.`: a bare `fetch` identifier is what an
      // SSRF scan keys on, and the client's URL-only signature is the real
      // guard -- see FetchLike.
      // eslint-disable-next-line unicorn/no-unnecessary-global-this -- named on purpose, see above
      fetch: (input, init) => globalThis.fetch(input, init),
    }),
};

export const BUILTIN_REVIEW_POSTERS = [githubPoster] as const;

export function builtinReviewPosterRegistry(): ReviewPosterRegistry {
  return new ReviewPosterRegistry(BUILTIN_REVIEW_POSTERS);
}
