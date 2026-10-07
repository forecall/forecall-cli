// What Claude Code's PostToolUse hook gets on standard input, read the same way by `forecall hook`
// (hook.ts) and `forecall hook --sensor` (sensor.ts): the event, the MCP server and tool it names,
// and whether the tool's response says it failed. Anything it cannot read is no event.

import { SERVER_NAME } from "./server-name";

/** More than this is not a tool event worth reading. */
const MAX_EVENT_BYTES = 1_048_576;

const FAILURE_TEXT = /^\s*(?:\[?error\]?|mcp error|failed|exception|traceback)\b/i;

/** The event on standard input, or undefined when it is not a JSON object. */
export async function readEvent(
  stdin: AsyncIterable<Uint8Array>,
): Promise<Record<string, unknown> | undefined> {
  return parse(await readAll(stdin));
}

/** The server and tool of another MCP server's tool (`mcp__<server>__<tool>`), or undefined. */
export function otherMcpTool(name: unknown): { server: string; tool: string } | undefined {
  if (typeof name !== "string" || !name.startsWith("mcp__")) return undefined;
  const [, server = "", ...rest] = name.split("__");
  const tool = rest.join("__");
  if (server === "" || server === SERVER_NAME || tool === "") return undefined;
  return { server, tool };
}

/** Whether a tool's response says it failed: an error flag, an error field, or text that starts like one. */
export function looksFailed(response: unknown): boolean {
  if (typeof response === "string") return FAILURE_TEXT.test(response);
  if (typeof response !== "object" || response === null) return false;
  const record = response as Record<string, unknown>;
  if (record.isError === true || record.is_error === true) return true;
  if (record.error !== undefined && record.error !== null && record.error !== false) return true;
  const content = Array.isArray(record.content) ? record.content : [];
  return content.some((item) => {
    const text = (item as { text?: unknown } | null)?.text;
    return typeof text === "string" && FAILURE_TEXT.test(text);
  });
}

function parse(text: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

async function readAll(stdin: AsyncIterable<Uint8Array>): Promise<string> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of stdin) {
    size += chunk.byteLength;
    if (size > MAX_EVENT_BYTES) return "";
    chunks.push(chunk);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}
