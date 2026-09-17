/**
 * What is never sent to the model, whatever the configuration says.
 *
 * Every other exclusion in this reviewer is the project's to make: `exclude`
 * globs are written by whoever knows the repository, and a file nobody
 * excluded is reviewed. These two are not. A credential that reaches a model
 * provider cannot be recalled -- the repository can rotate the secret, but the
 * prompt has already left the building -- so the reviewer does not offer that
 * as a setting to get wrong. The list below is built in, always on, and can be
 * *extended* by an `exclude` glob but never narrowed.
 *
 * This is the guarantee the README's security-boundary note leans on from the
 * reviewer's own side: token scope limits what the reviewer may *do* to a
 * repository, and this limits what the repository may leak *through* the
 * reviewer.
 *
 * Two deliberate calls:
 *
 * - **`.env.example` and its siblings go too.** A template is a genuinely
 *   reviewable file and skipping it loses something real; a template with a
 *   live value pasted into it is a leak that no rotation undoes. The cost of
 *   the first is a line in the log, so the whole `.env*` family is skipped
 *   rather than guessed at.
 * - **No extension allowlist.** OCR ships one (111 extensions, anything else
 *   unreviewed); we do not, because "the reviewer silently ignored your
 *   Dockerfile" is exactly the failure an operator cannot see. What is worth
 *   skipping for *value* -- lockfiles, generated code, snapshots -- is the
 *   project's judgement and belongs in its `exclude`, where it is written
 *   down and can be read back.
 */

import { isGlobMatch } from "../skills/glob";

/**
 * Paths that carry credentials, as globs.
 *
 * Matched against a lower-cased path, so `ID_RSA` and `id_rsa` are the same
 * file to this list. Kept deliberately tight: every entry is a file whose
 * *purpose* is to hold a secret, not a file that might happen to contain one.
 * Guessing more widely (`**\/*secret*`) would skip real code and teach nobody
 * anything.
 */
export const SECRET_PATHS: readonly string[] = [
  // Private keys, certificates and key stores.
  "**/*.pem",
  "**/*.key",
  "**/*.p12",
  "**/*.pfx",
  "**/*.jks",
  "**/*.keystore",
  "**/id_rsa",
  "**/id_dsa",
  "**/id_ecdsa",
  "**/id_ed25519",
  // Credential stores of the tools a repository routinely talks to.
  "**/.ssh/**",
  "**/.aws/**",
  "**/.gnupg/**",
  "**/.netrc",
  "**/_netrc",
  "**/.npmrc",
  "**/.pypirc",
  "**/.dockercfg",
  "**/.docker/config.json",
  "**/.git-credentials",
  "**/.htpasswd",
  // Environment files, templates included (see the module note).
  "**/.env",
  "**/.env.*",
  "**/*.env",
];

/** Whether a repository-relative path names a credential file. */
export function isSecretPath(path: string): boolean {
  const lowered = path.toLowerCase();
  return SECRET_PATHS.some((glob) => isGlobMatch(lowered, glob));
}

/**
 * A patch git could not express as text: the two forms it prints for a binary
 * file, and any patch carrying a NUL byte.
 *
 * There is nothing to review in one and nothing good to be had from putting it
 * in a prompt. A hosting provider usually omits the patch for a binary file
 * (which `ChangedFile.fromEntry` already refuses), but local git prints a
 * marker line instead, so the two sources are made to agree here.
 */
const BINARY_MARKER = /^(?:Binary files .* differ|GIT binary patch)/mu;

export function isBinaryPatch(patch: string): boolean {
  return patch.includes("\u{0}") || BINARY_MARKER.test(patch);
}
