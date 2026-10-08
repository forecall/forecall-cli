import { describe, expect, it } from "vitest";
import { ISSUE_CODES } from "./codes.ts";
import type { ServerIssue } from "./lint.ts";
import en from "./messages/en.json" with { type: "json" };
import ja from "./messages/ja.json" with { type: "json" };
import { issueMessage, type Lang } from "./messages.ts";
import type { ToolIssue } from "./score-tool.ts";

const ISSUES: (ToolIssue | ServerIssue)[] = [
  { severity: "critical", code: "no_description" },
  { severity: "major", code: "restates_name", words: 3 },
  { severity: "major", code: "too_short", words: 4 },
  { severity: "minor", code: "too_long", words: 401 },
  { severity: "major", code: "no_usage_context" },
  { severity: "major", code: "param_no_description", params: ["a", "b.c"] },
  { severity: "minor", code: "loose_string_param", params: ["q"] },
  { severity: "minor", code: "no_required" },
  { severity: "minor", code: "params_not_in_description" },
  { severity: "minor", code: "vague_boolean", param: "flag" },
  { severity: "minor", code: "no_return_info" },
  { severity: "minor", code: "no_constraints" },
  { severity: "major", code: "destructive_unmarked" },
  { severity: "major", code: "generic_name" },
  { severity: "minor", code: "long_name", length: 41 },
  { severity: "major", code: "bad_name_chars" },
  { severity: "major", code: "too_many_tools", count: 41 },
  { severity: "minor", code: "many_tools", count: 29 },
  {
    severity: "major",
    code: "confusable_pair",
    tools: ["x", "y"],
    similarity: 0.88,
    nameSimilarity: 0.33,
  },
  { severity: "major", code: "confusable_pair_total", total: 57 },
  { severity: "critical", code: "identical_description", tools: ["p", "q"] },
  { severity: "major", code: "repeated_note", tools: 7, words: 150, excerpt: "IMPORTANT - …" },
  { severity: "minor", code: "instructions_long", length: 2904 },
  { severity: "minor", code: "instructions_missing" },
];

describe("issueMessage", () => {
  it("covers all 24 issue codes", () => {
    expect(new Set(ISSUES.map((issue) => issue.code)).size).toBe(24);
    expect(ISSUES.map((issue) => issue.code).toSorted()).toEqual(
      Object.keys(ISSUE_CODES).toSorted(),
    );
    for (const issue of ISSUES) {
      expect(ISSUE_CODES[issue.code].severities as string[], issue.code).toContain(issue.severity);
    }
  });

  it("has the same sentences in every language, one for each code", () => {
    expect(Object.keys(ja).toSorted()).toEqual(Object.keys(en).toSorted());
    expect(Object.keys(en).toSorted()).toEqual([...new Set(ISSUES.map((i) => i.code))].toSorted());
  });

  it.each<Lang>(["en", "ja"])("fills every placeholder in %s", (lang) => {
    for (const issue of ISSUES) {
      const message = issueMessage(lang, issue);
      expect(message, issue.code).not.toMatch(/\{\w+\}/);
      expect(message, issue.code).not.toBe("");
    }
  });

  it("joins lists in each language's way", () => {
    const issue = ISSUES[5] as ToolIssue;
    expect(issueMessage("en", issue)).toBe("Arguments without a description: a, b.c.");
    expect(issueMessage("ja", issue)).toBe("説明のない引数: a、b.c");
    const identical = ISSUES[20] as ServerIssue;
    expect(issueMessage("en", identical)).toBe("These tools share the same description: p, q.");
  });

  // A pointer to the other tool in each description tells them apart (#7).
  it("names both tools of a confusable pair, and asks each to point to the other", () => {
    expect(issueMessage("en", ISSUES[18] as ServerIssue)).toBe(
      "x and y are easy to mix up. In each description, say when to use the other one instead.",
    );
  });

  it("says one word or several, as each language does", () => {
    const short = (words: number): ToolIssue => ({ severity: "major", code: "too_short", words });
    expect(issueMessage("en", short(1))).toBe("The description is too short (1 word).");
    expect(issueMessage("en", short(4))).toBe("The description is too short (4 words).");
    expect(issueMessage("ja", short(1))).toBe(issueMessage("ja", short(4)).replace("4", "1"));
    expect(issueMessage("en", { severity: "major", code: "restates_name", words: 1 })).toBe(
      "The description only restates the name (1 word).",
    );
    for (const lang of ["en", "ja"] as const) {
      for (const issue of ISSUES) {
        expect(issueMessage(lang, issue), issue.code).not.toMatch(/#|plural/);
      }
    }
  });
});
