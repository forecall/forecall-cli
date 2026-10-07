// The CLI's languages and sentences, its own catalog (messages/*.json). The sentences it shares
// with forecall.dev's result page are the same as there.
import en from "../messages/en.json" with { type: "json" };
import ja from "../messages/ja.json" with { type: "json" };

export const LANGS = ["en", "ja"] as const;
export type Lang = (typeof LANGS)[number];
export const DEFAULT_LANG: Lang = "en";

export type MessageKey = keyof typeof en;
const CATALOGS: Record<Lang, Record<MessageKey, string>> = { en, ja };

export function isLang(value: unknown): value is Lang {
  return typeof value === "string" && (LANGS as readonly string[]).includes(value);
}

/** The sentence for `key`, with `{name}` placeholders replaced by `params`. */
export function t(
  lang: Lang,
  key: MessageKey,
  params: Record<string, string | number> = {},
): string {
  return CATALOGS[lang][key].replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}
