/**
 * Reads the catalogue off the disk: find, read, decode YAML, hand to the core to validate.
 * @packageDocumentation
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";

import { parse as parseYaml } from "yaml";

import { type Catalog } from "../../core/catalog/catalog";
import { parseCatalog } from "../../core/catalog/parse";
import { type Logger, NULL_LOGGER } from "../../core/ports/logger";
import { CatalogError, errorMessage } from "../../core/util/errors";

import { type Environment, configPath } from "./paths";

/**
 * Loads the catalogue.
 *
 * @param explicit - `--config`.
 * @returns The catalogue, or `null` when there is no file (a run may proceed on the environment alone).
 * @throws {@link CatalogError} when an explicitly named file is missing, or a file is unreadable or invalid.
 */
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
    payload = parseYaml(text);
  } catch (error) {
    throw new CatalogError(`${path} is not valid YAML: ${errorMessage(error)}`);
  }
  const catalog = parseCatalog(payload, path);
  log.debug(`Catalogue ${path}: ${catalog.projects.size} project(s).`);
  return catalog;
}
