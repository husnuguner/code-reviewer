/**
 * Runs one git command in a throwaway repository while a test builds it, and
 * throws when git refuses -- a fixture that failed to build is a broken test,
 * not a passing one. Output is discarded; the tests read the repository back
 * through the code under test.
 */

export function git(root: string, ...arguments_: string[]): void {
  const result = Bun.spawnSync(["git", ...arguments_], {
    cwd: root,
    stdin: "ignore",
    stdout: "ignore",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    throw new Error(`git ${arguments_.join(" ")} failed: ${result.stderr.toString().trim()}`);
  }
}
