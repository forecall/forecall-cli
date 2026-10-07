import { describe, expect, it } from "vitest";
import cases from "./fixtures/cases.json";
import { MAX_SCHEMA_DEPTH, walkProps } from "./schema.ts";
import { scoreTool, type ToolScore } from "./score-tool.ts";
import type { Tool } from "./tool.ts";
import { readToolsList } from "./tools-list.ts";

/** The result with its issues as a sorted multiset of "severity:code", as fixtures/cases.json has. */
function comparable(result: ToolScore) {
  return {
    name: result.name,
    score: result.score,
    components: result.components,
    issues: result.issues.map((issue) => `${issue.severity}:${issue.code}`).toSorted(),
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
