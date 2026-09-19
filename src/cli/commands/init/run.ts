/**
 * `reviewer init`: decides which home the config file gets and hands the core use-case the shipped starters.
 * @packageDocumentation
 */

import { initConfigFile } from "../../../core/config/init";
import { shippedFile } from "../../../providers/assets/shipped-files";
import { FsConfigDirectory } from "../../../providers/config/config-directory";
import { findGitRoot, repoConfigPath } from "../../../providers/config/paths";
import { type ConfigArguments, configCradle } from "../../options/config";

/**
 * Runs `init`.
 *
 * @returns The exit code. Inside a checkout the target is its `.review/`; `--config` names the file outright;
 * otherwise it is the machine's.
 */
export function runInit(arguments_: ConfigArguments): number {
  const { configFilePaths: paths, configHomePath, console: out } = configCradle(arguments_);
  const gitRoot = arguments_.config === null ? findGitRoot() : null;
  const target = paths.repo ?? (gitRoot === null ? paths.machine : repoConfigPath(gitRoot));
  const files = new FsConfigDirectory(target, configHomePath);
  return initConfigFile(files, out, {
    config: shippedFile(
      files.home === "repo" ? "templates/repo-config.yaml" : "templates/config.yaml",
    ),
    skillsReadme: shippedFile("templates/skills-README.md"),
  });
}
