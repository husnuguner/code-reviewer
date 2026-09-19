/**
 * The hosting systems `comment --provider` may name; built at module scope for the same reason as `format.ts`.
 * @packageDocumentation
 */

import { builtinRepositoryProviders } from "../../providers/repository/builtin";

/** The repository-provider registry. */
export const REPOSITORIES = builtinRepositoryProviders();

/** The host when `--provider` is not given: the first registered. */
export const DEFAULT_REPOSITORY = REPOSITORIES.defaultName();
