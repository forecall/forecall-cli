import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { DOCS, summary, targetLabel } from "./summary.mjs";

const REPORT = {
  lintVersion: 2,
  toolCount: 3,
  scoreAvg: 51.3,
  confusablePairsTotal: 1,
  serverIssues: [
    { severity: "minor", code: "confusable_pair", tools: ["a", "b"] },
    { severity: "major", code: "repeated_note", tools: 3, words: 20, excerpt: "x" },
  ],
  tools: [
    {
      name: "get_forecast",
      score: 79,
      issues: [{ severity: "minor", code: "no_constraints" }],
    },
    {
      name: "search|all",
      score: 26,
      issues: [
        { severity: "minor", code: "no_return_info" },
        { severity: "major", code: "too_short", words: 1 },
        { severity: "critical", code: "no_description" },
      ],
    },
    { name: "ping", score: 49, issues: [] },
  ],
};

describe("summary", () => {
  const text = summary(REPORT, { target: "tools.json", version: "0.8.1" });

  it("heads with the target, the rules and the CLI version, then the totals", () => {
    assert.match(text, /^## Forecall lint · tools\.json\n\nScoring rules v2 · forecall 0\.8\.1\n/);
    assert.match(text, /\| 51\.3 \/ 100 \| 3 \| 1 \|/);
  });

  it("lists the server's findings, the heaviest first", () => {
    assert.match(
      text,
      /### Across the server\n\n- Major `repeated_note`\n- Minor `confusable_pair`\n/,
    );
  });

  it("lists the tools lowest first, critical before major, and counts the minor ones", () => {
    const rows = text.split("\n").filter((line) => /^\| \d+ \|/.test(line));
    assert.deepEqual(rows, [
      "| 26 | `search\\|all` | `no_description`, `too_short` | 1 |",
      "| 49 | `ping` | — | 0 |",
      "| 79 | `get_forecast` | — | 1 |",
    ]);
  });

  it("says what a score is and where the findings are explained", () => {
    assert.ok(text.includes("not which tool a model will pick"));
    assert.ok(text.includes(DOCS));
  });

  it("leaves out the sections a report has nothing for", () => {
    const empty = summary(
      { ...REPORT, serverIssues: [], tools: [] },
      { target: "x", version: "1.0.0" },
    );
    assert.ok(!empty.includes("### "));
  });
});

describe("targetLabel", () => {
  it("names a file as given, a URL without its query, and a command by what it is", () => {
    assert.equal(targetLabel("file", "mcp/tools.json"), "mcp/tools.json");
    assert.equal(
      targetLabel("url", "https://mcp.example.com/mcp?token=secret#x"),
      "https://mcp.example.com/mcp",
    );
    assert.equal(targetLabel("url", "not a url"), "a URL");
    assert.equal(
      targetLabel("command", "node server.js --key abc"),
      "the server your command started",
    );
  });
});

describe("the script", () => {
  it("appends the summary and writes the outputs the action reads", () => {
    const dir = mkdtempSync(join(tmpdir(), "forecall-action-"));
    const report = join(dir, "report.json");
    writeFileSync(report, JSON.stringify(REPORT));
    const env = {
      ...process.env,
      FORECALL_REPORT: report,
      FORECALL_KIND: "url",
      FORECALL_TARGET: "https://mcp.example.com/mcp?token=secret",
      FORECALL_VERSION: "0.8.1",
      GITHUB_STEP_SUMMARY: join(dir, "summary.md"),
      GITHUB_OUTPUT: join(dir, "output"),
    };
    writeFileSync(env.GITHUB_STEP_SUMMARY, "");
    writeFileSync(env.GITHUB_OUTPUT, "");
    execFileSync(process.execPath, [new URL("./summary.mjs", import.meta.url).pathname], { env });
    const written = readFileSync(env.GITHUB_STEP_SUMMARY, "utf8");
    assert.match(written, /^## Forecall lint · https:\/\/mcp\.example\.com\/mcp\n/);
    assert.ok(!written.includes("secret"));
    assert.equal(
      readFileSync(env.GITHUB_OUTPUT, "utf8"),
      `score=51.3\ntools=3\nreport=${report}\n`,
    );
  });
});
