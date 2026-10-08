import { pyStrip } from "./py-regex.ts";
import { repeatedNote } from "./repeated-note.ts";
import { roundHalfEven } from "./round.ts";
import { scoreTool, type ToolScore } from "./score-tool.ts";
import { nameTokens, tokens } from "./text.ts";
import type { Tool } from "./tool.ts";
import type { Handshake } from "./tools-list.ts";

/**
 * Version of the scoring rules, stored with every result. Results are comparable only within a
 * version. Bump it with any change that can give some input a different score or component:
 * patterns, word lists, thresholds, rounding, what is read from the input. An issue code added
 * or reworded alone does not bump it (ADR-0013, 2026-10-09). Each version's changes are in the
 * repository's CHANGELOG.md.
 *
 * v1 is the Python prototype's table (research/mcp-lint). v2 takes a note repeated in most tools
 * out of each description before scoring (repeated-note.ts).
 */
export const LINT_VERSION = 2;

/**
 * How much of a server's instructions Claude Code passes to the model by default (its MCP
 * documentation, read 2026-10-09); Codex CLI 0.154.0 passes them whole (measured the same day).
 */
export const INSTRUCTIONS_LIMIT = 2048;

/** confusable_pair issues shown; the rest are counted in confusablePairsTotal. */
const SHOWN_PAIRS = 12;

export type ServerIssue =
  | { severity: "major"; code: "too_many_tools"; count: number }
  | { severity: "minor"; code: "many_tools"; count: number }
  | {
      severity: "major";
      code: "confusable_pair";
      tools: [string, string];
      /** Jaccard similarity of the descriptions' tokens, rounded to 2 places. */
      similarity: number;
      /** Jaccard similarity of the names' tokens, rounded to 2 places. */
      nameSimilarity: number;
    }
  | { severity: "major"; code: "confusable_pair_total"; total: number }
  | { severity: "critical"; code: "identical_description"; tools: string[] }
  | {
      severity: "major";
      code: "repeated_note";
      /** How many tools carry the note. */
      tools: number;
      /** The note's length in words. */
      words: number;
      /** How the note starts. */
      excerpt: string;
    }
  | { severity: "minor"; code: "instructions_long"; length: number }
  | { severity: "minor"; code: "instructions_missing" };

export interface LintOptions {
  /**
   * The server's initialize result, when the input carried it (a `forecall dump` file). With it,
   * the instructions are checked; without it, nothing is said about them, since a bare tools/list
   * does not tell whether the server has any.
   */
  handshake?: Handshake | undefined;
}

/** The linter's result. Plain JSON, so it can be stored and sent as is. */
export interface LintReport {
  lintVersion: number;
  toolCount: number;
  /** Mean of the tool scores, rounded to 1 place like the prototype. */
  scoreAvg: number;
  /** Every confusable pair, including those past the 12 shown. */
  confusablePairsTotal: number;
  tools: ToolScore[];
  serverIssues: ServerIssue[];
}

/**
 * Port of lint_file and server_smells in the Python prototype (v1), plus what v2 added: a note
 * repeated in most tools is taken out of their descriptions first, so that each tool is scored
 * and compared on what it alone says; and the server's instructions are checked when given.
 */
export function lintTools(tools: readonly Tool[], options: LintOptions = {}): LintReport {
  const note = repeatedNote(tools);
  const own =
    note === undefined
      ? tools
      : tools.map((tool, index) =>
          note.stripped[index] === tool.description
            ? tool
            : { ...tool, description: note.stripped[index] },
        );
  const scores = own.map(scoreTool);
  const total = scores.reduce((sum, result) => sum + result.score, 0);
  const { serverIssues, confusablePairsTotal } = serverSmells(own);
  if (note !== undefined) {
    serverIssues.push({
      severity: "major",
      code: "repeated_note",
      tools: note.tools,
      words: note.words,
      excerpt: note.excerpt,
    });
  }
  const { handshake } = options;
  if (handshake !== undefined) {
    const instructions = handshake.instructions ?? "";
    if (instructions.trim() === "") {
      serverIssues.push({ severity: "minor", code: "instructions_missing" });
    } else if (instructions.length > INSTRUCTIONS_LIMIT) {
      serverIssues.push({
        severity: "minor",
        code: "instructions_long",
        length: instructions.length,
      });
    }
  }
  return {
    lintVersion: LINT_VERSION,
    toolCount: tools.length,
    scoreAvg: roundHalfEven(total / Math.max(1, tools.length), 1),
    confusablePairsTotal,
    tools: scores,
    serverIssues,
  };
}

function serverSmells(tools: readonly Tool[]) {
  const serverIssues: ServerIssue[] = [];
  const count = tools.length;
  if (count > 40) serverIssues.push({ severity: "major", code: "too_many_tools", count });
  else if (count > 25) serverIssues.push({ severity: "minor", code: "many_tools", count });

  // Keyed by name like the prototype's dict: with duplicate names, the last description wins.
  const descriptionTokens = new Map(
    tools.map((tool) => [tool.name, tokens(tool.description ?? "")]),
  );
  const nameParts = tools.map((tool) => nameTokens(tool.name));
  const pairs: Extract<ServerIssue, { code: "confusable_pair" }>[] = [];
  for (let i = 0; i < count; i++) {
    for (let k = i + 1; k < count; k++) {
      const [a, b] = [tools[i] as Tool, tools[k] as Tool];
      const similarity = jaccard(
        descriptionTokens.get(a.name) as Set<string>,
        descriptionTokens.get(b.name) as Set<string>,
      );
      const nameSimilarity = jaccard(nameParts[i] as Set<string>, nameParts[k] as Set<string>);
      if (similarity >= 0.6 || (nameSimilarity >= 0.66 && similarity >= 0.35)) {
        pairs.push({
          severity: "major",
          code: "confusable_pair",
          tools: [a.name, b.name],
          similarity: roundHalfEven(similarity, 2),
          nameSimilarity: roundHalfEven(nameSimilarity, 2),
        });
      }
    }
  }
  // Array.prototype.sort is stable like Python's, so ties keep the pair order.
  pairs.sort((x, y) => y.similarity - x.similarity);
  serverIssues.push(...pairs.slice(0, SHOWN_PAIRS));
  if (pairs.length > SHOWN_PAIRS) {
    serverIssues.push({ severity: "major", code: "confusable_pair_total", total: pairs.length });
  }

  const namesByDescription = new Map<string, string[]>();
  for (const tool of tools) {
    const description = pyStrip(tool.description ?? "");
    if (description === "") continue;
    namesByDescription.set(description, [
      ...(namesByDescription.get(description) ?? []),
      tool.name,
    ]);
  }
  for (const names of namesByDescription.values()) {
    if (names.length > 1) {
      serverIssues.push({ severity: "critical", code: "identical_description", tools: names });
    }
  }
  return { serverIssues, confusablePairsTotal: pairs.length };
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const item of a) if (b.has(item)) shared++;
  return shared / (a.size + b.size - shared);
}
