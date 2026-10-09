import { describe, expect, it } from "vitest";
import cases from "./fixtures/cases.json";
import { LINT_VERSION, type LintReport, lintTools, type ServerIssue } from "./lint.ts";
import { words } from "./text.ts";
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
      case "too_many_tools":
      case "many_tools":
        return issue.count;
      case "repeated_note":
        return [issue.tools, issue.words];
      case "instructions_long":
        return issue.length;
      default:
        return undefined;
    }
  };
  // The prototype rated the pairs major; they are minor since 0.3.0 (forecall-cli#16). The record
  // keeps the prototype's word.
  const severity = (issue: ServerIssue) =>
    issue.code === "confusable_pair" || issue.code === "confusable_pair_total"
      ? "major"
      : issue.severity;
  return {
    toolCount: report.toolCount,
    scoreAvg: report.scoreAvg,
    confusablePairsTotal: report.confusablePairsTotal,
    serverIssues: report.serverIssues.map((issue) => [severity(issue), issue.code, detail(issue)]),
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
      severity: "minor",
      code: "confusable_pair_total",
      total: 21,
    });
    // Minor since 0.3.0: models tell such pairs apart by their names and schemas (#16).
    for (const issue of report.serverIssues) {
      if (issue.code === "confusable_pair") expect(issue.severity).toBe("minor");
    }
  });

  it("gives no total when every pair is shown", () => {
    const report = lintTools(lookalikes(5));
    expect(report.confusablePairsTotal).toBe(10);
    expect(report.serverIssues.map((issue) => issue.code)).not.toContain("confusable_pair_total");
  });
});

/** A note of some forty words that a server author pasted into every tool (forecall-cli#12). */
const NOTE =
  "Important: this server only reaches the archive of the Northwind company, which holds its invoices, customers, orders and shipments from 2015 on. It does not search the public web, other companies, or anything outside that archive.";

/** Seven tools that say one thing each, with or without the note after it. */
function archiveTools(withNote: boolean): Tool[] {
  const own = [
    ["get_invoice", "Fetch one invoice by its id and return it as JSON."],
    ["get_customer", "Fetch one customer by its id and return it as JSON."],
    ["get_order", "Fetch one order by its id and return it as JSON."],
    ["get_shipment", "Fetch one shipment by its id and return it as JSON."],
    ["list_invoices", "List the invoices of a customer, newest first, up to 50."],
    ["list_orders", "List the orders of a customer, newest first, up to 50."],
    ["search_archive", "Search the archive by free text and return matching ids."],
  ];
  return own.map(([name, description]) => ({
    name: name as string,
    description: withNote ? `${description} ${NOTE}` : description,
  }));
}

describe("scoring rules v2: a note repeated in most tools (forecall-cli#12)", () => {
  it("scores and compares each tool on what it alone says, and reports the note once", () => {
    const withNote = lintTools(archiveTools(true));
    const without = lintTools(archiveTools(false));
    expect(withNote.tools).toEqual(without.tools);
    expect(withNote.scoreAvg).toBe(without.scoreAvg);
    expect(withNote.confusablePairsTotal).toBe(without.confusablePairsTotal);
    expect(without.serverIssues.map((issue) => issue.code)).not.toContain("repeated_note");
    expect(withNote.serverIssues).toContainEqual({
      severity: "major",
      code: "repeated_note",
      tools: 7,
      words: words(NOTE).length,
      excerpt: `${NOTE.slice(0, 79)}…`,
    });
  });

  it("leaves a short shared sentence in place, where it still counts in every tool", () => {
    const short = "Only works within allowed directories.";
    const tools = archiveTools(false).map((tool) => ({
      ...tool,
      description: `${tool.description} ${short}`,
    }));
    const report = lintTools(tools);
    expect(report.serverIssues.map((issue) => issue.code)).not.toContain("repeated_note");
    const own = lintTools(archiveTools(false));
    for (const [i, tool] of report.tools.entries()) {
      expect(tool.words).toBe((own.tools[i]?.words ?? 0) + words(short).length);
    }
  });
});

describe("the server's instructions (forecall-cli#12)", () => {
  const tools = archiveTools(false);
  const about = (report: LintReport) =>
    report.serverIssues
      .map((issue) => issue.code)
      .filter((code) => code.startsWith("instructions_"));
  const codes = (instructions: string | undefined) =>
    about(lintTools(tools, { handshake: { instructions } }));

  it("says nothing about them without the handshake: a bare tools/list cannot tell", () => {
    expect(about(lintTools(tools))).toEqual([]);
  });

  it.each([
    ["absent", undefined, ["instructions_missing"]],
    ["empty", "", ["instructions_missing"]],
    ["blank", " \n", ["instructions_missing"]],
    ["short", "Tools for the Northwind archive.", []],
    ["at Claude Code's limit", "x".repeat(2048), []],
    ["over Claude Code's limit", "x".repeat(2049), ["instructions_long"]],
  ])("reports %s instructions as %j", (_, instructions, expected) => {
    expect(codes(instructions)).toEqual(expected);
  });

  it("says how long they are", () => {
    expect(
      lintTools(tools, { handshake: { instructions: "y".repeat(3000) } }).serverIssues,
    ).toContainEqual({ severity: "minor", code: "instructions_long", length: 3000 });
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
