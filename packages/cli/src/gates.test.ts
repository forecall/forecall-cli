import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseToolsList } from "@forecall/lint";
import { lintTools } from "@forecall/lint/internal/lint";
import { describe, expect, it } from "vitest";
import { failedGates } from "./gates";
import { EXIT, type Io, run } from "./run";

const dir = mkdtempSync(join(tmpdir(), "forecall-cli-gates-"));

/** A badly described destructive tool: what the average alone can hide (#10). */
const DELETE = { name: "delete_record", description: "Deletes a record." };

/** A well-described read tool, one per kind of record, so that their average is high. */
function readTool(record: string) {
  return {
    name: `get_${record}`,
    title: `Get a ${record}`,
    description: `Fetch one ${record} by its id. Use this when you already have the id; to find a ${record} by name, search for it first. Returns the ${record} as JSON with its id, name and created_at, or an error when no ${record} has that id. Read-only: it changes nothing and needs no extra permission. Example: get_${record}(id='42').`,
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: `The ${record}'s id, e.g. '42'.`, minLength: 1 },
      },
      required: ["id"],
    },
    annotations: { readOnlyHint: true },
  };
}

const RECORDS = ["invoice", "customer", "order", "shipment", "refund", "coupon", "ticket"];
const file = join(dir, "tools.json");
const tools = [DELETE, ...RECORDS.map(readTool)];
// As `forecall dump` writes it, so that nothing is said about instructions on stderr.
writeFileSync(
  file,
  JSON.stringify({
    server: { name: "shop" },
    instructions: "Tools for the shop's records.",
    tools,
  }),
);

const parsed = parseToolsList(JSON.stringify(tools));
if (!parsed.ok) throw new Error(JSON.stringify(parsed.error));
const report = lintTools(parsed.tools);
const deleteScore = report.tools.find((tool) => tool.name === DELETE.name)?.score ?? -1;

function io() {
  const out = { stdout: "", stderr: "" };
  const value: Io = {
    stdin: (async function* () {})(),
    stdout: (text) => {
      out.stdout += text;
    },
    stderr: (text) => {
      out.stderr += text;
    },
    isTTY: false,
    env: {},
  };
  return { io: value, out };
}

describe("lint's gates (#10)", () => {
  it("starts from a server whose average clears 60 while its delete tool scores low", () => {
    expect(report.scoreAvg).toBeGreaterThanOrEqual(60);
    expect(deleteScore).toBeLessThan(40);
  });

  it("passes --fail-under on the average, as before", async () => {
    const { io: x, out } = io();
    expect(await run(["lint", file, "--fail-under", "60"], x)).toBe(EXIT.ok);
    expect(out.stderr).toBe("");
  });

  it("fails --min-tool-score on the delete tool, and names it", async () => {
    const { io: x, out } = io();
    expect(await run(["lint", file, "--fail-under", "60", "--min-tool-score", "40"], x)).toBe(
      EXIT.belowThreshold,
    );
    expect(out.stderr).toBe(
      `forecall: Tools below --min-tool-score 40: ${DELETE.name} (${deleteScore}).\n`,
    );
  });

  it("fails --fail-on major on the delete tool's issues, and keeps --json's output the report", async () => {
    const { io: x, out } = io();
    expect(await run(["lint", file, "--json", "--fail-on", "major"], x)).toBe(EXIT.belowThreshold);
    expect(JSON.parse(out.stdout)).toEqual(report);
    expect(out.stderr).toMatch(/^forecall: Issues at --fail-on major or worse: .*delete_record: /);
  });

  it("says each failed gate in the report's language, worst tools first", () => {
    expect(
      failedGates(report, { failUnder: 100, minToolScore: 100, failOn: "minor" }, "ja"),
    ).toEqual([
      `平均点 ${report.scoreAvg.toFixed(1)} が --fail-under の 100 を下回っています。`,
      expect.stringMatching(new RegExp(`^--min-tool-score の 100 を下回るツール: ${DELETE.name} `)),
      expect.stringMatching(/^--fail-on の minor 以上の指摘: /),
    ]);
    expect(failedGates(report, {}, "en")).toEqual([]);
  });

  it("lists at most ten names, then how many more", () => {
    const many = {
      ...report,
      tools: Array.from({ length: 12 }, (_, i) => ({
        ...report.tools[0],
        name: `t${i}`,
        score: 1,
      })),
    } as typeof report;
    const [sentence = ""] = failedGates(many, { minToolScore: 50 }, "en");
    expect(sentence).toMatch(/ … \+2\.$/);
    expect(sentence.match(/t\d+ \(1\)/g)).toHaveLength(10);
  });

  it.each([
    [["--min-tool-score", "101"], "--min-tool-score must be a number from 0 to 100"],
    [["--min-tool-score", ""], "--min-tool-score must be a number from 0 to 100"],
    [["--fail-on", "fatal"], "--fail-on must be one of critical, major, minor"],
  ])("refuses %j", async (args, message) => {
    const { io: x, out } = io();
    expect(await run(["lint", file, ...args], x)).toBe(EXIT.error);
    expect(out.stderr).toContain(message);
  });
});
