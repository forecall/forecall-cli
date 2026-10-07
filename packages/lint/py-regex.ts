// Python 3's re treats \b and \s as Unicode, and "." excludes only "\n". JavaScript's do not,
// even with the u flag. pyRegex rewrites a Python pattern so that a JS RegExp matches the same
// text, which the port needs to score exactly like the prototype.

/** Python's \w: str.isalnum() or "_". Equal to this class up to the Unicode version in use. */
const WORD = String.raw`\p{L}\p{N}_`;
/** Python's \s and str.isspace(): category Zs, or bidi class WS, B or S. */
const SPACE = String.raw`\t-\r\x1c-\x20\x85\xa0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000`;
const BOUNDARY = `(?:(?<=[${WORD}])(?![${WORD}])|(?<![${WORD}])(?=[${WORD}]))`;
const SPACE_CHAR = new RegExp(`[${SPACE}]`, "u");

/** Escapes whose meaning is the same in both engines once \b and \s are rewritten. */
const PASS_THROUGH = new Set([".", "-"]);

/**
 * Compiles a Python pattern (as in a raw string) to an equivalent JS RegExp with the u flag.
 * Only the syntax the linter's patterns use is supported; anything else throws, so a new pattern
 * cannot silently change meaning.
 */
export function pyRegex(pattern: string, flags = ""): RegExp {
  let source = "";
  let inClass = false;
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i] as string;
    if (char === "\\") {
      const next = pattern[++i] as string;
      if (next === "s") source += inClass ? SPACE : `[${SPACE}]`;
      else if (next === "b" && !inClass) source += BOUNDARY;
      else if (PASS_THROUGH.has(next)) source += `\\${next}`;
      else throw new Error(`unsupported escape \\${next} in ${pattern}`);
    } else if (char === "[" && !inClass) {
      inClass = true;
      source += char;
    } else if (char === "]" && inClass) {
      inClass = false;
      source += char;
    } else if (char === "." && !inClass) {
      source += String.raw`[^\n]`;
    } else {
      source += char;
    }
  }
  return new RegExp(source, `${flags}u`);
}

/** Python's str.strip() with no arguments. A loop, because /\s+$/ backtracks quadratically. */
export function pyStrip(text: string): string {
  let start = 0;
  let end = text.length;
  while (start < end && SPACE_CHAR.test(text[start] as string)) start++;
  while (end > start && SPACE_CHAR.test(text[end - 1] as string)) end--;
  return text.slice(start, end);
}
