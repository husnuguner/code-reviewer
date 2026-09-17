/**
 * The review-poster registry: which hosting systems `--provider` may name.
 *
 * Declaring a provider and listing it in `infra/posters/index.ts` is all it
 * takes to make it selectable. The command line validates `--provider`
 * against the registered names and generates its `--help` from their
 * descriptions; nothing asks "is this GitHub?" anywhere else.
 *
 * This mirrors `LLMProviderRegistry` and `ReportFormatRegistry` on purpose:
 * same shape, same reason. Three things vary in this program -- the model,
 * the rendering, the hosting system -- and each varies the same way.
 */

import { ValueError } from "../util/errors";
import { pyRepr, pySorted } from "../util/py";

import { type PosterSettings, type ReviewPoster, type ReviewPosterProvider } from "./review-poster";

export class ReviewPosterRegistry {
  private readonly providers = new Map<string, ReviewPosterProvider>();

  constructor(providers: readonly ReviewPosterProvider[] = []) {
    for (const provider of providers) this.register(provider);
  }

  register(provider: ReviewPosterProvider): void {
    this.providers.set(provider.name, provider);
  }

  /** Registration order, which is the order `--help` lists them in. */
  names(): string[] {
    return this.providers.keys().toArray();
  }

  /** Sorted names, for an error message that should read the same every time. */
  sortedNames(): string[] {
    return pySorted(this.providers.keys());
  }

  has(name: string): boolean {
    return this.providers.has(name);
  }

  /** `'name' description` for every provider, for generated help text. */
  describe(): string {
    return this.providers
      .values()
      .map((provider) => `'${provider.name}' ${provider.description}`)
      .toArray()
      .join("; ");
  }

  /** The provider `name` denotes, or a `ValueError` naming the ones that exist. */
  get(name: string): ReviewPosterProvider {
    const provider = this.providers.get(name);
    if (provider === undefined) {
      throw new ValueError(
        `Unknown review provider ${pyRepr(name)}; available: ${pyRepr(this.sortedNames())}`,
      );
    }
    return provider;
  }

  /** A poster for `name`, built from `settings`. */
  create(name: string, settings: PosterSettings): ReviewPoster {
    return this.get(name).create(settings);
  }
}
