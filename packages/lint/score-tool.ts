import {
  CONS_PATTERNS,
  CTX_PATTERNS,
  DESTRUCTIVE,
  DISAMBIGUATION,
  EX_PATTERNS,
  GENERIC_NAME_TOKENS,
  hasUseInstead,
  NAME_CHARS,
  RET_PATTERNS,
  VERB_START,
} from "./patterns.ts";
import { pyStrip } from "./py-regex.ts";
import { roundHalfEven } from "./round.ts";
import { walkProps } from "./schema.ts";
import { isObject, nameTokens, stringOr, tokens, truthy, words } from "./text.ts";
import type { Tool } from "./tool.ts";

/** Points per component; the maximums add up to 100. */
export interface ToolComponents {
  purpose: number; // 0-20
  usageContext: number; // 0-20
  parameters: number; // 0-25
  return: number; // 0-15
  constraints: number; // 0-10
  examples: number; // 0-10
}

/** Issue codes and severities are the prototype's. Values for the message are kept structured. */
export type ToolIssue =
  | { severity: "critical"; code: "no_description" }
  | { severity: "major"; code: "restates_name"; words: number }
  | { severity: "major"; code: "too_short"; words: number }
  | { severity: "minor"; code: "too_long"; words: number }
  | { severity: "major"; code: "no_usage_context" }
  | { severity: "major" | "minor"; code: "param_no_description"; params: string[] }
  | { severity: "minor"; code: "loose_string_param"; params: string[] }
  | { severity: "minor"; code: "no_required" }
  | { severity: "minor"; code: "params_not_in_description" }
  | { severity: "minor"; code: "vague_boolean"; param: string }
  | { severity: "minor"; code: "no_return_info" }
  | { severity: "minor"; code: "no_constraints" }
  | { severity: "major"; code: "destructive_unmarked" }
  | { severity: "major"; code: "generic_name" }
  | { severity: "minor"; code: "long_name"; length: number }
  | { severity: "major"; code: "bad_name_chars" };

export interface ToolScore {
  name: string;
  score: number;
  components: ToolComponents;
  issues: ToolIssue[];
  words: number;
  paramCount: number;
}

const CONSTRAINT_KEYS = [
  "enum",
  "format",
  "pattern",
  "examples",
  "default",
  "minLength",
  "maxLength",
];

const has = (patterns: RegExp[], text: string) => patterns.some((pattern) => pattern.test(text));

/**
 * Port of score_tool in the Python prototype. Totals, components and issue codes match the
 * prototype exactly (fixtures/cases.json holds its results). Comments name the prototype's
 * variables where the port differs in form.
 */
export function scoreTool(tool: Tool): ToolScore {
  const { name } = tool;
  const desc = tool.description ?? "";
  const schema = tool.inputSchema ?? {};
  const ann = tool.annotations ?? {};
  const props = walkProps(schema);
  const nwords = words(desc).length;
  const issues: ToolIssue[] = [];

  // 1. purpose (0-20)
  let purpose = 0;
  const stripped = pyStrip(desc);
  if (stripped === "") {
    issues.push({ severity: "critical", code: "no_description" });
  } else {
    purpose += 8;
    if (nwords >= 12) purpose += 4;
    if (nwords >= 25) purpose += 3;
    const firstSentence = stripped.split(".", 1)[0] as string;
    if (VERB_START.test(stripped) || VERB_START.test(firstSentence)) purpose += 3;
    // The name's tokens keep their case; the description's are lower case, as in the prototype.
    const nameParts = nameTokens(name);
    const descTokens = tokens(desc);
    const shared = [...nameParts].filter((part) => descTokens.has(part)).length;
    if (nwords < 10 && nameParts.size > 0 && shared >= Math.max(1, nameParts.size - 1)) {
      issues.push({ severity: "major", code: "restates_name", words: nwords });
      purpose = Math.min(purpose, 6);
    } else {
      purpose += 2;
    }
  }
  if (nwords > 0 && nwords < 8)
    issues.push({ severity: "major", code: "too_short", words: nwords });
  if (nwords > 400) issues.push({ severity: "minor", code: "too_long", words: nwords });

  // 2. usage context / disambiguation (0-20)
  let usageContext = Math.min(CTX_PATTERNS.filter((pattern) => pattern.test(desc)).length, 3) * 5;
  if (DISAMBIGUATION.test(desc) || hasUseInstead(desc)) usageContext += 5;
  if (usageContext === 0 && desc !== "")
    issues.push({ severity: "major", code: "no_usage_context" });

  // 3. parameters (0-25)
  let parameters = 0;
  if (props.length > 0) {
    const described = props.filter(
      (prop) => isObject(prop.schema) && pyStrip(stringOr(prop.schema.description)) !== "",
    );
    const ratio = described.length / props.length;
    parameters += roundHalfEven(ratio * 15);
    const missing = props.filter((prop) => !described.includes(prop)).map((prop) => prop.path);
    if (missing.length > 0) {
      const severity = ratio < 0.5 ? "major" : "minor";
      issues.push({ severity, code: "param_no_description", params: missing });
    }
    const strings = props.filter((prop) => isObject(prop.schema) && prop.schema.type === "string");
    const constrained = strings.filter((prop) =>
      CONSTRAINT_KEYS.some((key) => Object.hasOwn(prop.schema as object, key)),
    );
    if (strings.length > 0) {
      parameters += roundHalfEven((constrained.length / strings.length) * 5);
      const loose = strings
        .filter((prop) => !constrained.includes(prop))
        .filter(
          (prop) =>
            words(stringOr((prop.schema as Record<string, unknown>).description)).length < 4,
        )
        .map((prop) => prop.path);
      if (loose.length > 0)
        issues.push({ severity: "minor", code: "loose_string_param", params: loose });
    } else {
      parameters += 5;
    }
    if (Object.hasOwn(schema, "required") || !truthy(schema.properties)) {
      parameters += 3;
    } else {
      issues.push({ severity: "minor", code: "no_required" });
    }
    if (schema.additionalProperties === false) parameters += 2;
    // pnames & tokens(desc) | pnames & {lower-case words}: the second set contains the first.
    const paramNames = props.map(
      (prop) => (prop.path.split(".")[0] as string).split("[")[0] as string,
    );
    const descWords = new Set(words(desc).map((word) => word.toLowerCase()));
    if (props.length >= 3 && !paramNames.some((param) => descWords.has(param.toLowerCase()))) {
      issues.push({ severity: "minor", code: "params_not_in_description" });
    }
    for (const prop of props) {
      if (
        isObject(prop.schema) &&
        prop.schema.type === "boolean" &&
        words(stringOr(prop.schema.description)).length < 4
      ) {
        issues.push({ severity: "minor", code: "vague_boolean", param: prop.path });
      }
    }
  } else {
    parameters = schema.type === "object" ? 25 : 20;
  }

  // 4. return value (0-15)
  let returns = 0;
  if (truthy(tool.outputSchema)) returns += 8;
  if (has(RET_PATTERNS, desc)) returns += 7;
  if (returns === 0 && desc !== "") issues.push({ severity: "minor", code: "no_return_info" });

  // 5. constraints / side effects (0-10)
  let constraints = 0;
  if (truthy(ann)) {
    constraints += 5;
    if (
      ["readOnlyHint", "destructiveHint", "idempotentHint"].some((key) => Object.hasOwn(ann, key))
    ) {
      constraints += 2;
    }
  }
  if (has(CONS_PATTERNS, desc)) constraints += 3;
  if (constraints === 0 && desc !== "") issues.push({ severity: "minor", code: "no_constraints" });
  if (
    DESTRUCTIVE.test(`${name} ${desc}`) &&
    !truthy(ann.destructiveHint) &&
    !Object.hasOwn(ann, "destructiveHint")
  ) {
    issues.push({ severity: "major", code: "destructive_unmarked" });
  }

  // 6. examples (0-10)
  let examples = 0;
  if (has(EX_PATTERNS, desc)) examples += 5;
  const exampleParams = props.filter(
    (prop) =>
      isObject(prop.schema) &&
      (truthy(prop.schema.examples) || has(EX_PATTERNS, stringOr(prop.schema.description))),
  );
  if (exampleParams.length > 0) examples += 5;

  // name smells
  const lowerNameParts = [...nameTokens(name)].map((part) => part.toLowerCase());
  if (
    lowerNameParts.length > 0 &&
    lowerNameParts.every((part) => part === "tool" || GENERIC_NAME_TOKENS.has(part))
  ) {
    issues.push({ severity: "major", code: "generic_name" });
  }
  const length = [...name].length; // code points, like Python's len()
  if (length > 40) issues.push({ severity: "minor", code: "long_name", length });
  if (!NAME_CHARS.test(name)) issues.push({ severity: "major", code: "bad_name_chars" });

  const components: ToolComponents = {
    purpose: Math.min(purpose, 20),
    usageContext: Math.min(usageContext, 20),
    parameters: Math.min(parameters, 25),
    return: Math.min(returns, 15),
    constraints: Math.min(constraints, 10),
    examples: Math.min(examples, 10),
  };
  const score = Object.values(components).reduce((sum, points) => sum + points, 0);
  return { name, score, components, issues, words: nwords, paramCount: props.length };
}
