// The job summary and outputs of the Forecall lint action (action.yml, ADR-0056 in
// forecall/forecall): reads the report `forecall lint --json` wrote, appends a Markdown summary to
// $GITHUB_STEP_SUMMARY and writes the step's outputs to $GITHUB_OUTPUT. No dependencies, so it runs
// on the runner's Node as it is.
import { appendFileSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const RANK = { critical: 0, major: 1, minor: 2 };
const SEVERITY = { critical: "Critical", major: "Major", minor: "Minor" };
export const DOCS = "https://forecall.dev/en/docs/reading-scores";

/** Text for a Markdown table cell: no pipes or line breaks, code spans kept intact. */
const cell = (text) => String(text).replaceAll("|", "\\|").replaceAll(/\r?\n/g, " ");
const code = (text) => `\`${cell(text).replaceAll("`", "'")}\``;

/** Where the tools came from, without a URL's query or fragment (it may hold a token). */
export function targetLabel(kind, value) {
  if (kind === "url") {
    try {
      const url = new URL(value);
      return `${url.origin}${url.pathname}`;
    } catch {
      return "a URL";
    }
  }
  if (kind === "command") return "the server your command started";
  return value;
}

/** The summary of one report, in Markdown. */
export function summary(report, { target, version }) {
  const lines = [
    `## Forecall lint · ${cell(target)}`,
    "",
    `Scoring rules v${report.lintVersion} · forecall ${cell(version)}`,
    "",
    "| Average score | Tools | Near-identical descriptions |",
    "|---:|---:|---:|",
    `| ${report.scoreAvg} / 100 | ${report.toolCount} | ${report.confusablePairsTotal} |`,
  ];
  const server = [...(report.serverIssues ?? [])].sort(
    (a, b) => (RANK[a.severity] ?? 3) - (RANK[b.severity] ?? 3),
  );
  if (server.length > 0) {
    lines.push("", "### Across the server", "");
    for (const issue of server) lines.push(`- ${SEVERITY[issue.severity]} ${code(issue.code)}`);
  }
  const tools = [...report.tools].sort((a, b) => a.score - b.score || (a.name < b.name ? -1 : 1));
  if (tools.length > 0) {
    lines.push(
      "",
      "### Tools, lowest score first",
      "",
      "| Score | Tool | Critical and major findings | Minor findings |",
      "|---:|---|---|---:|",
    );
    for (const tool of tools) {
      const heavy = tool.issues
        .filter((issue) => issue.severity !== "minor")
        .sort((a, b) => RANK[a.severity] - RANK[b.severity])
        .map((issue) => code(issue.code));
      const minor = tool.issues.filter((issue) => issue.severity === "minor").length;
      lines.push(
        `| ${tool.score} | ${code(tool.name)} | ${heavy.length > 0 ? heavy.join(", ") : "—"} | ${minor} |`,
      );
    }
  }
  lines.push(
    "",
    `A score says what a description covers, not which tool a model will pick. What each finding means: ${DOCS}`,
    "",
  );
  return lines.join("\n");
}

function main() {
  const report = JSON.parse(readFileSync(process.env.FORECALL_REPORT, "utf8"));
  const target = targetLabel(process.env.FORECALL_KIND, process.env.FORECALL_TARGET ?? "");
  const text = summary(report, { target, version: process.env.FORECALL_VERSION ?? "" });
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, text);
  else process.stdout.write(text);
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `score=${report.scoreAvg}\ntools=${report.toolCount}\nreport=${process.env.FORECALL_REPORT}\n`,
    );
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
