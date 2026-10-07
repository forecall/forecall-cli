// @forecall/lint's public API: read a tools/list and score its tool
// descriptions. This file is what semver keeps. Everything else in the package is under
// @forecall/lint/internal/*, for Forecall's own apps, and may change in any version.

import { type LintReport, lintTools } from "./lint.ts";
import { parseToolsList, type ToolsListError } from "./tools-list.ts";

export type { LintReport, ServerIssue } from "./lint.ts";
export { LINT_VERSION } from "./lint.ts";
export type { ToolComponents, ToolIssue, ToolScore } from "./score-tool.ts";
export type { JsonObject, JsonValue, Tool, ToolAnnotations } from "./tool.ts";
export type { SnakeCaseKey, ToolsListError, ToolsListResult } from "./tools-list.ts";
export { parseToolsList };

/** A scored tools/list, or why it could not be read. */
export type LintResult = { ok: true; report: LintReport } | { ok: false; error: ToolsListError };

/**
 * Reads a tools/list in any of the accepted shapes (an array of tools, `{ tools }`, or a JSON-RPC
 * `{ result: { tools } }`) and scores each tool out of 100, and the server as a whole.
 */
export function lintToolsList(text: string): LintResult {
  const parsed = parseToolsList(text);
  return parsed.ok ? { ok: true, report: lintTools(parsed.tools) } : parsed;
}
