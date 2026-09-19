/**
 * What is never sent to the model, whatever the configuration says: credential files and binary patches.
 * `exclude` can extend the list; nothing can narrow it.
 * @packageDocumentation
 */

import { isGlobMatch } from "../skills/glob";

/**
 * Paths whose purpose is to hold a secret, as globs matched against the lower-cased path.
 *
 * @remarks `.env.example` is included: a template with a live value pasted in is a leak no rotation undoes.
 */
export const SECRET_PATHS: readonly string[] = [
  // Private keys, certificates, key stores.
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
  // Credential stores of common tools.
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
  // Environment files, templates included.
  "**/.env",
  "**/.env.*",
  "**/*.env",
];

/** Whether a repository-relative path names a credential file. */
export function isSecretPath(path: string): boolean {
  const lowered = path.toLowerCase();
  return SECRET_PATHS.some((glob) => isGlobMatch(lowered, glob));
}

/** Git's two binary markers. */
const BINARY_MARKER = /^(?:Binary files .* differ|GIT binary patch)/mu;

/** Whether a patch is one git could not express as text: a binary marker, or a NUL byte. */
export function isBinaryPatch(patch: string): boolean {
  return patch.includes("\u{0}") || BINARY_MARKER.test(patch);
}
