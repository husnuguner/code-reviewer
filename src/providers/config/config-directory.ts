/**
 * The `ConfigDirectory` port on disk.
 * @packageDocumentation
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { type ConfigDirectory, type ConfigHome } from "../../core/ports/config-directory";

import { isRepoConfig } from "./paths";

/** The config file and its sibling files on the filesystem. */
export class FsConfigDirectory implements ConfigDirectory {
  readonly directory: string;
  /** Read off the path: a file under `.review/` is a repository's own. */
  readonly home: ConfigHome;

  constructor(
    readonly path: string,
    readonly configHome: string,
  ) {
    this.directory = dirname(path);
    this.home = isRepoConfig(path) ? "repo" : "machine";
  }

  exists(): boolean {
    return existsSync(this.path);
  }

  write(text: string): void {
    writeCreatingParents(this.path, text);
  }

  writeSidecar(relative: string, text: string): void {
    writeCreatingParents(join(this.directory, relative), text);
  }

  sidecarExists(relative: string): boolean {
    return existsSync(join(this.directory, relative));
  }
}

function writeCreatingParents(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, "utf8");
}
