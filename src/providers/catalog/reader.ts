/**
 * Reading the catalogue off the disk: find it, read it, decode the YAML, and
 * hand the payload to the core to validate.
 *
 * A missing catalogue is not an error -- a run may proceed on the environment
 * alone -- but an explicitly named file that is missing *is*: the operator
 * said where to look. An unreadable or invalid one is an error either way,
 * because it states an intent that cannot be honoured.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";

import { parse as parseYaml } from "yaml";

import { type Catalog } from "../../core/catalog/catalog";
import { parseCatalog } from "../../core/catalog/parse";
import { type Logger, NULL_LOGGER } from "../../core/ports/logger";
import { CatalogError, errorMessage } from "../../core/util/errors";

import { type Environment, configPath } from "./paths";

/** Read the catalogue, or `null` when there is no file to read. */
export function loadCatalog(
  explicit: string | null | undefined,
  environment: Environment = process.env,
  logger: Logger = NULL_LOGGER,
  home: string = homedir(),
  cwd: string = process.cwd(),
): Catalog | null {
  const log = logger.child("catalog");
  const path = configPath(explicit, environment, home, existsSync, cwd);
  if (!existsSync(path) || !statSync(path).isFile()) {
    if (explicit !== null && explicit !== undefined && explicit !== "") {
      throw new CatalogError(`No config file at ${path}`);
    }
    log.debug(`No project catalogue at ${path}; using the environment alone.`);
    return null;
  }
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    const detail = errorMessage(error);
    throw new CatalogError(`Could not read ${path}: ${detail}`);
  }
  let payload: unknown;
  try {
    // YAML 1.2 reads JSON as well, so a file from before the format change loads.
    payload = parseYaml(text);
  } catch (error) {
    throw new CatalogError(`${path} is not valid YAML: ${errorMessage(error)}`);
  }
  const catalog = parseCatalog(payload, path);
  log.debug(`Catalogue ${path}: ${catalog.projects.size} project(s).`);
  return catalog;
}
