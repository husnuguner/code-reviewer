/**
 * The hosting systems `comment --provider` may name.
 *
 * Built once, at module scope, for the same reason `format.ts` is: the flag
 * is validated at parse time, before any poster exists, and it must be
 * validated against the same registry the poster is later built through.
 */

import { builtinRepositoryProviders } from "../../providers/repository/builtin";

export const REPOSITORIES = builtinRepositoryProviders();

/** The host a run posts to when `--provider` is not given: the first registered. */
export const DEFAULT_REPOSITORY = REPOSITORIES.defaultName();
