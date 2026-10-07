import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MAX_INPUT_BYTES } from "@forecall/lint/internal/tools-list";
import { describe, expect, it } from "vitest";
import { readInput } from "./input";

const dir = mkdtempSync(join(tmpdir(), "forecall-cli-"));
const file = (name: string, content: string | Uint8Array) => {
  const path = join(dir, name);
  writeFileSync(path, content);
  return path;
};
const TOOLS = '[{"name": "get_user", "description": "Returns a user."}]';
async function* chunks(...parts: string[]) {
  for (const part of parts) yield new TextEncoder().encode(part);
}
const noStdin = chunks();

describe("readInput", () => {
  it("reads the three shapes the web accepts", async () => {
    for (const text of [TOOLS, `{"tools": ${TOOLS}}`, `{"result": {"tools": ${TOOLS}}}`]) {
      const result = await readInput(file("shape.json", text), noStdin);
      expect(result).toEqual({
        ok: true,
        tools: [{ name: "get_user", description: "Returns a user." }],
      });
    }
  });

  it("drops a leading BOM like the browser's File.text()", async () => {
    const result = await readInput(file("bom.json", `﻿${TOOLS}`), noStdin);
    expect(result.ok).toBe(true);
  });

  it("reads standard input for -", async () => {
    const result = await readInput("-", chunks('[{"name": "a"}', ', {"name": "b"}]'));
    expect(result).toEqual({ ok: true, tools: [{ name: "a" }, { name: "b" }] });
  });

  it("scores input with NUL, which only the web's database cannot store", async () => {
    const result = await readInput(file("nul.json", '[{"name": "a\\u0000"}]'), noStdin);
    expect(result).toEqual({ ok: true, tools: [{ name: "a\u0000" }] });
  });

  it("stops at 1 MiB for files and standard input", async () => {
    const tooLarge = { ok: false, error: { code: "input_too_large", limit: MAX_INPUT_BYTES } };
    const big = " ".repeat(MAX_INPUT_BYTES - TOOLS.length + 1) + TOOLS;
    expect(await readInput(file("big.json", big), noStdin)).toEqual(tooLarge);
    expect(await readInput("-", chunks(big.slice(0, 1000), big.slice(1000)))).toEqual(tooLarge);
    const justFits = big.slice(1);
    expect((await readInput(file("fits.json", justFits), noStdin)).ok).toBe(true);
  });

  it.each([
    ["empty", "", { code: "empty" }],
    ["blank", " \n\t", { code: "empty" }],
    ["invalid JSON", "[{", { code: "invalid_json" }],
    ["no tools", '{"result": {}}', { code: "unrecognized_shape" }],
    [
      "snake_case",
      '[{"name": "a", "input_schema": {}}]',
      {
        code: "snake_case_keys",
        keys: [{ path: "tools[0].input_schema", key: "input_schema", expected: "inputSchema" }],
      },
    ],
  ])("rejects %s input like the web", async (_, text, error) => {
    expect(await readInput(file("bad.json", text), noStdin)).toEqual({ ok: false, error });
  });

  it("names a missing file and an unreadable one", async () => {
    const missing = join(dir, "missing.json");
    expect(await readInput(missing, noStdin)).toEqual({
      ok: false,
      error: { code: "not_found", file: missing },
    });
    expect(await readInput(dir, noStdin)).toEqual({
      ok: false,
      error: { code: "unreadable", file: dir, reason: "EISDIR" },
    });
  });
});
