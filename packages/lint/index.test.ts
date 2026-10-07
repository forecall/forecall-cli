import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as api from "./index.ts";
import { lintTools } from "./lint.ts";

const TOOLS = [
  {
    name: "get_forecast",
    description: "Returns the weather forecast for a city for the next days.",
    inputSchema: {
      type: "object",
      properties: { city: { type: "string", description: "The city's name." } },
      required: ["city"],
    },
  },
];

describe("the public API", () => {
  it("is the three names semver keeps, and nothing else", () => {
    expect(Object.keys(api).toSorted()).toEqual([
      "LINT_VERSION",
      "lintToolsList",
      "parseToolsList",
    ]);
  });

  it("reads and scores a tools/list in any accepted shape, as lintTools does", () => {
    for (const text of [
      JSON.stringify(TOOLS),
      JSON.stringify({ tools: TOOLS }),
      JSON.stringify({ jsonrpc: "2.0", id: 1, result: { tools: TOOLS } }),
    ]) {
      const result = api.lintToolsList(text);
      if (!result.ok) throw new Error(JSON.stringify(result.error));
      expect(result.report).toEqual(lintTools(TOOLS));
      expect(result.report.lintVersion).toBe(api.LINT_VERSION);
    }
  });

  it("says why a tools/list cannot be read", () => {
    expect(api.lintToolsList("[")).toEqual(api.parseToolsList("["));
    expect(api.lintToolsList("[").ok).toBe(false);
  });

  it("puts everything else under ./internal, which semver does not keep", () => {
    const exports = Object.keys(
      JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")).exports,
    );
    expect(exports.filter((path) => path !== ".")).toEqual(
      exports.filter((path) => path.startsWith("./internal/")),
    );
  });
});
