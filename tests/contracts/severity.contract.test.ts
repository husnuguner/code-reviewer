import { describe, expect, it } from "bun:test";

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

import { caseNamed, casesUnder, expectContract, loadFixture } from "./fixtures";

const cases = loadFixture("severity");

describe("severity vocabulary", () => {
  it.each(casesUnder<{ value: unknown }>(cases, "parse"))("parse $name", ({ input, expected }) => {
    expectContract(() => parseSeverity(input.value), expected, { exactMessage: true });
  });

  it.each(casesUnder<{ value: unknown }>(cases, "parse_default"))(
    "parse with fallback $name",
    ({ input, expected }) => {
      expectContract(() => parseSeverity(input.value, "readability"), expected);
    },
  );

  it.each(casesUnder<{ value: unknown }, number>(cases, "rank_of"))(
    "rank_of $name",
    ({ input, expected }) => {
      expect(severityRankOf(input.value)).toBe(expected);
    },
  );

  it.each(casesUnder<{ value: unknown }, string>(cases, "label"))(
    "label $name",
    ({ input, expected }) => {
      expect(severityLabel(input.value)).toBe(expected);
    },
  );

  it("shows the model exactly the accepted vocabulary", () => {
    expect(severityPromptVocabulary()).toBe(
      caseNamed<unknown, string>(cases, "prompt_vocabulary").expected,
    );
  });

  it("declares members in significance order", () => {
    expect<string[]>([...SEVERITIES]).toEqual(
      caseNamed<unknown, string[]>(cases, "members_in_order").expected,
    );
    expect(Object.fromEntries(SEVERITIES.map((s) => [s, severityRank(s)]))).toEqual(
      caseNamed<unknown, Record<string, number>>(cases, "ranks").expected,
    );
    expect(SEVERITIES).toHaveLength(caseNamed<unknown, number>(cases, "len").expected);
  });

  it("labels every member", () => {
    expect(Object.fromEntries(SEVERITIES.map((s) => [s, severityLabelOf(s)]))).toEqual(
      caseNamed<unknown, Record<string, string>>(cases, "labels").expected,
    );
  });
});

describe("language normalisation", () => {
  it.each(loadFixture<{ value: string | null }, string>("language"))(
    "language_name $name",
    ({ input, expected }) => {
      expect(languageName(input.value)).toBe(expected);
    },
  );
});
