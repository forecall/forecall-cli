import { describe, expect, it } from "vitest";
import cases from "./fixtures/cases.json";
import { LINT_VERSION, type LintReport, lintTools, type ServerIssue } from "./lint.ts";
import type { Tool } from "./tool.ts";
import { parseToolsList, readToolsList } from "./tools-list.ts";

function lintPasted(tools: unknown[]): LintReport {
  const parsed = parseToolsList(JSON.stringify({ tools }));
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.error));
  return lintTools(parsed.tools);
}

/** The prototype's lint_file result, with the values its messages carry (fixtures/cases.json). */
function asPrototype(report: LintReport) {
  const detail = (issue: ServerIssue) => {
    switch (issue.code) {
      case "confusable_pair":
        return [...issue.tools, issue.similarity, issue.nameSimilarity];
      case "confusable_pair_total":
        return issue.total;
      case "identical_description":
        return issue.tools.length;
      default:
        return issue.count;
    }
  };
  return {
    toolCount: report.toolCount,
    scoreAvg: report.scoreAvg,
    confusablePairsTotal: report.confusablePairsTotal,
    serverIssues: report.serverIssues.map((issue) => [issue.severity, issue.code, detail(issue)]),
  };
}

/** Tools whose descriptions differ in one word, so every two of them are a confusable pair. */
function lookalikes(count: number): Tool[] {
  return Array.from({ length: count }, (_, i) => ({
    name: `find_records_${i}`,
    description: `Finds the archived customer records that match a title and returns their ids, variant${i}.`,
  }));
}

describe("lintTools matches the Python prototype's lint_file", () => {
  // Server issues are compared in order: which 12 pairs are shown depends on the stable sort.
  it.each(cases.servers.map((entry) => [entry.name, entry] as const))(
    "on the synthetic server %s",
    (_, { tools, expected }) => {
      const read = readToolsList(tools);
      if (!read.ok) throw new Error(JSON.stringify(read.error));
      expect(asPrototype(lintTools(read.tools))).toEqual(expected);
    },
  );
});

describe("confusable pairs", () => {
  it("shows 12 pairs and counts the rest", () => {
    const report = lintTools(lookalikes(7));
    // 7 tools make 21 pairs.
    expect(report.confusablePairsTotal).toBe(21);
    expect(report.serverIssues.filter((issue) => issue.code === "confusable_pair")).toHaveLength(
      12,
    );
    expect(report.serverIssues).toContainEqual({
      severity: "major",
      code: "confusable_pair_total",
      total: 21,
    });
  });

  it("gives no total when every pair is shown", () => {
    const report = lintTools(lookalikes(5));
    expect(report.confusablePairsTotal).toBe(10);
    expect(report.serverIssues.map((issue) => issue.code)).not.toContain("confusable_pair_total");
  });
});

describe("LintReport", () => {
  it("is plain JSON, so it can be stored as is", () => {
    const report = lintPasted(cases.servers.flatMap((server) => server.tools));
    expect(JSON.parse(JSON.stringify(report))).toStrictEqual(report);
  });

  it("carries the lint version", () => {
    expect(lintTools([]).lintVersion).toBe(LINT_VERSION);
  });

  it("names the tools that share a description", () => {
    const tools: Tool[] = [
      { name: "a", description: "Same text." },
      { name: "b", description: " Same text.\n" },
      { name: "c", description: "Other text." },
    ];
    expect(lintTools(tools).serverIssues).toContainEqual({
      severity: "critical",
      code: "identical_description",
      tools: ["a", "b"],
    });
  });
});
