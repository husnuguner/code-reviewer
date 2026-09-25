/**
 * Repository-relative path arithmetic every language needs and none should rewrite: joining a relative
 * specifier onto the importing file's directory, and reading a path's name, directory and extension.
 * @packageDocumentation
 */

/** The last segment of a path: `src/a/foo.test.ts` → `foo.test.ts`. */
export function fileNameOf(path: string): string {
  return path.split("/").at(-1) ?? path;
}

/** Everything before the last segment: `src/a/foo.ts` → `src/a`; `""` at the root. */
export function directoryOf(path: string): string {
  return path.split("/").slice(0, -1).join("/");
}

/** The lower-cased extension of a path's file name, without the dot; `""` when it has none. */
export function extensionOf(path: string): string {
  const name = fileNameOf(path);
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? "" : name.slice(dot + 1).toLowerCase();
}

/**
 * `relative` (`./x`, `../y/z`) joined onto the directory of `fromPath`.
 *
 * @returns e.g. `./x` from `src/a/b.ts` → `src/a/x`. Never leaves the repository root: a `..` past it is
 * dropped.
 */
export function joinRelative(fromPath: string, relative: string): string {
  const base = fromPath.split("/").slice(0, -1);
  for (const segment of relative.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      base.pop();
      continue;
    }
    base.push(segment);
  }
  return base.join("/");
}
