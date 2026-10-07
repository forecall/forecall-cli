// The built dist/, run as users run it: what goes into each file, that `lint` never loads anything
// that can reach the network, that it scores like @forecall/lint and the Python prototype, that
// `dump` gets a tools/list from a stdio and an HTTP server, and that the sensor sends a redacted
// result.
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseToolsList } from "@forecall/lint";
import { type LintReport, lintTools } from "@forecall/lint/internal/lint";
import type { Metafile } from "esbuild";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import cases from "../lint/fixtures/cases.json";
import { build, bundledPackages } from "./build.ts";

const outdir = mkdtempSync(join(tmpdir(), "forecall-bundle-"));
const bundle = join(outdir, "forecall.js");
const fakeStdioServer = fileURLToPath(new URL("test/fake-stdio-server.mjs", import.meta.url));

/** The synthetic servers of @forecall/lint's cases, each written to a file as `{ "tools": [...] }`. */
const fixtures = mkdtempSync(join(tmpdir(), "forecall-fixtures-"));
for (const server of cases.servers) {
  writeFileSync(join(fixtures, `${server.name}.json`), JSON.stringify({ tools: server.tools }));
}

/** Seven tools whose descriptions differ in one word: 21 confusable pairs, 12 of them shown. */
const lookalikes = join(fixtures, "lookalikes.json");
writeFileSync(
  lookalikes,
  JSON.stringify({
    tools: Array.from({ length: 7 }, (_, i) => ({
      name: `find_records_${i}`,
      description: `Finds the archived customer records that match a title and returns their ids, variant${i}.`,
    })),
  }),
);
let metafiles: { lint: Metafile; dump: Metafile; setup: Metafile; sensor: Metafile };

beforeAll(async () => {
  metafiles = await build(outdir);
}, 60_000);

const forecall = (args: string[], input?: string) =>
  spawnSync(process.execPath, [bundle, ...args], { input, encoding: "utf8" });

/** The same, without blocking: the HTTP test's server runs in this process. */
const forecallAsync = (args: string[]) =>
  new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve) => {
    const child = spawn(process.execPath, [bundle, ...args]);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });

// The CLI stands alone but for @forecall/lint: its sentences, the brand and the MCP constants are
// its own (messages/, src/shared.ts).
const INTERNAL = ["src/", "messages/", "package.json", "../lint/"];

describe("the bundle", () => {
  it("holds only the CLI and the internal packages it uses in forecall.js", () => {
    for (const input of Object.keys(metafiles.lint.inputs)) {
      expect(
        INTERNAL.some((prefix) => input.startsWith(prefix)),
        input,
      ).toBe(true);
    }
  });

  it("keeps `lint` away from anything that can reach the network or run programs", () => {
    const imports = Object.values(metafiles.lint.outputs).flatMap((output) =>
      output.imports.map((entry) => `${entry.kind} ${entry.path}`),
    );
    // dump.js is loaded only for `forecall dump`, setup.js only for `forecall setup`,
    // sensor.js only for `forecall hook --sensor`.
    expect(new Set(imports)).toEqual(
      new Set([
        "import-statement node:fs",
        "import-statement node:util",
        "dynamic-import ./dump.js",
        "dynamic-import ./setup.js",
        "dynamic-import ./sensor.js",
      ]),
    );
    const code = readFileSync(bundle, "utf8");
    for (const api of ["fetch(", "WebSocket", "XMLHttpRequest", "require(", "process.binding"]) {
      expect(code, api).not.toContain(api);
    }
    expect(code.match(/import\(/g)).toEqual(["import(", "import(", "import("]);
    expect(code).toContain('import("./dump.js")');
    expect(code).toContain('import("./setup.js")');
    expect(code).toContain('import("./sensor.js")');
  });

  it("keeps `setup` to node's own modules: no npm package, no network", () => {
    for (const input of Object.keys(metafiles.setup.inputs)) {
      expect(
        INTERNAL.some((prefix) => input.startsWith(prefix)),
        input,
      ).toBe(true);
    }
    const code = readFileSync(join(outdir, "setup.js"), "utf8");
    for (const api of ["fetch(", "WebSocket", "XMLHttpRequest", "http.request"]) {
      expect(code, api).not.toContain(api);
    }
  });

  it("keeps the sensor to node's own modules and the CLI's copy of the redaction", () => {
    for (const input of Object.keys(metafiles.sensor.inputs)) {
      expect(input.startsWith("src/"), input).toBe(true);
    }
    expect(Object.keys(metafiles.sensor.inputs)).toContain("src/redact.ts");
    const code = readFileSync(join(outdir, "sensor.js"), "utf8");
    for (const api of ["child_process", "spawn(", "writeFile"]) {
      expect(code, api).not.toContain(api);
    }
  });

  it("puts every bundled npm package's license in THIRD_PARTY_NOTICES.md", async () => {
    const notices = readFileSync(join(outdir, "THIRD_PARTY_NOTICES.md"), "utf8");
    const packages = await bundledPackages(metafiles.dump);
    expect(packages.map((pkg) => pkg.name)).toContain("@modelcontextprotocol/client");
    for (const pkg of packages) {
      expect(notices).toContain(`## ${pkg.name} ${pkg.version} (${pkg.license})`);
    }
    const dumpInputs = Object.keys(metafiles.dump.inputs);
    for (const input of dumpInputs) {
      const internal = INTERNAL.some((prefix) => input.startsWith(prefix));
      const npm = packages.some((pkg) => input.includes(`node_modules/${pkg.name}/`));
      expect(internal || npm, input).toBe(true);
    }
  });

  it("carries the CLI's own catalog and lint's sentences", () => {
    const code = readFileSync(bundle, "utf8");
    expect(code).toContain('"cli.stdin"');
    // The issues' sentences come with @forecall/lint, in its own catalog.
    expect(code).toContain('no_description: "No description."');
  });

  it("starts with a shebang and shows its version", () => {
    expect(readFileSync(bundle, "utf8").startsWith("#!/usr/bin/env node\n")).toBe(true);
    const { stdout, status } = forecall(["--version"]);
    expect(status).toBe(0);
    expect(stdout).toMatch(/^forecall \d+\.\d+\.\d+ \(scoring rules v\d+\)\n$/);
  });
});

describe.each(cases.servers.map((server) => [server.name, server] as const))(
  "forecall lint %s.json",
  (name, server) => {
    const path = join(fixtures, `${name}.json`);
    // One run per server, shared by both tests.
    let run: ReturnType<typeof forecall>;
    beforeAll(() => {
      run = forecall(["lint", path, "--json"]);
    });

    it("prints what @forecall/lint computes from the same file", () => {
      expect(run.status).toBe(0);
      const parsed = parseToolsList(readFileSync(path, "utf8"));
      if (!parsed.ok) throw new Error(JSON.stringify(parsed.error));
      expect(JSON.parse(run.stdout)).toEqual(lintTools(parsed.tools));
    });

    it("matches the Python prototype's scores", () => {
      const report = JSON.parse(run.stdout) as LintReport;
      expect(report.toolCount).toBe(server.expected.toolCount);
      expect(report.scoreAvg).toBe(server.expected.scoreAvg);
      expect(report.confusablePairsTotal).toBe(server.expected.confusablePairsTotal);
    });
  },
);

describe("forecall lint, run as a command", () => {
  it("reads standard input and prints a table in Japanese", () => {
    const { stdout, status } = forecall(
      ["lint", "-", "--lang", "ja"],
      readFileSync(lookalikes, "utf8"),
    );
    expect(status).toBe(0);
    expect(stdout).toContain("Forecall lint · 標準入力\n");
    expect(stdout).toContain("取り違えやすい組  21\n");
  });

  it("exits with 1 below --fail-under and 2 when it cannot score", () => {
    expect(forecall(["lint", lookalikes, "--fail-under", "100"]).status).toBe(1);
    const missing = forecall(["lint", join(fixtures, "missing.json")]);
    expect(missing.status).toBe(2);
    expect(missing.stderr).toContain("does not exist");
  });
});

describe("forecall hook --sensor, run as a command", () => {
  const received: { url?: string; authorization?: string; body: string }[] = [];
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    received.push({ url: request.url, authorization: request.headers.authorization, body });
    response.writeHead(202, { "Content-Type": "application/json" }).end('{"id":"x"}');
  });
  const home = mkdtempSync(join(tmpdir(), "forecall-sensor-"));
  const key = "fc_agent_0123456789abcdefghijklmnopqrstuv";
  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
    writeFileSync(
      join(home, ".claude.json"),
      JSON.stringify({
        mcpServers: {
          forecall: { type: "http", url, headers: { Authorization: `Bearer ${key}` } },
        },
      }),
    );
  });
  afterAll(() => {
    server.close();
  });

  it("posts the redacted result to the configured server's /sensor and prints nothing", async () => {
    const child = spawn(process.execPath, [bundle, "hook", "--sensor"], {
      env: { ...process.env, HOME: home, CLAUDE_CONFIG_DIR: "" },
    });
    let stdout = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stdin.end(
      JSON.stringify({
        hook_event_name: "PostToolUse",
        tool_name: "mcp__weather__get_forecast",
        tool_input: { city: "Tokyo" },
        tool_response: "Error: 401 for key sk-abcdefghijklmnop1234",
      }),
    );
    const status = await new Promise((resolve) => child.on("close", resolve));
    expect(status).toBe(0);
    expect(stdout).toBe("");
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ url: "/sensor", authorization: `Bearer ${key}` });
    expect(JSON.parse(received[0]?.body ?? "")).toMatchObject({
      server: "weather",
      tool: "get_forecast",
      is_error: true,
      error_text: "Error: 401 for key <SECRET>",
    });
    expect(received[0]?.body).not.toContain("Tokyo");
  });
});

describe("forecall dump", () => {
  it("starts a stdio server with --env and --cwd, reads every page, and lint scores it", () => {
    const cwd = mkdtempSync(join(tmpdir(), "forecall-dump-cwd-"));
    const run = forecall([
      "dump",
      "--env",
      "FAKE_TOOL_SUFFIX=_v2",
      "--cwd",
      cwd,
      "--",
      process.execPath,
      fakeStdioServer,
    ]);
    expect(run.status, run.stderr).toBe(0);
    expect(run.stderr).toBe("2 tools from fake-stdio 1.2.3\n");
    const output = JSON.parse(run.stdout);
    expect(output.source.command).toEqual([process.execPath, fakeStdioServer]);
    expect(output.server).toEqual({ name: "fake-stdio", version: "1.2.3" });
    expect(output.instructions).toBe("Use search first.");
    expect(output.tools.map((tool: { name: string }) => tool.name)).toEqual(["search_v2", "where"]);
    expect(output.tools[1].description).toContain(cwd.split("/").at(-1));

    const scored = forecall(["lint", "-", "--json"], run.stdout);
    expect(scored.status).toBe(0);
    const parsed = parseToolsList(run.stdout);
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.error));
    expect(JSON.parse(scored.stdout)).toEqual(lintTools(parsed.tools));
  });

  it("exits with 2 when the server's command does not start", () => {
    const run = forecall(["dump", "--", "forecall-no-such-command"]);
    expect(run.status).toBe(2);
    expect(run.stderr).toContain("forecall: could not get the tools:");
  });

  describe("over Streamable HTTP", () => {
    const seen: IncomingHttpHeaders[] = [];
    const server = createServer(async (request, response) => {
      seen.push(request.headers);
      if (request.method !== "POST") {
        response.writeHead(405).end();
        return;
      }
      let body = "";
      for await (const chunk of request) body += chunk;
      const message = JSON.parse(body);
      if (message.id === undefined) {
        response.writeHead(202).end();
        return;
      }
      const result =
        message.method === "initialize"
          ? {
              protocolVersion: message.params.protocolVersion,
              capabilities: { tools: {} },
              serverInfo: { name: "fake-http", version: "0.9.0" },
            }
          : {
              tools: [
                {
                  name: "fetch_page",
                  description: "Fetches a page by its URL.",
                  inputSchema: { type: "object" },
                },
              ],
            };
      response
        .writeHead(200, { "Content-Type": "application/json", "Mcp-Session-Id": "session-1" })
        .end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }));
    });
    let base = "";
    beforeAll(async () => {
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });
    afterAll(() => {
      server.close();
    });

    it("sends --header, writes -o, and keeps the URL's query out of the file", async () => {
      const file = join(mkdtempSync(join(tmpdir(), "forecall-dump-")), "tools.json");
      const run = await forecallAsync([
        "dump",
        `${base}/mcp?key=secret`,
        "--header",
        "Authorization: Bearer test-token",
        "-o",
        file,
      ]);
      expect(run.status, run.stderr).toBe(0);
      expect(run.stdout).toBe("");
      expect(run.stderr).toBe(`1 tools from fake-http 0.9.0 in ${file}\n`);
      const text = readFileSync(file, "utf8");
      expect(JSON.parse(text)).toMatchObject({
        source: { url: `${base}/mcp` },
        server: { name: "fake-http", version: "0.9.0" },
        tools: [{ name: "fetch_page" }],
      });
      expect(text).not.toContain("secret");
      expect(text).not.toContain("test-token");
      expect(seen.some((headers) => headers.authorization === "Bearer test-token")).toBe(true);
    });
  });
});
