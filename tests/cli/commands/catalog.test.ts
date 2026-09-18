/**
 * The catalogue commands: `init`, `projects` and `add` print what the
 * fixtures froze, write what they promise, and leave what is there alone.
 */

import { describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parse as parseYaml } from "yaml";

import {
  type Catalog,
  PROJECT_SETTING_KEYS,
  parseCatalog,
} from "../../../src/core/catalog/catalog";
import {
  type CatalogFiles,
  addProject,
  initCatalog,
  listProjects,
} from "../../../src/core/catalog/commands";
import { type ConsoleOutput } from "../../../src/core/ports/console";
import { FsCatalogFiles } from "../../../src/infra/config/catalog-files";
import { loadCatalog } from "../../../src/infra/config/loader";
import { shippedFile } from "../../../src/infra/shipped-files";
import { loadFixture } from "../../contracts/fixtures";

function recorder(): ConsoleOutput & { text: () => string } {
  const lines: string[] = [];
  return {
    line(text = ""): void {
      lines.push(text);
    },
    text: () => lines.map((line) => `${line}\n`).join(""),
  };
}

describe("the catalogue commands", () => {
  const fixtures = loadFixture("commands");
  const expected = (name: string): { code: number; out: string; written?: string } =>
    fixtures.find((c) => c.name === name)?.expected as {
      code: number;
      out: string;
      written?: string;
    };

  it("init writes the skeleton and the shipped policy once, and refuses to overwrite", () => {
    const root = mkdtempSync(join(tmpdir(), "reviewer-init-"));
    const path = join(root, "nested", "config.yaml");
    const files: CatalogFiles = new FsCatalogFiles(path, "<CONFIG_HOME>");
    const placeholders = (text: string): string =>
      text.replaceAll(files.promptPath, "<PROMPT_PATH>").replaceAll(path, "<CONFIG_PATH>");
    const starter = {
      catalog: shippedFile("templates/config.yaml"),
      policy: "policy text",
      skillsReadme: "what a skill is",
    };
    const out = recorder();
    expect(initCatalog(files, out, starter)).toBe(expected("init/writes_skeleton").code);
    expect(placeholders(out.text())).toBe(expected("init/writes_skeleton").out);
    expect(readFileSync(path, "utf8")).toBe(starter.catalog);
    expect(readFileSync(files.promptPath, "utf8")).toBe("policy text");

    const again = recorder();
    expect(initCatalog(files, again, starter)).toBe(expected("init/refuses_existing").code);
    expect(placeholders(again.text())).toBe(expected("init/refuses_existing").out);
  });

  it("inside a repository, init writes the repository's own .review/ with everything CI needs", () => {
    const repo = mkdtempSync(join(tmpdir(), "reviewer-repo-"));
    const files: CatalogFiles = new FsCatalogFiles(join(repo, ".review", "config.yaml"), "<HOME>");
    expect(files.home).toBe("repo");
    const out = recorder();
    const code = initCatalog(files, out, {
      catalog: shippedFile("templates/repo-config.yaml"),
      policy: "policy",
      skillsReadme: "what a skill is",
    });

    expect(code).toBe(0);
    // The whole setup, in one committed folder: config, policy, skills.
    expect(readFileSync(join(repo, ".review", "config.yaml"), "utf8")).toContain("version: 3");
    expect(readFileSync(join(repo, ".review", "prompts", "system.md"), "utf8")).toBe("policy");
    expect(readFileSync(join(repo, ".review", "skills", "README.md"), "utf8")).toBe(
      "what a skill is",
    );
    // A project-specific key may live in .review/.env; committing it is the
    // one mistake init must make impossible by default.
    expect(readFileSync(join(repo, ".review", ".gitignore"), "utf8")).toContain(".env");
    expect(out.text()).toContain("Commit .review/");
    // The repository holds one project, so its skills sit directly in skills/.
    expect(files.skillsDirectory("anything")).toBe(join(repo, ".review", "skills"));
  });

  it("ships a repo-local starter that parses, names one project, and reads skills from beside itself", () => {
    const catalog = parseCatalog(parseYaml(shippedFile("templates/repo-config.yaml")), "template");
    expect(catalog.projects.size).toBe(1);
    const project = catalog.project(null);
    // No local-path: the reviewer already knows where it is.
    expect(project.settings["local-path"]).toBeUndefined();
    // `skills`, not `.review/skills`: a relative path in a catalogue is taken
    // from the catalogue's own directory, the same base `prompts` has always
    // used. One rule, checkable by reading the file.
    expect(project.settings.skills).toEqual({ path: "skills", mappings: {} });
    for (const key of Object.keys(catalog.defaults)) expect(key).toBeOneOf(PROJECT_SETTING_KEYS);
  });

  it("ships a starter catalogue that parses and points at the policy it installs", () => {
    const catalog = parseCatalog(parseYaml(shippedFile("templates/config.yaml")), "template");
    expect(catalog.defaults.prompts).toEqual(["prompts/system.md"]);
    expect(catalog.project("example").name).toBe("example");
    for (const key of Object.keys(catalog.defaults)) expect(key).toBeOneOf(PROJECT_SETTING_KEYS);
  });

  it("init keeps an existing policy file", () => {
    const root = mkdtempSync(join(tmpdir(), "reviewer-init-"));
    const files: CatalogFiles = new FsCatalogFiles(join(root, "config.yaml"), root);
    files.writePrompt("mine");
    const out = recorder();
    expect(
      initCatalog(files, out, { catalog: "version: 3\n", policy: "shipped", skillsReadme: "r" }),
    ).toBe(0);
    expect(readFileSync(files.promptPath, "utf8")).toBe("mine");
    expect(out.text()).toContain(`Kept ${files.promptPath}`);
  });

  it.each([
    ["list_projects/valid", "parse/valid"],
    ["list_projects/no_projects", "parse/empty_object"],
  ])("%s", (name, payloadCase) => {
    const payload = loadFixture("catalog").find((c) => c.name === payloadCase)?.input as {
      payload: unknown;
    };
    const root = mkdtempSync(join(tmpdir(), "reviewer-projects-"));
    const path = join(root, "config.yaml");
    writeFileSync(path, JSON.stringify(payload.payload), "utf8");
    const out = recorder();
    const code = listProjects(loadCatalog(path, {}), path, out);
    expect(code).toBe(expected(name).code);
    expect(out.text().replaceAll(path, "<CONFIG_PATH>")).toBe(expected(name).out);
  });

  it("projects says where the catalogue was expected when there is none", () => {
    const out = recorder();
    expect(listProjects(null, "/x/config.yaml", out)).toBe(1);
    expect(out.text()).toBe(
      "No catalogue at /x/config.yaml.\nRun 'reviewer init' to create one.\n",
    );
  });
});

/** A catalogue on disk with one annotated project already in it. */
function addScratch(): { files: CatalogFiles; read: () => string } {
  const root = mkdtempSync(join(tmpdir(), "reviewer-add-"));
  const path = join(root, "config.yaml");
  writeFileSync(
    path,
    [
      "version: 3",
      "# a comment the operator wrote and expects to keep",
      "defaults:",
      "  language: tr",
      "projects:",
      "  existing:",
      "    local-path: ~/src/existing",
    ].join("\n"),
    "utf8",
  );
  return { files: new FsCatalogFiles(path, root), read: () => readFileSync(path, "utf8") };
}

function catalogOf(files: CatalogFiles): Catalog {
  return parseCatalog(parseYaml(readFileSync(files.path, "utf8")), files.path);
}

describe("defining a project", () => {
  it("adds the project and leaves every comment in place", () => {
    const { files, read } = addScratch();
    const out = recorder();
    const code = addProject(catalogOf(files), files, out, {
      name: "my-app",
      localPath: "/src/my-app",
      skillsPath: ".review/skills",
    });

    expect(code).toBe(0);
    // Comment preservation is the requirement: a command that reformatted
    // this file on every use is a command nobody runs twice.
    expect(read()).toContain("# a comment the operator wrote and expects to keep");
    const project = catalogOf(files).project("my-app");
    expect(project.settings["local-path"]).toBe("/src/my-app");
    expect(project.settings.skills).toEqual({ path: ".review/skills", mappings: {} });
    // The project that was already there is untouched.
    expect(catalogOf(files).project("existing").settings["local-path"]).toBe("~/src/existing");
  });

  it("refuses a name the catalogue already defines", () => {
    const { files } = addScratch();
    const out = recorder();
    expect(
      addProject(catalogOf(files), files, out, {
        name: "existing",
        localPath: "/src/x",
        skillsPath: null,
      }),
    ).toBe(1);
    expect(out.text()).toContain("already defines a project named 'existing'");
  });

  it("refuses when there is no catalogue to add to", () => {
    const { files } = addScratch();
    const out = recorder();
    expect(
      addProject(null, files, out, {
        name: "x",
        localPath: "/src/x",
        skillsPath: null,
      }),
    ).toBe(1);
    expect(out.text()).toContain("reviewer init");
  });

  it("creates the machine-local skills directory, and says it is machine-local", () => {
    const { files } = addScratch();
    const out = recorder();
    addProject(catalogOf(files), files, out, {
      name: "local-rules",
      localPath: "/src/x",
      skillsPath: null,
    });
    expect(existsSync(files.skillsDirectory("local-rules"))).toBe(true);
    expect(out.text()).toContain("a CI runner cannot read it");
    // Without a skills path the entry names no directory, so the catalogue's
    // shared `skills.path` default applies.
    expect(catalogOf(files).project("local-rules").settings.skills).toBeUndefined();
  });
});
