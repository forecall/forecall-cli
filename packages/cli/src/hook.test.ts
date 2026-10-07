import { describe, expect, it } from "vitest";
import { hook, looksFailed } from "./hook";
import { EXIT, type Io } from "./io";

function io(input: string): { io: Io; out: { stdout: string } } {
  const out = { stdout: "" };
  return {
    out,
    io: {
      stdin: (async function* () {
        yield new TextEncoder().encode(input);
      })(),
      stdout: (text) => {
        out.stdout += text;
      },
      stderr: () => {},
      isTTY: false,
      env: {},
    },
  };
}

const event = (tool_name: string, tool_response: unknown) =>
  JSON.stringify({ hook_event_name: "PostToolUse", tool_name, tool_input: {}, tool_response });

describe("forecall hook", () => {
  it("suggests a kb_lookup when an MCP tool of another server fails", async () => {
    const { io: i, out } = io(
      event("mcp__weather__get_forecast", {
        isError: true,
        content: [{ type: "text", text: "HTTP 401" }],
      }),
    );
    expect(await hook(i)).toBe(EXIT.ok);
    const output = JSON.parse(out.stdout) as {
      hookSpecificOutput: { hookEventName: string; additionalContext: string };
    };
    expect(output.hookSpecificOutput.hookEventName).toBe("PostToolUse");
    expect(output.hookSpecificOutput.additionalContext).toContain(
      'server "weather", tool "get_forecast"',
    );
    expect(output.hookSpecificOutput.additionalContext).toContain("kb_lookup");
  });

  it.each<[string, string]>([
    [
      "a tool that succeeded",
      event("mcp__weather__get_forecast", { content: [{ type: "text", text: "Sunny" }] }),
    ],
    ["a tool that is not an MCP tool", event("Bash", { exit_code: 1, stderr: "error" })],
    ["one of the Failure KB's own tools", event("mcp__forecall__kb_lookup", { isError: true })],
    ["a name without a tool", event("mcp__weather", { isError: true })],
    ["no event", ""],
    ["something that is not JSON", "{ nope"],
    ["an array", "[1]"],
  ])("says nothing for %s", async (_, input) => {
    const { io: i, out } = io(input);
    expect(await hook(i)).toBe(EXIT.ok);
    expect(out.stdout).toBe("");
  });

  it("gives up on an event larger than a mebibyte", async () => {
    const { io: i, out } = io(
      `{"tool_name":"mcp__a__b","tool_response":{"isError":true},"pad":"${"x".repeat(1_100_000)}"}`,
    );
    expect(await hook(i)).toBe(EXIT.ok);
    expect(out.stdout).toBe("");
  });

  it.each<[unknown, boolean]>([
    [{ isError: true }, true],
    [{ is_error: true }, true],
    [{ error: { code: -32000 } }, true],
    [{ error: null }, false],
    [{ content: [{ type: "text", text: "Error: boom" }] }, true],
    [{ content: [{ type: "text", text: "MCP error -32602: invalid" }] }, true],
    [{ content: [{ type: "text", text: "All good" }] }, false],
    ["Failed to connect", true],
    ["ok", false],
    [null, false],
    [42, false],
  ])("looksFailed(%j) is %s", (response, expected) => {
    expect(looksFailed(response)).toBe(expected);
  });
});
