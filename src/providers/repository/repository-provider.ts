/**
 * The repository-provider kind: the hosting systems `reviewer comment --provider` may name. Builds the
 * core's `ReviewPoster` and names the token variable.
 * @packageDocumentation
 */

import { type Logger } from "../../core/ports/logger";
import { type ReviewPoster } from "../../core/ports/review-poster";
import { Provider } from "../provider";
import { ProviderRegistry } from "../registry";

/** What every poster is built from. */
export interface RepositorySettings {
  /** The credential. Never logged, never a flag. */
  readonly token: string;
  /** API root override; `null` takes the host's default. */
  readonly baseUrl: string | null;
  /** Where the poster reports what it worked around; omitted, that is discarded. */
  readonly logger?: Logger;
}

/** One hosting system. */
export abstract class RepositoryProvider extends Provider<RepositorySettings, ReviewPoster> {
  /** The environment variable the credential is read from. */
  abstract readonly tokenVariable: string;
}

/** The hosting systems, selectable by name. */
export class RepositoryProviderRegistry extends ProviderRegistry<
  RepositorySettings,
  ReviewPoster,
  RepositoryProvider
> {
  constructor(providers: readonly RepositoryProvider[] = []) {
    super("repository provider", providers);
  }
}
