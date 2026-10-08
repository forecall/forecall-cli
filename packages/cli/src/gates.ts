// The gates `lint` can stop a CI job on (#10): the average (--fail-under), the worst tool
// (--min-tool-score) and the worst issue (--fail-on). The average alone lets well-described tools
// lift a server over the gate while one dangerous tool stays as it was.
import type { LintReport } from "@forecall/lint/internal/lint";
import { type Lang, t } from "./i18n";

export const SEVERITIES = ["critical", "major", "minor"] as const;
export type Severity = (typeof SEVERITIES)[number];

export function isSeverity(value: unknown): value is Severity {
  return typeof value === "string" && (SEVERITIES as readonly string[]).includes(value);
}

export interface Gates {
  failUnder?: number | undefined;
  minToolScore?: number | undefined;
  failOn?: Severity | undefined;
}

/** How many names a failed gate lists before "and N more". */
const LISTED = 10;

/** The sentence for each gate the report fails, in `lang`; none when it passes them all. */
export function failedGates(report: LintReport, gates: Gates, lang: Lang): string[] {
  const failed: string[] = [];
  if (gates.failUnder !== undefined && report.scoreAvg < gates.failUnder) {
    failed.push(
      t(lang, "cli.gate.average", {
        average: report.scoreAvg.toFixed(1),
        n: gates.failUnder,
      }),
    );
  }
  const floor = gates.minToolScore;
  if (floor !== undefined) {
    const low = report.tools
      .filter((tool) => tool.score < floor)
      .toSorted((a, b) => a.score - b.score || a.name.localeCompare(b.name))
      .map((tool) => `${tool.name} (${tool.score})`);
    if (low.length > 0) failed.push(t(lang, "cli.gate.tools", { n: floor, tools: listed(low) }));
  }
  if (gates.failOn !== undefined) {
    const worst = SEVERITIES.indexOf(gates.failOn);
    const atLeast = (severity: Severity) => SEVERITIES.indexOf(severity) <= worst;
    const found = [
      ...report.tools.flatMap((tool) =>
        tool.issues
          .filter((issue) => atLeast(issue.severity))
          .map((issue) => `${tool.name}: ${issue.code}`),
      ),
      ...report.serverIssues
        .filter((issue) => atLeast(issue.severity))
        .map((issue) =>
          issue.code === "confusable_pair"
            ? `${issue.code} (${issue.tools[0]}, ${issue.tools[1]})`
            : issue.code,
        ),
    ];
    if (found.length > 0) {
      failed.push(t(lang, "cli.gate.issues", { severity: gates.failOn, issues: listed(found) }));
    }
  }
  return failed;
}

function listed(items: string[]): string {
  const shown = items.slice(0, LISTED).join(", ");
  return items.length > LISTED ? `${shown} … +${items.length - LISTED}` : shown;
}
