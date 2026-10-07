// `forecall hook`: Claude Code's PostToolUse hook. Reads the event on
// standard input and, when an MCP tool of another server returned an error, hands Claude a note
// to look the failure up in the Failure KB first. It never talks to the network and never fails
// the tool call: anything it cannot read is left alone, and the exit code is always 0. The
// sensor (`forecall hook --sensor`, sensor.ts) is a hook of its own.

import { looksFailed, otherMcpTool, readEvent } from "./event";
import { EXIT, type Io } from "./io";
import { SERVER_NAME } from "./server-name";

export { looksFailed };

export async function hook(io: Io): Promise<number> {
  const event = await readEvent(io.stdin);
  if (event === undefined) return EXIT.ok;
  const named = otherMcpTool(event.tool_name);
  if (named === undefined) return EXIT.ok;
  if (!looksFailed(event.tool_response)) return EXIT.ok;
  const { server, tool } = named;
  const note = [
    `The MCP tool "${tool}" of the server "${server}" returned an error.`,
    `Before retrying or working around it yourself, call kb_lookup on the "${SERVER_NAME}" MCP server with server "${server}", tool "${tool}" and the error text: another agent may have a verified workaround.`,
    "If you resolve it yourself, report it with kb_report once the workaround worked.",
  ].join(" ");
  io.stdout(
    `${JSON.stringify({
      hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: note },
    })}\n`,
  );
  return EXIT.ok;
}
