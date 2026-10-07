import { describe, expect, it } from "vitest";
import { version } from "../package.json";
import {
  DEFAULT_TIMEOUT_SECONDS,
  DUMP_HELP,
  describeSource,
  dump,
  dumpOutput,
  limitWarnings,
  parseDumpArgs,
} from "./dump";
import { EXIT, type Io } from "./io";

describe("parseDumpArgs", () => {
  it("reads a URL with its headers", () => {
    expect(
      parseDumpArgs([
        "https://example.com/mcp",
        "--header",
        "Authorization: Bearer abc: def",
        "-o",
        "tools.json",
        "--timeout",
        "5",
      ]),
    ).toEqual({
      ok: true,
      help: false,
      options: {
        target: { kind: "http", url: new URL("https://example.com/mcp") },
        output: "tools.json",
        headers: { Authorization: "Bearer abc: def" },
        env: {},
        cwd: undefined,
        timeoutSeconds: 5,
      },
    });
  });

  it("reads a command after --, leaving its own options to it", () => {
    expect(
      parseDumpArgs([
        "--env",
        "TOKEN=a=b",
        "--cwd",
        "/srv",
        "--",
        "npx",
        "-y",
        "server",
        "--header",
        "x",
      ]),
    ).toEqual({
      ok: true,
      help: false,
      options: {
        target: { kind: "stdio", command: "npx", args: ["-y", "server", "--header", "x"] },
        output: undefined,
        headers: {},
        env: { TOKEN: "a=b" },
        cwd: "/srv",
        timeoutSeconds: DEFAULT_TIMEOUT_SECONDS,
      },
    });
  });

  it("shows the help", () => {
    expect(parseDumpArgs(["--help"])).toEqual({ ok: true, help: true });
    expect(parseDumpArgs(["-h", "--", "node"])).toEqual({ ok: true, help: true });
  });

  it.each([
    [[], "missing <url>"],
    [["--"], "missing the server's command"],
    [["a", "b"], "give one <url>"],
    [["server.js"], "must start with https:// or http://"],
    [["ftp://example.com"], "must start with https:// or http://"],
    [["https://example.com", "--", "node"], "not both"],
    [["https://example.com", "--header", "Authorization"], '--header must be "Name: value"'],
    [["https://example.com", "--header", "Bad Name: x"], '--header must be "Name: value"'],
    [["--env", "1A=x", "--", "node"], "--env must be NAME=value"],
    [["--env", "TOKEN", "--", "node"], "--env must be NAME=value"],
    [["https://example.com", "--env", "A=b"], "--env and --cwd are for a server's command"],
    [["https://example.com", "--cwd", "/"], "--env and --cwd are for a server's command"],
    [["--header", "A: b", "--", "node"], "--header is for a URL"],
    [["https://example.com", "--timeout", "0"], "--timeout must be"],
    [["https://example.com", "--timeout", "601"], "--timeout must be"],
    [["https://example.com", "--strict"], "--strict"],
  ])("refuses %j", (args, message) => {
    const parsed = parseDumpArgs(args);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.message).toContain(message);
  });
});

describe("what dump writes", () => {
  it("records a URL without its credentials, query or fragment", () => {
    const url = new URL("https://user:secret@example.com:8443/mcp/v1?key=secret#x");
    expect(describeSource({ kind: "http", url })).toEqual({
      url: "https://example.com:8443/mcp/v1",
    });
    expect(describeSource({ kind: "stdio", command: "npx", args: ["-y", "server"] })).toEqual({
      command: ["npx", "-y", "server"],
    });
  });

  it("puts the tools with where, when and from which server", () => {
    const tools = [{ name: "search" }];
    expect(
      dumpOutput({
        target: { kind: "stdio", command: "node", args: ["server.js"] },
        capturedAt: new Date("2026-10-03T10:00:00Z"),
        server: { name: "notion", version: "1.0.0" },
        instructions: undefined,
        tools,
      }),
    ).toEqual({
      source: {
        command: ["node", "server.js"],
        capturedAt: "2026-10-03T10:00:00.000Z",
        forecall: version,
      },
      server: { name: "notion", version: "1.0.0" },
      tools,
    });
    expect(
      dumpOutput({
        target: { kind: "http", url: new URL("https://example.com/mcp") },
        capturedAt: new Date(0),
        server: undefined,
        instructions: "Use search first.",
        tools,
      }),
    ).toMatchObject({ server: {}, instructions: "Use search first." });
  });

  it("warns about what forecall.dev would refuse", () => {
    expect(limitWarnings("{}", 200)).toEqual([]);
    expect(limitWarnings("{}", 201)).toEqual([
      "201 tools: forecall lint and forecall.dev score up to 200.",
    ]);
    expect(limitWarnings("x".repeat(1_048_577), 1)).toEqual([
      "The JSON is over 1 MiB: forecall lint and forecall.dev read up to 1 MiB.",
    ]);
  });
});

describe("dump", () => {
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

  it("shows its help, and the help on a usage error", async () => {
    const help = io();
    expect(await dump(["--help"], help.io)).toBe(EXIT.ok);
    expect(help.out.stdout).toBe(DUMP_HELP);
    const wrong = io();
    expect(await dump(["server.js"], wrong.io)).toBe(EXIT.error);
    expect(wrong.out.stderr).toContain(DUMP_HELP);
  });

  it("says why when the server cannot start", async () => {
    const { io: x, out } = io();
    expect(await dump(["--timeout", "10", "--", "forecall-no-such-command"], x)).toBe(EXIT.error);
    expect(out.stderr).toContain("forecall: could not get the tools:");
    expect(out.stdout).toBe("");
  });
});
