// What changed between two versions of a server's tools: the average and each tool's score, the
// tools added and removed, the issues resolved and new, and word diffs of the descriptions and of
// each argument's description. Forecall's dashboard and REST API return it. Plain JSON, like
// LintReport.

import type { LintReport, ServerIssue } from "./lint.ts";
import { walkProps } from "./schema.ts";
import type { ToolIssue } from "./score-tool.ts";
import { isObject } from "./text.ts";
import type { Tool } from "./tool.ts";

/** A run of words that stayed, were added or were removed. Joining the texts gives either side. */
export interface TextChange {
  kind: "same" | "added" | "removed";
  text: string;
}

export interface ArgumentChange {
  /** As walkProps names it: `a`, `a.b`, `a[].b`. */
  path: string;
  change: "added" | "removed" | "changed";
  /** Word diff of the argument's description (one side only when added or removed). */
  description: TextChange[];
  /** Whether anything besides the description changed (type, enum, required...). */
  schemaChanged: boolean;
}

export interface ToolDiff {
  name: string;
  score: { before: number; after: number };
  issuesResolved: ToolIssue[];
  issuesAdded: ToolIssue[];
  /** Word diff of the description, or null when it did not change. */
  description: TextChange[] | null;
  arguments: ArgumentChange[];
}

export interface VersionDiff {
  /** Scores compare only within one version of the scoring rules (LINT_VERSION). */
  sameRules: boolean;
  scoreAvg: { before: number; after: number };
  confusablePairsTotal: { before: number; after: number };
  added: { name: string; score: number }[];
  removed: { name: string; score: number }[];
  /** Tools in both versions whose score, issues, description or arguments changed. */
  changed: ToolDiff[];
  serverIssuesResolved: ServerIssue[];
  serverIssuesAdded: ServerIssue[];
}

export interface VersionSide {
  report: LintReport;
  tools: readonly Tool[];
}

/** Compares a version (`after`) with the one before it. */
export function diffVersions(before: VersionSide, after: VersionSide): VersionDiff {
  const scoresBefore = new Map(before.report.tools.map((tool) => [tool.name, tool]));
  const scoresAfter = new Map(after.report.tools.map((tool) => [tool.name, tool]));
  const toolsBefore = new Map(before.tools.map((tool) => [tool.name, tool]));
  const toolsAfter = new Map(after.tools.map((tool) => [tool.name, tool]));

  const changed: ToolDiff[] = [];
  for (const next of after.report.tools) {
    const previous = scoresBefore.get(next.name);
    if (previous === undefined) continue;
    const description = textDiff(
      toolsBefore.get(next.name)?.description ?? "",
      toolsAfter.get(next.name)?.description ?? "",
    );
    const diff: ToolDiff = {
      name: next.name,
      score: { before: previous.score, after: next.score },
      issuesResolved: missingFrom(previous.issues, next.issues),
      issuesAdded: missingFrom(next.issues, previous.issues),
      description: description.every((part) => part.kind === "same") ? null : description,
      arguments: argumentChanges(
        toolsBefore.get(next.name)?.inputSchema,
        toolsAfter.get(next.name)?.inputSchema,
      ),
    };
    const same =
      diff.score.before === diff.score.after &&
      diff.issuesResolved.length === 0 &&
      diff.issuesAdded.length === 0 &&
      diff.description === null &&
      diff.arguments.length === 0;
    if (!same) changed.push(diff);
  }

  return {
    sameRules: before.report.lintVersion === after.report.lintVersion,
    scoreAvg: { before: before.report.scoreAvg, after: after.report.scoreAvg },
    confusablePairsTotal: {
      before: before.report.confusablePairsTotal,
      after: after.report.confusablePairsTotal,
    },
    added: after.report.tools
      .filter((tool) => !scoresBefore.has(tool.name))
      .map(({ name, score }) => ({ name, score })),
    removed: before.report.tools
      .filter((tool) => !scoresAfter.has(tool.name))
      .map(({ name, score }) => ({ name, score })),
    changed,
    serverIssuesResolved: missingFrom(before.report.serverIssues, after.report.serverIssues),
    serverIssuesAdded: missingFrom(after.report.serverIssues, before.report.serverIssues),
  };
}

/** The issues of `from` that `other` does not have, comparing code, severity and values. */
function missingFrom<T>(from: readonly T[], other: readonly T[]): T[] {
  const keys = new Set(other.map((issue) => JSON.stringify(issue)));
  return from.filter((issue) => !keys.has(JSON.stringify(issue)));
}

function argumentChanges(before: unknown, after: unknown): ArgumentChange[] {
  const propsBefore = new Map(walkProps(before).map((prop) => [prop.path, prop]));
  const propsAfter = new Map(walkProps(after).map((prop) => [prop.path, prop]));
  const changes: ArgumentChange[] = [];
  for (const [path, prop] of propsAfter) {
    const previous = propsBefore.get(path);
    if (previous === undefined) {
      changes.push({
        path,
        change: "added",
        description: textDiff("", descriptionOf(prop.schema)),
        schemaChanged: false,
      });
      continue;
    }
    const description = textDiff(descriptionOf(previous.schema), descriptionOf(prop.schema));
    const schemaChanged =
      previous.required !== prop.required ||
      JSON.stringify(withoutDescription(previous.schema)) !==
        JSON.stringify(withoutDescription(prop.schema));
    if (schemaChanged || description.some((part) => part.kind !== "same")) {
      changes.push({ path, change: "changed", description, schemaChanged });
    }
  }
  for (const [path, prop] of propsBefore) {
    if (propsAfter.has(path)) continue;
    changes.push({
      path,
      change: "removed",
      description: textDiff(descriptionOf(prop.schema), ""),
      schemaChanged: false,
    });
  }
  return changes;
}

function descriptionOf(schema: unknown): string {
  return isObject(schema) && typeof schema.description === "string" ? schema.description : "";
}

/** The schema without its description, nested properties left out (they are compared apart). */
function withoutDescription(schema: unknown): unknown {
  if (!isObject(schema)) return schema;
  const { description: _description, properties: _properties, items: _items, ...rest } = schema;
  return rest;
}

/** Past this many token pairs, a changed text is shown as removed then added, not word by word. */
export const MAX_DIFF_CELLS = 1_000_000;

/** A word diff: runs of whitespace and of other characters are the tokens. */
export function textDiff(before: string, after: string): TextChange[] {
  const a = before.match(/\s+|\S+/g) ?? [];
  const b = after.match(/\s+|\S+/g) ?? [];
  if (a.length * b.length > MAX_DIFF_CELLS) {
    return merge([
      { kind: "removed", text: before },
      { kind: "added", text: after },
    ]);
  }
  // Longest common subsequence of the suffixes, so that the walk below goes forward.
  const width = b.length + 1;
  const lcs = new Uint32Array((a.length + 1) * width);
  const at = (i: number, j: number) => lcs[i * width + j] ?? 0;
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      lcs[i * width + j] =
        a[i] === b[j] ? at(i + 1, j + 1) + 1 : Math.max(at(i + 1, j), at(i, j + 1));
    }
  }
  const parts: TextChange[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    const left = a[i];
    const right = b[j];
    if (left !== undefined && left === right) {
      parts.push({ kind: "same", text: left });
      i += 1;
      j += 1;
    } else if (right === undefined || (left !== undefined && at(i + 1, j) >= at(i, j + 1))) {
      parts.push({ kind: "removed", text: left ?? "" });
      i += 1;
    } else {
      parts.push({ kind: "added", text: right });
      j += 1;
    }
  }
  return merge(parts);
}

/** Joins neighbors of the same kind and drops empty runs. */
function merge(parts: TextChange[]): TextChange[] {
  const merged: TextChange[] = [];
  for (const part of parts) {
    if (part.text === "") continue;
    const last = merged.at(-1);
    if (last?.kind === part.kind) last.text += part.text;
    else merged.push({ ...part });
  }
  return merged;
}
