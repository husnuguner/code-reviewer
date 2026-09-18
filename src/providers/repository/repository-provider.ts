/**
 * The repository-provider kind: which hosting systems `reviewer comment
 * --provider` may name.
 *
 * A repository provider builds the core's `ReviewPoster` port out of a token
 * and an optional API root, and knows one thing more than the mechanism does:
 * which environment variable that token lives in. Declaring a subclass and
 * listing an instance in `builtin.ts` is all it takes to make a host
 * selectable; the command line validates the flag against the registered
 * names, generates its `--help` from their descriptions, and reads the token
 * from the variable the chosen host names -- so a GitLab workflow sets
 * `GITLAB_TOKEN` and nothing has to be renamed on the way.
 *
 * The reviewer itself talks to no repository host (see README, "Why the
 * reviewer cannot post"); this kind exists for the one command that does.
 */

import { type Logger } from "../../core/ports/logger";
import { type ReviewPoster } from "../../core/ports/review-poster";
import { Provider } from "../provider";
import { ProviderRegistry } from "../registry";

/** The knobs every poster is built from, read once from the command line. */
export interface RepositorySettings {
  /** The credential. Never logged, never a flag. */
  readonly token: string;
  /** API root override; `null` takes the host's default. */
  readonly baseUrl: string | null;
  /**
   * Where the poster says what it had to work around.
   *
   * Part of the settings rather than something a poster reaches for, because
   * a poster that built its own logger would be a poster whose output the
   * command line could not aim, silence or shape -- and everything a poster
   * has to say is a workaround it chose on the operator's behalf: a review
   * it could not dismiss, inline comments the host refused, a request it
   * retried. Omitted, all of that is discarded.
   */
  readonly logger?: Logger;
}

/** One hosting system. Subclasses say who they are and build their client. */
export abstract class RepositoryProvider extends Provider<RepositorySettings, ReviewPoster> {
  /** The environment variable the credential is read from. */
  abstract readonly tokenVariable: string;
}

/** The hosting systems, selectable by name; nothing here is its own. */
export class RepositoryProviderRegistry extends ProviderRegistry<
  RepositorySettings,
  ReviewPoster,
  RepositoryProvider
> {
  constructor(providers: readonly RepositoryProvider[] = []) {
    super("repository provider", providers);
  }
}
