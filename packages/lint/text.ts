// Ports of the prototype's text helpers, with Python's semantics for JSON values.
import { NAME_SEPARATOR, STOP, WORD } from "./patterns.ts";

export function words(text: string): string[] {
  return text.match(WORD) ?? [];
}

export function tokens(text: string): Set<string> {
  return new Set(
    words(text)
      .map((word) => word.toLowerCase())
      .filter((word) => !STOP.has(word) && word.length > 2),
  );
}

/** Name parts split on `_ - .`, whitespace and lower-to-upper case changes. Case is kept. */
export function nameTokens(name: string): Set<string> {
  return new Set(name.split(NAME_SEPARATOR).filter((token) => token !== ""));
}

/** Python's bool() for a JSON value: null, false, 0, "", [] and {} are false. */
export function truthy(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  if (isObject(value)) return Object.keys(value).length > 0;
  return Boolean(value);
}

/** The value if it is a string, else "". The prototype reads non-strings as "" or crashes. */
export function stringOr(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
