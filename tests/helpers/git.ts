/**
 * Runs one git command in a throwaway repository while a test builds it, and
 * throws when git refuses -- a fixture that failed to build is a broken test,
 * not a passing one. Output is discarded; the tests read the repository back
 * through the code under test.
 */

/**
 * How long one fixture command may take. `spawnSync` blocks the event loop, so a git that hangs would stop
 * the test's own `--timeout` from ever firing and hang the whole worker; this turns that into a failure.
 */
const FIXTURE_GIT_TIMEOUT_MS = 30_000;

export function git(root: string, ...arguments_: string[]): void {
  const result = Bun.spawnSync(["git", ...arguments_], {
    cwd: root,
    stdin: "ignore",
    stdout: "ignore",
    stderr: "pipe",
    timeout: FIXTURE_GIT_TIMEOUT_MS,
    killSignal: "SIGKILL",
  });
  if (result.exitedDueToTimeout === true) {
    throw new Error(
      `git ${arguments_.join(" ")} did not finish within ${String(FIXTURE_GIT_TIMEOUT_MS / 1000)}s`,
    );
  }
  if (result.exitCode !== 0) {
    throw new Error(`git ${arguments_.join(" ")} failed: ${result.stderr.toString().trim()}`);
  }
}
