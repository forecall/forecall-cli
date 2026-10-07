import { describe, expect, it } from "vitest";
import { diffVersions, MAX_DIFF_CELLS, type TextChange, textDiff } from "./diff.ts";
import { lintTools } from "./lint.ts";
import type { Tool } from "./tool.ts";

const side = (tools: Tool[]) => ({ report: lintTools(tools), tools });
const join = (parts: TextChange[], kind: "added" | "removed") =>
  parts
    .filter((part) => part.kind !== kind)
    .map((part) => part.text)
    .join("");

describe("textDiff", () => {
  it.each([
    ["", "", []],
    ["same text", "same text", [{ kind: "same", text: "same text" }]],
    ["", "new", [{ kind: "added", text: "new" }]],
    ["old", "", [{ kind: "removed", text: "old" }]],
    [
      "Finds a page.",
      "Finds a page by its title.",
      [
        { kind: "same", text: "Finds a " },
        { kind: "removed", text: "page." },
        { kind: "added", text: "page by its title." },
      ],
    ],
    [
      "Returns the user.",
      "Returns one user.",
      [
        { kind: "same", text: "Returns " },
        { kind: "removed", text: "the" },
        { kind: "added", text: "one" },
        { kind: "same", text: " user." },
      ],
    ],
  ])("diffs %j and %j", (before, after, expected) => {
    const parts = textDiff(before, after);
    expect(parts).toEqual(expected);
    expect(join(parts, "added")).toBe(before);
    expect(join(parts, "removed")).toBe(after);
  });

  it("shows a very long change as removed then added", () => {
    const before = "a ".repeat(1001);
    const after = "b ".repeat(1001);
    expect(before.length * after.length).toBeGreaterThan(MAX_DIFF_CELLS);
    expect(textDiff(before, after)).toEqual([
      { kind: "removed", text: before },
      { kind: "added", text: after },
    ]);
  });
});

const SEARCH: Tool = {
  name: "search",
  description: "Finds pages.",
  inputSchema: {
    type: "object",
    properties: {
      q: { type: "string", description: "Words to look for." },
      limit: { type: "integer" },
      filter: { type: "object", properties: { tag: { type: "string" } } },
    },
    required: ["q"],
  },
};
const FETCH: Tool = { name: "fetch", description: "Fetches a page." };
const DELETE: Tool = { name: "delete_page", description: "Deletes a page." };

describe("diffVersions", () => {
  it("finds nothing between the same tools", () => {
    const diff = diffVersions(side([SEARCH, FETCH]), side([SEARCH, FETCH]));
    expect(diff).toMatchObject({
      sameRules: true,
      added: [],
      removed: [],
      changed: [],
      serverIssuesResolved: [],
      serverIssuesAdded: [],
    });
    expect(diff.scoreAvg.before).toBe(diff.scoreAvg.after);
  });

  it("lists the tools added and removed with their scores", () => {
    const before = side([SEARCH, DELETE]);
    const after = side([SEARCH, FETCH]);
    const diff = diffVersions(before, after);
    expect(diff.added).toEqual([{ name: "fetch", score: after.report.tools[1]?.score }]);
    expect(diff.removed).toEqual([{ name: "delete_page", score: before.report.tools[1]?.score }]);
    expect(diff.scoreAvg).toEqual({ before: before.report.scoreAvg, after: after.report.scoreAvg });
  });

  it("diffs a tool's description, score and issues", () => {
    const better: Tool = {
      ...FETCH,
      description:
        "Fetches a page by its URL. Use this when you have the URL; use search otherwise. Returns the page's text.",
    };
    const before = side([FETCH]);
    const after = side([better]);
    const [tool] = diffVersions(before, after).changed;
    expect(tool?.name).toBe("fetch");
    expect(tool?.score).toEqual({
      before: before.report.tools[0]?.score,
      after: after.report.tools[0]?.score,
    });
    expect(tool?.score.after).toBeGreaterThan(tool?.score.before ?? 100);
    expect(tool?.issuesResolved.map((issue) => issue.code)).toContain("no_usage_context");
    expect(tool?.issuesAdded).toEqual([]);
    expect(tool?.description?.[0]).toEqual({ kind: "same", text: "Fetches a " });
    expect(tool?.arguments).toEqual([]);
  });

  it("diffs the arguments: added, removed, a new description, and other schema changes", () => {
    const next: Tool = {
      ...SEARCH,
      inputSchema: {
        type: "object",
        properties: {
          q: { type: "string", description: "Words to look for, at least 2 characters." },
          limit: { type: "integer", maximum: 50 },
          filter: { type: "object", properties: { lang: { type: "string" } } },
          cursor: { type: "string", description: "From the last page." },
        },
        required: ["q", "limit"],
      },
    };
    const [tool] = diffVersions(side([SEARCH]), side([next])).changed;
    expect(tool?.arguments).toEqual([
      {
        path: "q",
        change: "changed",
        description: [
          { kind: "same", text: "Words to look " },
          { kind: "removed", text: "for." },
          { kind: "added", text: "for, at least 2 characters." },
        ],
        schemaChanged: false,
      },
      { path: "limit", change: "changed", description: [], schemaChanged: true },
      {
        path: "filter.lang",
        change: "added",
        description: [],
        schemaChanged: false,
      },
      {
        path: "cursor",
        change: "added",
        description: [{ kind: "added", text: "From the last page." }],
        schemaChanged: false,
      },
      { path: "filter.tag", change: "removed", description: [], schemaChanged: false },
    ]);
    expect(tool?.description).toBeNull();
  });

  it("keeps a tool whose only change is an argument's type", () => {
    const next: Tool = {
      ...SEARCH,
      inputSchema: {
        type: "object",
        properties: {
          q: { type: "number", description: "Words to look for." },
          limit: { type: "integer" },
          filter: { type: "object", properties: { tag: { type: "string" } } },
        },
        required: ["q"],
      },
    };
    const diff = diffVersions(side([SEARCH]), side([next]));
    expect(diff.changed.map((tool) => tool.arguments)).toEqual([
      [
        {
          path: "q",
          change: "changed",
          description: [{ kind: "same", text: "Words to look for." }],
          schemaChanged: true,
        },
      ],
    ]);
  });

  it("finds the server's issues resolved and new", () => {
    const twin: Tool = { name: "fetch_page", description: FETCH.description };
    const before = side([FETCH, twin]);
    const after = side([FETCH, { ...twin, description: "Downloads a page by URL." }]);
    const diff = diffVersions(before, after);
    expect(diff.serverIssuesResolved.map((issue) => issue.code)).toContain("identical_description");
    expect(diff.serverIssuesAdded.map((issue) => issue.code)).not.toContain(
      "identical_description",
    );
    const back = diffVersions(after, before);
    expect(back.serverIssuesAdded.map((issue) => issue.code)).toContain("identical_description");
  });

  it("says when the two versions were scored by different rules", () => {
    const before = side([FETCH]);
    const old = {
      ...before,
      report: { ...before.report, lintVersion: before.report.lintVersion - 1 },
    };
    expect(diffVersions(old, side([FETCH])).sameRules).toBe(false);
  });

  it("reads a tool with no stored definition as having no description", () => {
    const after = side([FETCH]);
    const diff = diffVersions({ report: after.report, tools: [] }, after);
    expect(diff.changed[0]?.description).toEqual([{ kind: "added", text: FETCH.description }]);
  });
});
