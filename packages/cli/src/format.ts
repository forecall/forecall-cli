// The human-readable report and error messages. The issues' sentences come from @forecall/lint,
// as on forecall.dev's result page, so both say the same thing for the same input.

import type { LintReport, ServerIssue, ToolComponents, ToolIssue, ToolScore } from "@forecall/lint";
import { issueMessage } from "@forecall/lint/internal/messages";
import { type Lang, t } from "./i18n";
import type { InputError } from "./input";
import { brand } from "./shared";

/** Maximum points per component, in the order forecall.dev shows them. */
const COMPONENTS: [keyof ToolComponents, number][] = [
  ["purpose", 20],
  ["usageContext", 20],
  ["parameters", 25],
  ["return", 15],
  ["constraints", 10],
  ["examples", 10],
];

type Severity = ToolIssue["severity"];

export interface Style {
  bold(text: string): string;
  severity(severity: Severity, text: string): string;
}

const SGR = (code: number) => (text: string) => `\u001b[${code}m${text}\u001b[0m`;
const SEVERITY_SGR: Record<Severity, (text: string) => string> = {
  critical: SGR(31),
  major: SGR(33),
  minor: SGR(36),
};

/** ANSI colors, only for a terminal and when NO_COLOR is unset or empty (no-color.org). */
export function style(isTTY: boolean, noColor: string | undefined): Style {
  if (!isTTY || (noColor !== undefined && noColor !== "")) {
    return { bold: (text) => text, severity: (_, text) => text };
  }
  return { bold: SGR(1), severity: (severity, text) => SEVERITY_SGR[severity](text) };
}

/** Columns a string takes in a terminal: CJK and full-width characters take two. */
export function width(text: string): number {
  let columns = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    const wide =
      (code >= 0x1100 && code <= 0x115f) ||
      (code >= 0x2e80 && code <= 0xa4cf) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe30 && code <= 0xfe4f) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6);
    columns += wide ? 2 : 1;
  }
  return columns;
}

const pad = (text: string, columns: number) =>
  text + " ".repeat(Math.max(0, columns - width(text)));

/** The tools to list: lowest score first, then by name, like forecall.dev's result page. */
export function sortTools(tools: ToolScore[]): ToolScore[] {
  return tools.toSorted((a, b) => a.score - b.score || a.name.localeCompare(b.name));
}

/** The whole report as lines of text, ending with a newline. */
export function formatReport(
  report: LintReport,
  { lang, source, style: s }: { lang: Lang; source: string; style: Style },
): string {
  const lines: string[] = [];
  const file = source === "-" ? t(lang, "cli.stdin") : source;
  lines.push(s.bold(`${brand.name} lint · ${file}`));
  lines.push(`${t(lang, "result.meta.rules")} v${report.lintVersion}`, "");

  const summary: [string, string][] = [
    [t(lang, "result.summary.average"), `${report.scoreAvg.toFixed(1)} / 100`],
    [t(lang, "result.summary.tools"), String(report.toolCount)],
    [t(lang, "result.summary.pairs"), String(report.confusablePairsTotal)],
  ];
  const labelWidth = Math.max(...summary.map(([label]) => width(label)));
  for (const [label, value] of summary) lines.push(`${pad(label, labelWidth)}  ${value}`);

  const severityWidth = Math.max(
    ...(["critical", "major", "minor"] as const).map((x) => width(t(lang, `result.severity.${x}`))),
  );
  const issueLines = (issues: (ToolIssue | ServerIssue)[], indent: string) => {
    const codeWidth = Math.max(0, ...issues.map((issue) => issue.code.length));
    for (const issue of issues) {
      const label = pad(t(lang, `result.severity.${issue.severity}`), severityWidth);
      const head = `${indent}${s.severity(issue.severity, label)}  ${pad(issue.code, codeWidth)}  `;
      lines.push(head + issueMessage(lang, issue));
      if (issue.code === "confusable_pair") {
        const similarity = `${t(lang, "result.pairs.similarity")} ${issue.similarity.toFixed(2)}`;
        const name = `${t(lang, "result.pairs.nameSimilarity")} ${issue.nameSimilarity.toFixed(2)}`;
        lines.push(`${" ".repeat(width(head))}${similarity} · ${name}`);
      }
    }
  };

  lines.push("", s.bold(t(lang, "result.server.heading")));
  if (report.serverIssues.length === 0) lines.push(`  ${t(lang, "result.server.none")}`);
  issueLines(report.serverIssues, "  ");

  lines.push("", s.bold(t(lang, "result.tools.heading")));
  for (const tool of sortTools(report.tools)) {
    lines.push("", `  ${s.bold(`${tool.score} / 100`)}  ${tool.name}`);
    const components = COMPONENTS.map(
      ([key, max]) => `${t(lang, `result.component.${key}`)} ${tool.components[key]}/${max}`,
    );
    lines.push(`    ${components.join(" · ")}`);
    if (tool.issues.length === 0) lines.push(`    ${t(lang, "result.tools.noIssues")}`);
    issueLines(tool.issues, "    ");
  }

  lines.push("", s.bold(t(lang, "result.limits.heading")), `  ${t(lang, "result.limits.body")}`);
  lines.push("", t(lang, "cli.share", { url: `https://${brand.domain}/${lang}/lint` }), "");
  return lines.join("\n");
}

/** Why the input could not be scored, in the report's language, ending with a newline. */
export function formatInputError(error: InputError, lang: Lang): string {
  switch (error.code) {
    case "empty":
      return `${t(lang, "cli.error.empty")}\n`;
    case "not_found":
      return `${t(lang, "cli.error.notFound", { file: error.file })}\n`;
    case "unreadable":
      return `${t(lang, "cli.error.unreadable", { file: error.file, reason: error.reason })}\n`;
    case "input_too_large":
      return `${t(lang, "lint.error.inputTooLarge")}\n`;
    case "invalid_json":
      return `${t(lang, "lint.error.invalidJson")}\n`;
    case "unrecognized_shape":
      return `${t(lang, "cli.error.unrecognizedShape")}\n`;
    case "too_many_tools":
      return `${t(lang, "lint.error.tooManyTools", { count: error.count, limit: error.limit })}\n`;
    case "invalid_tool":
      return `${t(lang, "lint.error.invalidTool", { path: error.path, expected: error.expected })}\n`;
    case "snake_case_keys":
      return [
        t(lang, "lint.error.snakeCaseKeys"),
        ...error.keys.map((key) => `  ${key.path} → ${key.expected}`),
        "",
      ].join("\n");
  }
}
