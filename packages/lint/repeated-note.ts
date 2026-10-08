// A note repeated in most tools' descriptions (forecall-cli#12): the same sentences, found in at
// least three tools and at least half of them, adding up to 20 words or more. MCP's spec says the
// server's instructions should not duplicate the tool descriptions; a note like PubMed's "ONLY
// indexes biomedical and life sciences literature …" belongs there once. From scoring rules v2,
// the note is taken out of each description before the tool is scored and before descriptions
// are compared, so it neither earns points in every tool nor makes the tools look alike.

import { words } from "./text.ts";
import type { Tool } from "./tool.ts";

/** A note counts when this many tools share it, and at least half of the tools. */
export const MIN_SHARED_TOOLS = 3;
/** Shorter shared sentences ("Only works within allowed directories.") are not a note. */
export const MIN_NOTE_WORDS = 20;
/** How much of the note an issue quotes. */
const EXCERPT_CHARS = 80;

export interface RepeatedNote {
  /** How many tools carry at least one sentence of the note. */
  tools: number;
  /** The note's length in words, over all of its sentences. */
  words: number;
  /** The start of the note, as the first tool carrying it spells it. */
  excerpt: string;
  /** Each tool's description with the note's sentences taken out, by the tool's position. */
  stripped: (string | undefined)[];
}

/** Splits a description into sentences and bullet lines, keeping their spelling. */
function pieces(description: string): string[] {
  return description
    .split(/(?<=[.!?])\s+|\n+/)
    .map((piece) => piece.trim())
    .filter((piece) => piece !== "");
}

/** A sentence's key for matching: lowercased, bullets and end punctuation dropped. */
function keyOf(piece: string): string {
  return piece
    .toLowerCase()
    .replace(/^[-*•]\s*/, "")
    .replace(/[.!?:;,]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** The note the tools repeat, with their descriptions without it; undefined when there is none. */
export function repeatedNote(tools: readonly Tool[]): RepeatedNote | undefined {
  if (tools.length < MIN_SHARED_TOOLS) return undefined;
  const needed = Math.max(MIN_SHARED_TOOLS, Math.ceil(tools.length / 2));
  const split = tools.map((tool) => pieces(tool.description ?? ""));
  const carriers = new Map<string, number>();
  for (const sentences of split) {
    for (const key of new Set(sentences.map(keyOf))) {
      if (key !== "") carriers.set(key, (carriers.get(key) ?? 0) + 1);
    }
  }
  const shared = new Set([...carriers].filter(([, n]) => n >= needed).map(([key]) => key));
  if (shared.size === 0) return undefined;
  const noteWords = [...shared].reduce((sum, key) => sum + words(key).length, 0);
  if (noteWords < MIN_NOTE_WORDS) return undefined;

  let carrying = 0;
  let excerpt = "";
  const stripped = tools.map((tool, index) => {
    if (tool.description === undefined) return undefined;
    const sentences = split[index] as string[];
    const own = sentences.filter((piece) => !shared.has(keyOf(piece)));
    if (own.length === sentences.length) return tool.description;
    carrying += 1;
    if (excerpt === "") {
      const first = sentences.find((piece) => shared.has(keyOf(piece))) ?? "";
      excerpt = first.length > EXCERPT_CHARS ? `${first.slice(0, EXCERPT_CHARS - 1)}…` : first;
    }
    return own.join(" ");
  });
  return { tools: carrying, words: noteWords, excerpt, stripped };
}
