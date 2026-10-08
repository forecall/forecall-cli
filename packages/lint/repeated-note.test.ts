import { describe, expect, it } from "vitest";
import { MIN_NOTE_WORDS, MIN_SHARED_TOOLS, repeatedNote } from "./repeated-note.ts";
import { words } from "./text.ts";
import type { Tool } from "./tool.ts";

/** A 38-word note in two sentences. */
const NOTE =
  "Important: this server only reaches the archive of the Northwind company, which holds its invoices, customers, orders and shipments from 2015 on. It does not search the public web, other companies, or anything outside that archive.";
/** A short shared sentence, like filesystem's "Only works within allowed directories." */
const SHORT = "Only works within allowed directories.";

function tool(name: string, own: string, note?: string): Tool {
  return { name, description: note === undefined ? own : `${own} ${note}` };
}

/** `count` tools, the first `sharing` of them carrying `note` after their own sentence. */
function server(count: number, sharing: number, note: string): Tool[] {
  return Array.from({ length: count }, (_, i) =>
    tool(`tool_${i}`, `Does thing number ${i} for the caller.`, i < sharing ? note : undefined),
  );
}

describe("repeatedNote", () => {
  it("has the thresholds the rule names", () => {
    expect(MIN_SHARED_TOOLS).toBe(3);
    expect(MIN_NOTE_WORDS).toBe(20);
  });

  it.each([
    ["a long note in every one of 7 tools", server(7, 7, NOTE), 7],
    ["a long note in 5 of 10 tools (half)", server(10, 5, NOTE), 5],
    ["a long note in all 3 of 3 tools", server(3, 3, NOTE), 3],
  ])("finds %s", (_, tools, carrying) => {
    const note = repeatedNote(tools);
    expect(note).toBeDefined();
    expect(note?.tools).toBe(carrying);
    expect(note?.words).toBe(words(NOTE).length);
    expect(note?.excerpt).toBe(`${NOTE.slice(0, 79)}…`);
    for (const [i, description] of (note?.stripped ?? []).entries()) {
      expect(description).toBe(
        i < carrying ? `Does thing number ${i} for the caller.` : tools[i]?.description,
      );
    }
  });

  it.each([
    ["a short shared sentence in 10 of 14 tools", server(14, 10, SHORT)],
    ["a long note in only 2 of 2 tools", server(2, 2, NOTE)],
    ["a long note in only 2 of 7 tools", server(7, 2, NOTE)],
    ["a long note in 4 of 10 tools (under half)", server(10, 4, NOTE)],
    ["no descriptions at all", [{ name: "a" }, { name: "b" }, { name: "c" }]],
    ["an empty list", []],
  ])("ignores %s", (_, tools) => {
    expect(repeatedNote(tools)).toBeUndefined();
  });

  it("matches the note across case, spacing and end punctuation, and keeps each tool's spelling", () => {
    const variants = [
      NOTE,
      NOTE.toUpperCase(),
      NOTE.replace(/\s+/g, "  ").replace(/\.$/, ""),
      `${NOTE}!`,
    ];
    const tools = variants.map((variant, i) => tool(`t${i}`, `Own sentence ${i} here.`, variant));
    const note = repeatedNote(tools);
    expect(note?.tools).toBe(4);
    expect(note?.excerpt).toBe(`${NOTE.slice(0, 79)}…`);
    expect(note?.stripped).toEqual(variants.map((_, i) => `Own sentence ${i} here.`));
  });

  it("reads bullet lines as sentences, so a list repeated in every tool is a note", () => {
    const list =
      "Covers these areas only:\n- medicine, clinical research, public health, epidemiology\n- biology, molecular biology, genetics, genomics\n- biochemistry, cell biology, developmental biology\n- pharmacology, toxicology, drug development";
    const tools = Array.from({ length: 4 }, (_, i) =>
      tool(`t${i}`, `Look up item ${i} in the index.`, list),
    );
    const note = repeatedNote(tools);
    expect(note?.tools).toBe(4);
    expect(note?.words).toBeGreaterThanOrEqual(MIN_NOTE_WORDS);
    expect(note?.excerpt).toBe("Covers these areas only:");
    expect(note?.stripped[0]).toBe("Look up item 0 in the index.");
  });

  it("leaves a tool with no description as it is", () => {
    const tools = [...server(3, 3, NOTE), { name: "bare" }];
    expect(repeatedNote(tools)?.stripped[3]).toBeUndefined();
  });

  it("quotes at most 80 characters of the note", () => {
    const note = repeatedNote(server(3, 3, NOTE));
    expect(note?.excerpt).toHaveLength(80);
    expect(note?.excerpt.endsWith("…")).toBe(true);
  });
});
