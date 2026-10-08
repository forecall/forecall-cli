import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseToolsList } from "@forecall/lint";
import { LINT_VERSION, lintTools } from "@forecall/lint/internal/lint";
import { describe, expect, it } from "vitest";
import { version } from "../package.json";
import { t } from "./i18n";
import { EXIT, HELP, type Io, LINT_HELP, run } from "./run";

const dir = mkdtempSync(join(tmpdir(), "forecall-cli-"));
const TOOLS = JSON.stringify([
  { name: "get_user", description: "Returns a user." },
  {
    name: "search_users",
    description:
      "Search users by name. Use this when you know part of a name; use get_user for an id. Returns up to 20 users as JSON. Example: search_users(query='ada').",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string", description: "Part of a name", minLength: 1 } },
      required: ["query"],
    },
  },
]);
const tools = join(dir, "tools.json");
writeFileSync(tools, TOOLS);

function io(options: Partial<Io> = {}) {
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
    ...options,
  };
  return { io: value, out };
}

const report = () => {
  const parsed = parseToolsList(TOOLS);
  if (!parsed.ok) throw new Error("fixture");
  return lintTools(parsed.tools);
};

describe("run", () => {
  it.each([[[]], [["--help"]], [["-h"]], [["help"]]])("shows the help for %j", async (argv) => {
    const { io: x, out } = io();
    expect(await run(argv, x)).toBe(EXIT.ok);
    expect(out.stdout).toBe(HELP);
  });

  it.each([["--version"], ["-v"]])("shows both versions for %s", async (flag) => {
    const { io: x, out } = io();
    expect(await run([flag], x)).toBe(EXIT.ok);
    expect(out.stdout).toBe(`forecall ${version} (scoring rules v${LINT_VERSION})\n`);
  });

  it.each([
    [["scan"], 'unknown command "scan"'],
    [["lint"], "missing <file>"],
    [["lint", "a.json", "b.json"], "give only one <file>"],
    [["lint", tools, "--lang", "fr"], "--lang must be one of en, ja"],
    [["lint", tools, "--fail-under", "abc"], "--fail-under must be a number from 0 to 100"],
    [["lint", tools, "--fail-under", "101"], "--fail-under must be a number from 0 to 100"],
    [["lint", tools, "--fail-under"], "--fail-under"],
    [["lint", tools, "--strict"], "--strict"],
  ])("treats %j as a usage error", async (argv, message) => {
    const { io: x, out } = io();
    expect(await run(argv, x)).toBe(EXIT.error);
    expect(out.stderr).toContain(message);
    expect(out.stdout).toBe("");
  });

  it("shows the lint help", async () => {
    const { io: x, out } = io();
    expect(await run(["lint", "--help"], x)).toBe(EXIT.ok);
    expect(out.stdout).toBe(LINT_HELP);
  });

  it("prints the report the web stores with --json", async () => {
    const { io: x, out } = io();
    expect(await run(["lint", tools, "--json"], x)).toBe(EXIT.ok);
    expect(JSON.parse(out.stdout)).toEqual(report());
  });

  it("prints a table by default, in the language asked for", async () => {
    const { io: x, out } = io();
    expect(await run(["lint", tools], x)).toBe(EXIT.ok);
    expect(out.stdout).toContain(`Average score     ${report().scoreAvg.toFixed(1)} / 100`);
    const ja = io();
    expect(await run(["lint", tools, "--lang", "ja"], ja.io)).toBe(EXIT.ok);
    expect(ja.out.stdout).toContain("平均点");
  });

  it("notes on stderr that a bare tools/list says nothing about the server's instructions", async () => {
    const bare = io();
    expect(await run(["lint", tools, "--json"], bare.io)).toBe(EXIT.ok);
    expect(bare.out.stderr).toBe(`forecall: ${t("en", "cli.note.noInstructions")}\n`);
    expect(JSON.parse(bare.out.stdout)).toEqual(report());
    // A dump carries them, so they are checked instead (here: found missing).
    const dump = join(dir, "dump.json");
    writeFileSync(dump, JSON.stringify({ server: { name: "x" }, tools: JSON.parse(TOOLS) }));
    const dumped = io();
    expect(await run(["lint", dump, "--json", "--lang", "ja"], dumped.io)).toBe(EXIT.ok);
    expect(dumped.out.stderr).toBe("");
    expect(JSON.parse(dumped.out.stdout).serverIssues).toContainEqual({
      severity: "minor",
      code: "instructions_missing",
    });
  });

  it("reads standard input for -", async () => {
    const { io: x, out } = io({
      stdin: (async function* () {
        yield new TextEncoder().encode(TOOLS);
      })(),
    });
    expect(await run(["lint", "-", "--json"], x)).toBe(EXIT.ok);
    expect(JSON.parse(out.stdout)).toEqual(report());
  });

  it("exits with 1 only when the average is below --fail-under", async () => {
    const average = report().scoreAvg;
    const below = io();
    expect(await run(["lint", tools, "--fail-under", String(average + 0.1)], below.io)).toBe(
      EXIT.belowThreshold,
    );
    expect(below.out.stdout).not.toBe("");
    const at = io();
    expect(await run(["lint", tools, "--fail-under", String(average)], at.io)).toBe(EXIT.ok);
  });

  it("explains input errors on stderr, or as JSON on stdout with --json", async () => {
    const bad = join(dir, "bad.json");
    writeFileSync(bad, "[{");
    const text = io();
    expect(await run(["lint", bad, "--lang", "ja"], text.io)).toBe(EXIT.error);
    expect(text.out.stderr).toContain("JSON として読めません");
    const json = io();
    expect(await run(["lint", bad, "--json"], json.io)).toBe(EXIT.error);
    expect(JSON.parse(json.out.stdout)).toEqual({ error: { code: "invalid_json" } });
  });

  it("colors only a terminal, and never with NO_COLOR", async () => {
    const plain = io();
    await run(["lint", tools], plain.io);
    expect(plain.out.stdout).not.toContain("\u001b[");
    const tty = io({ isTTY: true });
    await run(["lint", tools], tty.io);
    expect(tty.out.stdout).toContain("\u001b[1m");
    const noColor = io({ isTTY: true, env: { NO_COLOR: "1" } });
    await run(["lint", tools], noColor.io);
    expect(noColor.out.stdout).toBe(plain.out.stdout);
  });
});
