import type { LintReport } from "@forecall/lint/internal/lint";
import type { ToolScore } from "@forecall/lint/internal/score-tool";
import { describe, expect, it } from "vitest";
import { formatInputError, formatReport, sortTools, style, width } from "./format";
import { LANGS } from "./i18n";
import type { InputError } from "./input";

const components = {
  purpose: 20,
  usageContext: 0,
  parameters: 25,
  return: 0,
  constraints: 5,
  examples: 0,
};
const tool = (name: string, score: number, issues: ToolScore["issues"] = []): ToolScore => ({
  name,
  score,
  components,
  issues,
  words: 10,
  paramCount: 1,
});
const REPORT: LintReport = {
  lintVersion: 1,
  toolCount: 3,
  scoreAvg: 50,
  confusablePairsTotal: 1,
  tools: [
    tool("b_tool", 50, [{ severity: "major", code: "no_usage_context" }]),
    tool("a_tool", 50),
    tool("c_tool", 20, [{ severity: "critical", code: "no_description" }]),
  ],
  serverIssues: [
    {
      severity: "major",
      code: "confusable_pair",
      tools: ["a_tool", "b_tool"],
      similarity: 0.8,
      nameSimilarity: 0.5,
    },
  ],
};
const plain = style(false, undefined);

describe("formatReport", () => {
  const text = formatReport(REPORT, { lang: "en", source: "tools.json", style: plain });

  it("starts with the file and the scoring rules version", () => {
    expect(text.split("\n").slice(0, 2)).toEqual([
      "Forecall lint · tools.json",
      "Scoring rules v1",
    ]);
  });

  it("aligns the summary", () => {
    expect(text).toContain(
      "Average score     50.0 / 100\nTools             3\nConfusable pairs  1\n",
    );
  });

  it("shows the pair's similarities under it", () => {
    expect(text).toContain(
      "  Major     confusable_pair  a_tool and b_tool are easy to mix up.\n" +
        "                             Description similarity 0.80 · Name similarity 0.50\n",
    );
  });

  it("lists the tools lowest score first, then by name, with their components", () => {
    const names = [...text.matchAll(/^ {2}\d+ \/ 100 {2}(\S+)$/gm)].map((match) => match[1]);
    expect(names).toEqual(["c_tool", "a_tool", "b_tool"]);
    expect(text).toContain(
      "    Purpose 20/20 · When to use 0/20 · Arguments 25/25 · Return value 0/15 · " +
        "Constraints and side effects 5/10 · Examples 0/10\n",
    );
    expect(text).toContain("  50 / 100  a_tool\n    Purpose");
    expect(text).toContain("    No issues.\n");
  });

  it("ends with the limits of static scoring and where to share", () => {
    expect(text).toContain("What static scoring cannot tell\n  This score reads only");
    expect(text.endsWith("paste the same JSON at https://forecall.dev/en/lint\n")).toBe(true);
  });

  it("says when there are no server-wide issues, and names standard input", () => {
    const ja = formatReport(
      { ...REPORT, serverIssues: [] },
      { lang: "ja", source: "-", style: plain },
    );
    expect(ja.startsWith("Forecall lint · 標準入力\n")).toBe(true);
    expect(ja).toContain("サーバー全体\n  サーバー全体の指摘はありません。\n");
    expect(ja).toContain("https://forecall.dev/ja/lint");
  });

  it("aligns Japanese labels by their width in a terminal", () => {
    const ja = formatReport(REPORT, { lang: "ja", source: "x", style: plain });
    expect(ja).toContain("平均点            50.0 / 100\nツールの数        3\n");
  });
});

describe("style", () => {
  it("colors severities and headings only when asked", () => {
    expect(style(true, undefined).severity("critical", "x")).toBe("\u001b[31mx\u001b[0m");
    expect(style(true, "").bold("x")).toBe("\u001b[1mx\u001b[0m");
    expect(style(true, "1").bold("x")).toBe("x");
    expect(style(false, undefined).severity("minor", "x")).toBe("x");
  });
});

describe("width", () => {
  it.each([
    ["Tools", 5],
    ["平均点", 6],
    ["ツール", 6],
    ["ｱ", 1],
    ["Ａ", 2],
  ])("%s takes %i columns", (text, columns) => {
    expect(width(text)).toBe(columns);
  });
});

describe("sortTools", () => {
  it("does not change the report", () => {
    const tools = [tool("b", 2), tool("a", 1)];
    expect(sortTools(tools).map((x) => x.name)).toEqual(["a", "b"]);
    expect(tools.map((x) => x.name)).toEqual(["b", "a"]);
  });
});

const ERRORS: InputError[] = [
  { code: "empty" },
  { code: "not_found", file: "x.json" },
  { code: "unreadable", file: "x.json", reason: "EACCES" },
  { code: "input_too_large", limit: 1_048_576 },
  { code: "invalid_json" },
  { code: "unrecognized_shape" },
  { code: "too_many_tools", count: 201, limit: 200 },
  { code: "invalid_tool", path: "tools[0].name", expected: "non-empty string" },
  {
    code: "snake_case_keys",
    keys: [{ path: "tools[0].input_schema", key: "input_schema", expected: "inputSchema" }],
  },
];

describe("formatInputError", () => {
  it.each(LANGS)("fills every placeholder in %s", (lang) => {
    for (const error of ERRORS) {
      const message = formatInputError(error, lang);
      expect(message, error.code).not.toMatch(/\{(file|reason|count|limit|path|expected)\}/);
      expect(message.endsWith("\n"), error.code).toBe(true);
    }
  });

  it("lists the snake_case keys with their camelCase spelling", () => {
    expect(formatInputError(ERRORS[8] as InputError, "en")).toContain(
      "\n  tools[0].input_schema → inputSchema\n",
    );
  });

  it("does not ask to paste, as the web form does", () => {
    expect(formatInputError({ code: "unrecognized_shape" }, "en")).not.toContain("Paste");
  });
});
