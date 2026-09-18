/**
 * Runs a composite action's step the way the GitHub runner does, so a step
 * script is testable without a runner.
 *
 * The detail that matters: `shell: bash` is not plain bash. The runner spawns
 * `bash --noprofile --norc -e -o pipefail <script>`, so errexit is on before
 * the first line of the script and a later `set -uo pipefail` does not undo
 * it. Bash exempts a short-circuiting `a && b` from errexit, but not a
 * function that returns what one left behind: a helper whose body ends in a
 * false test returns 1, and the step dies there -- silently, no output, exit
 * code 1, before the command it exists to run. These helpers reproduce that
 * shell exactly, so a step that breaks that way breaks here first.
 */

import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parse as parseYaml } from "yaml";

interface CompositeStep {
  readonly name?: string;
  readonly run?: string;
  readonly shell?: string;
}

/** The `run` script of the named step, and the shell the runner gives it. */
export function stepScript(actionPath: string, name: string): { run: string; shell: string } {
  const action = parseYaml(readFileSync(actionPath, "utf8")) as {
    runs: { steps: readonly CompositeStep[] };
  };
  const step = action.runs.steps.find((candidate) => candidate.name === name);
  if (step?.run === undefined) {
    throw new Error(`${actionPath} has no step named ${name} that runs a script`);
  }
  if (step.shell !== "bash") {
    throw new Error(`step ${name} runs under ${String(step.shell)}, not bash`);
  }
  return { run: step.run, shell: step.shell };
}

export interface StepRun {
  /** The step's exit code, as the runner would report it. */
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  /** How the stubbed command was called, one call per entry. */
  readonly calls: readonly string[][];
  /** What the step wrote to `GITHUB_OUTPUT`, as `name=value` lines. */
  readonly outputs: Record<string, string>;
}

/**
 * Run `script` under the runner's bash, with `stub` on the PATH in place of
 * the real command, and report what the step did.
 */
export function runStep(
  script: string,
  options: { env: Record<string, string>; stub: string; cwd?: string; stubExit?: number },
): StepRun {
  const root = mkdtempSync(join(tmpdir(), "reviewer-step-"));
  const binary = join(root, "bin");
  mkdirSync(binary);
  const calls = join(root, "calls");
  // The stub records the call and says nothing, so the step's own control
  // flow -- not the real command -- is what the test observes.
  const stubPath = join(binary, options.stub);
  writeFileSync(
    stubPath,
    [
      "#!/usr/bin/env bash",
      `printf '%s\\n' "$*" >> "${calls}"`,
      `exit ${String(options.stubExit ?? 0)}`,
      "",
    ].join("\n"),
    { mode: 0o755 },
  );

  const path = join(root, "script.sh");
  writeFileSync(path, script);
  const githubOutput = join(root, "github-output");
  writeFileSync(githubOutput, "");

  const result = Bun.spawnSync(["bash", "--noprofile", "--norc", "-e", "-o", "pipefail", path], {
    cwd: options.cwd ?? root,
    env: {
      PATH: `${binary}:${process.env["PATH"] ?? ""}`,
      GITHUB_OUTPUT: githubOutput,
      ...options.env,
    },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });

  const outputs: Record<string, string> = {};
  for (const line of readFileSync(githubOutput, "utf8").split("\n")) {
    const separator = line.indexOf("=");
    if (separator > 0) outputs[line.slice(0, separator)] = line.slice(separator + 1);
  }

  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
    calls: existsSync(calls)
      ? readFileSync(calls, "utf8")
          .split("\n")
          .filter((line) => line !== "")
          .map((line) => line.split(" "))
      : [],
    outputs,
  };
}
