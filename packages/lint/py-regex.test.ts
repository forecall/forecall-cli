import { describe, expect, it } from "vitest";
import { hasUseInstead } from "./patterns.ts";
import { pyRegex, pyStrip } from "./py-regex.ts";
import { nameTokens } from "./text.ts";

const pin = "📍";

// Expected values come from CPython 3.13 re.search(pattern, text, flags).
const searches: [pattern: string, flags: string, text: string, matches: boolean][] = [
  [String.raw`\bwhen\b`, "i", "use it when needed", true],
  [String.raw`\bwhen\b`, "i", "éwhen", false],
  [String.raw`\bwhen\b`, "i", "whenを", false],
  [String.raw`\bwhen\b`, "i", "—when—", true],
  [String.raw`\bwhen\b`, "i", "when_", false],
  [String.raw`\bwhen\b`, "i", "WHEN", true],
  [String.raw`\bwhen\b`, "i", "٣when", false],
  [String.raw`\brate.?limit`, "i", "rate\rlimit", true],
  [String.raw`\brate.?limit`, "i", "rate\u2028limit", true],
  [String.raw`\brate.?limit`, "i", "rate\nlimit", false],
  [String.raw`use\s*it`, "", "use\x1cit", true],
  [String.raw`use\s*it`, "", "use\ufeffit", false],
  [String.raw`use\s*it`, "", "use\u3000it", true],
  ["'[^']{2,60}'", "", `'${pin.repeat(60)}'`, true],
  ["'[^']{2,60}'", "", `'${pin.repeat(61)}'`, false],
  [String.raw`[_\-\.\s]+`, "", "a\u2003b", true],
  [String.raw`\be\.g\.`, "i", "see E.G. this", true],
  [String.raw`\be\.g\.`, "i", "see eXg. this", false],
];

describe("pyRegex", () => {
  it.each(searches)("re.search(%j, flags=%j) on %j is %s", (pattern, flags, text, matches) => {
    expect(pyRegex(pattern, flags).test(text)).toBe(matches);
  });

  it.each([String.raw`\d`, String.raw`\w`, String.raw`\S`])(
    "rejects the unsupported %s",
    (pattern) => {
      expect(() => pyRegex(pattern)).toThrow("unsupported escape");
    },
  );
});

describe("pyStrip", () => {
  it.each([
    ["\x1c a \x1f", "a"],
    ["\ufeffa\ufeff", "\ufeffa\ufeff"],
    ["\u3000a\u2029", "a"],
    [" \t\n", ""],
  ])("strips %j to %j like str.strip()", (text, stripped) => {
    expect(pyStrip(text)).toBe(stripped);
  });

  it("stays linear on a long run of spaces", () => {
    const text = `${" ".repeat(200_000)}x${" ".repeat(200_000)}`;
    expect(pyStrip(text)).toBe("x");
  });
});

describe("nameTokens", () => {
  it.each([
    ["getUserName", ["get", "User", "Name"]],
    ["a_b-c.d e", ["a", "b", "c", "d", "e"]],
    ["API_key", ["API", "key"]],
    ["x\u3000y", ["x", "y"]],
  ])("splits %j like re.split", (name, parts) => {
    expect([...nameTokens(name)]).toEqual(parts);
  });
});

describe("hasUseInstead", () => {
  const regex = pyRegex(String.raw`\buse .* instead\b`, "i");
  const pieces = [
    "use ",
    "USE ",
    "Use",
    " instead",
    " INSTEAD",
    "instead",
    "x",
    "_",
    "é",
    " ",
    "\n",
    "\r",
  ];

  it("agrees with the regex on every string of up to 4 pieces", () => {
    const texts = [""];
    for (let length = 0; length < 4; length++) {
      for (const text of texts.splice(0)) {
        texts.push(text, ...pieces.map((piece) => text + piece));
      }
    }
    for (const text of new Set(texts))
      expect(hasUseInstead(text), JSON.stringify(text)).toBe(regex.test(text));
  });

  it("stays linear on many uses without instead", () => {
    const text = "use ".repeat(250_000);
    const started = Date.now();
    expect(hasUseInstead(text)).toBe(false);
    expect(Date.now() - started).toBeLessThan(1000);
  });
});
