import { describe, expect, it } from "vitest";
import { EXIT, type Io } from "./io";
import { type Observation, resultText, SENSOR_TEXT_MAX, type SensorDeps, sensor } from "./sensor";
import { MCP_ENDPOINT } from "./shared";

const KEY = "fc_agent_0123456789abcdefghijklmnopqrstuv";
const SECRET = "sk-abcdefghijklmnop1234";

const config = (entry: unknown) =>
  JSON.stringify({ numStartups: 1, mcpServers: { forecall: entry } });
const ours = { type: "http", url: MCP_ENDPOINT, headers: { Authorization: `Bearer ${KEY}` } };

const event = (tool_name: string, tool_response: unknown, tool_input: unknown = {}) =>
  JSON.stringify({ hook_event_name: "PostToolUse", tool_name, tool_input, tool_response });

/** The sensor run on `input` with ~/.claude.json holding `claudeJson`; what it sent and printed. */
async function run(
  input: string,
  claudeJson?: string,
  fail?: Error,
  env: Io["env"] = { HOME: "/home/me" },
) {
  const sent: { url: string; init: RequestInit }[] = [];
  const out = { stdout: "", stderr: "" };
  const io: Io = {
    stdin: (async function* () {
      yield new TextEncoder().encode(input);
    })(),
    stdout: (text) => {
      out.stdout += text;
    },
    stderr: (text) => {
      out.stderr += text;
    },
    isTTY: false,
    env,
  };
  const deps: SensorDeps = {
    platform: "linux",
    // .claude.json in the working directory too, which a relative path would read.
    read: async (file) =>
      file === "/home/me/.claude.json" || file === ".claude.json" ? claudeJson : undefined,
    fetch: async (url, init) => {
      if (fail !== undefined) throw fail;
      sent.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify({ id: "x" }), { status: 202 });
    },
  };
  const code = await sensor(io, deps);
  const bodies = sent.map((request) => JSON.parse(String(request.init.body)) as Observation);
  return { code, sent, bodies, out };
}

describe("forecall hook --sensor", () => {
  it("sends another server's tool result, redacted, to the KB with the key, and prints nothing", async () => {
    const { code, sent, bodies, out } = await run(
      event(
        "mcp__weather__get_forecast",
        {
          content: [{ type: "text", text: `Error: 401 for key ${SECRET} from 10.0.0.7` }],
          isError: true,
        },
        { city: "Tokyo", days: 3 },
      ),
      config(ours),
    );
    expect(code).toBe(EXIT.ok);
    expect(out).toEqual({ stdout: "", stderr: "" });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.url).toBe("https://mcp.forecall.dev/sensor");
    expect(sent[0]?.init.method).toBe("POST");
    expect(sent[0]?.init.headers).toMatchObject({ Authorization: `Bearer ${KEY}` });
    expect(sent[0]?.init.signal).toBeInstanceOf(AbortSignal);
    const [body] = bodies;
    expect(body).toMatchObject({
      server: "weather",
      tool: "get_forecast",
      is_error: true,
      env: { client: "claude-code" },
    });
    expect(body?.error_text).toBe("Error: 401 for key <SECRET> from <IP>");
    expect(Object.keys(body?.args_shape ?? {})).toEqual(["city", "days"]);
    expect(JSON.stringify(body)).not.toContain("Tokyo");
  });

  it("sends results that are not errors too, cut after the redaction", async () => {
    const long = `${"ok ".repeat(666)}${SECRET} and more`;
    const { bodies } = await run(event("mcp__notes__list", long), config(ours));
    expect(bodies[0]?.is_error).toBe(false);
    expect(bodies[0]?.error_text).toHaveLength(SENSOR_TEXT_MAX);
    expect(bodies[0]?.error_text).not.toContain("sk-");
  });

  it.each([
    ["the KB's own tool", event("mcp__forecall__kb_lookup", "Error: x"), config(ours)],
    ["a tool that is not MCP", event("Bash", "Error: x"), config(ours)],
    ["an event that is not JSON", "not json", config(ours)],
    ["no ~/.claude.json", event("mcp__a__b", "x"), undefined],
    ["a ~/.claude.json that is not JSON", event("mcp__a__b", "x"), "{"],
    ["no forecall server", event("mcp__a__b", "x"), JSON.stringify({ mcpServers: {} })],
    [
      "a key that is not an agent key",
      event("mcp__a__b", "x"),
      config({
        ...ours,
        headers: { Authorization: "Bearer fc_ci_0123456789abcdefghijklmnopqrstuv" },
      }),
    ],
    ["no URL", event("mcp__a__b", "x"), config({ headers: ours.headers })],
    ["a URL that is not one", event("mcp__a__b", "x"), config({ ...ours, url: "nowhere" })],
    [
      "plain http to another machine",
      event("mcp__a__b", "x"),
      config({ ...ours, url: "http://mcp.example.com/mcp" }),
    ],
  ])("sends nothing for %s", async (_, input, claudeJson) => {
    const { code, sent, out } = await run(input, claudeJson);
    expect(code).toBe(EXIT.ok);
    expect(sent).toEqual([]);
    expect(out).toEqual({ stdout: "", stderr: "" });
  });

  it("sends nothing without a home directory or CLAUDE_CONFIG_DIR", async () => {
    const { code, sent, out } = await run(event("mcp__a__b", "Error: x"), config(ours), undefined, {
      HOME: "",
      USERPROFILE: "",
      CLAUDE_CONFIG_DIR: "",
    });
    expect(code).toBe(EXIT.ok);
    expect(sent).toEqual([]);
    expect(out).toEqual({ stdout: "", stderr: "" });
  });

  it("sends to a local server over http, and fails quietly when the send does", async () => {
    const local = config({ ...ours, url: "http://mcp.forecall.localhost:8788/mcp" });
    const { sent } = await run(event("mcp__a__b", "x"), local);
    expect(sent[0]?.url).toBe("http://mcp.forecall.localhost:8788/sensor");
    const failed = await run(event("mcp__a__b", "x"), config(ours), new Error("timeout"));
    expect(failed.code).toBe(EXIT.ok);
    expect(failed.out).toEqual({ stdout: "", stderr: "" });
  });

  it.each([
    ["Error: x", "Error: x"],
    [{ content: [{ type: "text", text: "a" }, { type: "image" }, { text: "b" }] }, "a\nb"],
    [{ content: [{ type: "image" }] }, '{"content":[{"type":"image"}]}'],
    [{ temperature: 21 }, '{"temperature":21}'],
    [null, "null"],
    [undefined, ""],
  ])("reads %j as %j", (response, text) => {
    expect(resultText(response)).toBe(text);
  });
});
