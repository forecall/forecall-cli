// The sentence for each issue, shared by forecall.dev's result page and the CLI, so both say the
// same thing for the same input. The sentences are lint's own catalog (messages/*.json), so that
// the package stands alone; English is the source.
import type { IssueCode } from "./codes.ts";
import type { ServerIssue } from "./lint.ts";
import en from "./messages/en.json" with { type: "json" };
import ja from "./messages/ja.json" with { type: "json" };
import type { ToolIssue } from "./score-tool.ts";

/** The languages the sentences are written in. */
export type Lang = "en" | "ja";
type IssueKey = IssueCode;

/** Every code has a sentence in every language: the types fail otherwise. */
const CATALOGS: Record<Lang, Record<IssueKey, string>> = { en, ja };

/**
 * A number's two forms in a sentence, `{words, plural, one {# word} other {# words}}`: ICU's syntax,
 * only the part the catalogs use. `#` is the number.
 */
const PLURAL = /\{(\w+), plural, one \{([^{}]*)\} other \{([^{}]*)\}\}/g;

/**
 * The sentence for `key`: the plural forms chosen by the language's rules ("1 word", "2 words"),
 * then the `{name}` placeholders replaced by `params`.
 */
function sentence(lang: Lang, key: IssueKey, params: Record<string, string | number> = {}) {
  const rules = new Intl.PluralRules(lang);
  return CATALOGS[lang][key]
    .replace(PLURAL, (match, name: string, one: string, other: string) => {
      const value = params[name];
      if (typeof value !== "number") return match;
      return (rules.select(value) === "one" ? one : other).replaceAll("#", String(value));
    })
    .replace(/\{(\w+)\}/g, (match, name: string) =>
      name in params ? String(params[name]) : match,
    );
}

const list = (lang: Lang, items: string[]) => items.join(lang === "ja" ? "、" : ", ");

/** The localized sentence for an issue, filled with its structured values. */
export function issueMessage(lang: Lang, issue: ToolIssue | ServerIssue): string {
  switch (issue.code) {
    case "restates_name":
    case "too_short":
    case "too_long":
      return sentence(lang, issue.code, { words: issue.words });
    case "param_no_description":
    case "loose_string_param":
      return sentence(lang, issue.code, { params: list(lang, issue.params) });
    case "vague_boolean":
      return sentence(lang, "vague_boolean", { param: issue.param });
    case "long_name":
      return sentence(lang, "long_name", { length: issue.length });
    case "too_many_tools":
    case "many_tools":
      return sentence(lang, issue.code, { count: issue.count });
    case "confusable_pair":
      return sentence(lang, "confusable_pair", { a: issue.tools[0], b: issue.tools[1] });
    case "confusable_pair_total":
      return sentence(lang, "confusable_pair_total", { total: issue.total });
    case "identical_description":
      return sentence(lang, "identical_description", { tools: list(lang, issue.tools) });
    default:
      return sentence(lang, issue.code);
  }
}
