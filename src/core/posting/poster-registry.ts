/**
 * The review-poster registry: which hosting systems `--provider` may name.
 *
 * Declaring a provider and listing it in `infra/posters/index.ts` is all it
 * takes to make it selectable. The command line validates `--provider`
 * against the registered names and generates its `--help` from their
 * descriptions; nothing asks "is this GitHub?" anywhere else.
 *
 * Three things vary in this program -- the model, the rendering, the hosting
 * system -- and each varies the same way, so each is a `Registry` and only
 * the building below is this one's own.
 */

import { DescribedRegistry } from "../util/registry";

import { type PosterSettings, type ReviewPoster, type ReviewPosterProvider } from "./review-poster";

export class ReviewPosterRegistry extends DescribedRegistry<ReviewPosterProvider> {
  constructor(providers: readonly ReviewPosterProvider[] = []) {
    super("review provider", providers);
  }

  /** A poster for `name`, built from `settings`. */
  create(name: string, settings: PosterSettings): ReviewPoster {
    return this.get(name).create(settings);
  }
}
