// Every issue code the linter gives, with its severities and whether it is about one tool or the
// whole server, in the order forecall.dev's docs list them, with the same sentences as the
// results.
import type { ServerIssue } from "./lint.ts";
import type { ToolIssue } from "./score-tool.ts";

export type Issue = ToolIssue | ServerIssue;
export type IssueCode = Issue["code"];
export type IssueOf<C extends IssueCode> = Extract<Issue, { code: C }>;

export const ISSUE_CODES: {
  readonly [C in IssueCode]: {
    scope: "tool" | "server";
    severities: readonly IssueOf<C>["severity"][];
  };
} = {
  no_description: { scope: "tool", severities: ["critical"] },
  identical_description: { scope: "server", severities: ["critical"] },
  repeated_note: { scope: "server", severities: ["major"] },
  restates_name: { scope: "tool", severities: ["major"] },
  too_short: { scope: "tool", severities: ["major"] },
  no_usage_context: { scope: "tool", severities: ["major"] },
  destructive_unmarked: { scope: "tool", severities: ["major"] },
  generic_name: { scope: "tool", severities: ["major"] },
  bad_name_chars: { scope: "tool", severities: ["major"] },
  param_no_description: { scope: "tool", severities: ["major", "minor"] },
  too_many_tools: { scope: "server", severities: ["major"] },
  confusable_pair: { scope: "server", severities: ["minor"] },
  confusable_pair_total: { scope: "server", severities: ["minor"] },
  too_long: { scope: "tool", severities: ["minor"] },
  loose_string_param: { scope: "tool", severities: ["minor"] },
  no_required: { scope: "tool", severities: ["minor"] },
  params_not_in_description: { scope: "tool", severities: ["minor"] },
  vague_boolean: { scope: "tool", severities: ["minor"] },
  no_return_info: { scope: "tool", severities: ["minor"] },
  no_constraints: { scope: "tool", severities: ["minor"] },
  long_name: { scope: "tool", severities: ["minor"] },
  many_tools: { scope: "server", severities: ["minor"] },
  instructions_long: { scope: "server", severities: ["minor"] },
  instructions_missing: { scope: "server", severities: ["minor"] },
  deprecated: { scope: "tool", severities: ["minor"] },
  id_source_missing: { scope: "tool", severities: ["minor"] },
};
