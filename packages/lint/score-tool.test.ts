import { describe, expect, it } from "vitest";
import cases from "./fixtures/cases.json";
import { MAX_SCHEMA_DEPTH, walkProps } from "./schema.ts";
import { scoreTool, type ToolScore } from "./score-tool.ts";
import type { Tool } from "./tool.ts";
import { readToolsList } from "./tools-list.ts";

/** Codes added after the prototype (forecall-cli#16); the record of its results has none. */
const LATER_CODES = new Set(["deprecated", "id_source_missing"]);

/** The result with its issues as a sorted multiset of "severity:code", as fixtures/cases.json has. */
function comparable(result: ToolScore) {
  return {
    name: result.name,
    score: result.score,
    components: result.components,
    issues: result.issues
      .filter((issue) => !LATER_CODES.has(issue.code))
      .map((issue) => `${issue.severity}:${issue.code}`)
      .toSorted(),
    words: result.words,
    paramCount: result.paramCount,
  };
}

/** Reads one tool through readToolsList, as a pasted tools/list is read. */
function readTool(input: unknown): Tool {
  const read = readToolsList([input]);
  if (!read.ok || read.tools[0] === undefined) throw new Error(JSON.stringify(read));
  return read.tools[0];
}

describe("scoreTool matches the Python prototype", () => {
  it.each(cases.tools.map((entry) => [entry.expected.name, entry] as const))(
    "on the synthetic tool %s",
    (_, { tool, expected }) => {
      expect(comparable(scoreTool(readTool(tool)))).toEqual(expected);
    },
  );
});

describe("where the port differs from the prototype on purpose", () => {
  // readToolsList treats null as absent. The prototype counts a key with a null value as a
  // declared annotation: +5 +2 for constraints and no destructive_unmarked.
  it("does not count null annotations as declared", () => {
    const result = scoreTool(
      readTool({
        name: "wipe",
        description: "Delete everything.",
        annotations: { destructiveHint: null },
      }),
    );
    expect(result.components.constraints).toBe(0);
    expect(result.issues.map((issue) => issue.code)).toContain("destructive_unmarked");
  });

  it(`stops walking the schema below ${MAX_SCHEMA_DEPTH} levels`, () => {
    let schema: Record<string, unknown> = { type: "string" };
    for (let i = 0; i < 1000; i++) schema = { type: "object", properties: { a: schema } };
    expect(walkProps(schema)).toHaveLength(MAX_SCHEMA_DEPTH + 1);
  });
});

// From the calibration of 2026-10-09 (forecall/forecall#448): models rightly avoid a tool said
// to be deprecated, and look an identifier up first when nothing says where it comes from.
describe("findings that move no score (forecall-cli#16)", () => {
  const codes = (tool: unknown) => scoreTool(readTool(tool)).issues.map((issue) => issue.code);
  const idTool = (params: Record<string, unknown>, description = "Update one page.") => ({
    name: "update_page",
    description,
    inputSchema: { type: "object", properties: params, required: Object.keys(params) },
  });

  it.each([
    ["DEPRECATED: use read_text_file", true],
    ["Read a file. Deprecated in favour of read_text_file.", true],
    ["Read a file as text.", false],
    ["Handles deprecation notices in the feed.", false],
  ])("deprecated: %s → %s", (description, flagged) => {
    expect(codes({ name: "read_file", description }).includes("deprecated")).toBe(flagged);
  });

  it.each<[string, Record<string, unknown>, string[]]>([
    [
      "an id with no source",
      { page_id: { type: "string", description: "The page." } },
      ["page_id"],
    ],
    ["an undescribed id", { id: { type: "string" } }, ["id"]],
    [
      "several, in schema order",
      { uid: {}, libraryId: {}, parent: {}, start_cursor: {} },
      ["uid", "libraryId", "parent", "start_cursor"],
    ],
    [
      "from the snapshot",
      { uid: { description: "The uid of the element from the page content snapshot." } },
      [],
    ],
    [
      "call another tool",
      { pageId: { description: "The page. Call list_pages to list pages." } },
      [],
    ],
    [
      "retrieved from a quoted tool",
      { libraryId: { description: "Library id retrieved from 'resolve-library-id'." } },
      [],
    ],
    [
      "returned by",
      { thread_id: { description: "The thread id returned by search_threads." } },
      [],
    ],
    ["not an id", { query: { description: "Free text." }, limit: {} }, []],
    ["a word that only ends in id", { valid: {}, hybrid: {}, grid_size: {} }, []],
  ])("id_source_missing: %s", (_, params, expected) => {
    const found = scoreTool(readTool(idTool(params))).issues.find(
      (issue) => issue.code === "id_source_missing",
    );
    expect(found === undefined ? [] : (found as { params: string[] }).params).toEqual(expected);
  });

  it("is satisfied by the tool's own description saying where ids come from", () => {
    const tool = idTool(
      { page_id: { description: "The page." } },
      "Update one page. Take the page id from the search results.",
    );
    expect(codes(tool)).not.toContain("id_source_missing");
  });

  it("looks only at required, top-level arguments", () => {
    const tool = {
      name: "update_page",
      description: "Update one page.",
      inputSchema: {
        type: "object",
        properties: { page_id: {}, filter: { type: "object", properties: { parent_id: {} } } },
        required: ["filter"],
      },
    };
    expect(codes(tool)).not.toContain("id_source_missing");
  });
});
