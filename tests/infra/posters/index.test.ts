/**
 * The poster registry: which hosting systems `--provider` may name, and that
 * what it builds speaks the port rather than GitHub.
 */

import { describe, expect, it } from "bun:test";

import { PostingError } from "../../../src/core/posting/review-poster";
import { ValueError } from "../../../src/core/util/errors";
import { builtinReviewPosterRegistry } from "../../../src/infra/posters/index";

describe("the poster registry", () => {
  const registry = builtinReviewPosterRegistry();

  it("knows GitHub, and says which variable its token lives in", () => {
    expect(registry.names()).toEqual(["github"]);
    expect(registry.get("github").tokenVariable).toBe("GITHUB_TOKEN");
    expect(registry.describe()).toContain("'github'");
  });

  it("names the providers that exist when asked for one that does not", () => {
    // The message is what a user with a typo reads; it must list the answer.
    expect(() => registry.get("gitlab")).toThrow(ValueError);
    expect(() => registry.get("gitlab")).toThrow(/'github'/u);
  });

  it("builds a poster that speaks the port, whatever the provider", async () => {
    // Through the registry, not the class: this is the path `reviewer comment`
    // takes, and it must not know it is talking to GitHub.
    const poster = registry.create("github", { token: "t", baseUrl: null });
    await expect(
      poster.submit({ repository: "not a slug", pullNumber: 1, body: "b", comments: [] }),
    ).rejects.toThrow(PostingError);
  });
});
