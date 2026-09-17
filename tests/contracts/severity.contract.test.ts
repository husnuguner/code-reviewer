import { describe, expect, it } from "vitest";

import { languageName } from "../../src/core/config/language";
import {
  SEVERITIES,
  parseSeverity,
  severityLabel,
  severityLabelOf,
  severityPromptVocabulary,
  severityRank,
  severityRankOf,
} from "../../src/core/review/severity";

import { casesUnder, expectContract, loadFixture } from "./fixtures";

const cases = loadFixture("severity");
const byName = new Map(cases.map((c) => [c.name, c]));

describe("severity vocabulary", () => {
  it.each(casesUnder<{ value: unknown }>(cases, "parse"))("parse %s", ({ input, expected }) => {
    expectContract(() => parseSeverity(input.value), expected, { exactMessage: true });
  });

  it.each(casesUnder<{ value: unknown }>(cases, "parse_default"))(
    "parse with fallback %s",
    ({ input, expected }) => {
      expectContract(() => parseSeverity(input.value, "readability"), expected);
    },
  );

  it.each(casesUnder<{ value: unknown }>(cases, "rank_of"))("rank_of %s", ({ input, expected }) => {
    expect(severityRankOf(input.value)).toBe(expected);
  });

  it.each(casesUnder<{ value: unknown }>(cases, "label"))("label %s", ({ input, expected }) => {
    expect(severityLabel(input.value)).toBe(expected);
  });

  it("shows the model exactly the accepted vocabulary", () => {
    expect(severityPromptVocabulary()).toBe(byName.get("prompt_vocabulary")?.expected);
  });

  it("declares members in significance order", () => {
    expect([...SEVERITIES]).toEqual(byName.get("members_in_order")?.expected);
    expect(Object.fromEntries(SEVERITIES.map((s) => [s, severityRank(s)]))).toEqual(
      byName.get("ranks")?.expected,
    );
    expect(SEVERITIES.length).toBe(byName.get("len")?.expected);
  });

  it("labels every member", () => {
    expect(Object.fromEntries(SEVERITIES.map((s) => [s, severityLabelOf(s)]))).toEqual(
      byName.get("labels")?.expected,
    );
  });
});

describe("language normalisation", () => {
  it.each(loadFixture<{ value: string | null }, string>("language"))(
    "language_name %s",
    ({ input, expected }) => {
      expect(languageName(input.value)).toBe(expected);
    },
  );
});
