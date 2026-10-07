// `forecall hook --sensor`: the sensor. Claude Code runs it in the background after each MCP tool
// call (an `async` hook, which `forecall setup --sensor` adds). It reads the event, redacts the
// tool's result on this machine with the KB's own rules (redact.ts, which the KB's server applies
// again), and sends it to the server the `forecall` MCP entry in ~/.claude.json names, with that
// entry's key. It prints nothing, gives up after 2 seconds, and never fails: the agent sees none of
// it. Bundled apart (dist/sensor.js), the one hook that reaches the network.

import { readFile } from "node:fs/promises";
import { type Client, clientById, parseJson } from "./clients";
import { looksFailed, otherMcpTool, readEvent } from "./event";
import { EXIT, type Io } from "./io";
import { argsShape, redactText } from "./redact";
import { SERVER_NAME } from "./server-name";
import { isAgentKey } from "./shared";

/** As much of a result as is sent: the head says what failed. */
export const SENSOR_TEXT_MAX = 2_000;
/** As much as is redacted: enough that no secret is cut at SENSOR_TEXT_MAX. */
const REDACT_MAX = 20_000;
export const SENSOR_TIMEOUT_MS = 2_000;

export interface SensorDeps {
  platform: NodeJS.Platform;
  read(file: string): Promise<string | undefined>;
  fetch: typeof fetch;
}

export const defaultSensorDeps: SensorDeps = {
  platform: process.platform,
  read: (file) => readFile(file, "utf8").catch(() => undefined),
  fetch: (input, init) => fetch(input, init),
};

export interface Observation {
  server: string;
  tool: string;
  is_error: boolean;
  error_text: string;
  args_shape: Record<string, unknown>;
  env: { client: string };
}

export async function sensor(io: Io, deps: SensorDeps = defaultSensorDeps): Promise<number> {
  try {
    const event = await readEvent(io.stdin);
    const named = otherMcpTool(event?.tool_name);
    if (event === undefined || named === undefined) return EXIT.ok;
    const target = await sensorTarget(io.env, deps);
    if (target === undefined) return EXIT.ok;
    const response = await deps.fetch(target.url, {
      method: "POST",
      headers: { Authorization: `Bearer ${target.key}`, "Content-Type": "application/json" },
      body: JSON.stringify(observation(named, event)),
      signal: AbortSignal.timeout(SENSOR_TIMEOUT_MS),
    });
    // The answer (202 and an id, or a refusal) is of no use here; let the connection go.
    await response.body?.cancel();
  } catch {
    // A sensor that cannot send loses one observation, and nothing else.
  }
  return EXIT.ok;
}

/** What is sent for the event: the result's text redacted, then cut, and the arguments' shape. */
export function observation(
  named: { server: string; tool: string },
  event: Record<string, unknown>,
): Observation {
  const text = redactText(resultText(event.tool_response).slice(0, REDACT_MAX)).text;
  return {
    ...named,
    is_error: looksFailed(event.tool_response),
    error_text: text.slice(0, SENSOR_TEXT_MAX),
    args_shape: argsShape(event.tool_input),
    env: { client: "claude-code" },
  };
}

/** A response's text: itself, or its content's text parts, or its JSON. */
export function resultText(response: unknown): string {
  if (typeof response === "string") return response;
  if (response === undefined) return "";
  const content = (response as { content?: unknown } | null)?.content;
  if (Array.isArray(content)) {
    const texts = content
      .map((item) => (item as { text?: unknown } | null)?.text)
      .filter((text): text is string => typeof text === "string");
    if (texts.length > 0) return texts.join("\n");
  }
  return JSON.stringify(response) ?? "";
}

/**
 * Where to send and with which key: the `forecall` entry of Claude Code's user-scope servers, its
 * URL's `/sensor` and its bearer key. Only https, or http to this machine (a local server).
 */
export async function sensorTarget(
  env: Io["env"],
  deps: Pick<SensorDeps, "platform" | "read">,
): Promise<{ url: string; key: string } | undefined> {
  const claudeCode = clientById("claude-code") as Client;
  const text = await deps.read(claudeCode.paths(env, deps.platform).servers);
  if (text === undefined) return undefined;
  const entry = (
    parseJson(text, "~/.claude.json").mcpServers as Record<string, unknown> | undefined
  )?.[SERVER_NAME] as { url?: unknown; headers?: { Authorization?: unknown } } | undefined;
  const key = /^Bearer (\S+)$/.exec(String(entry?.headers?.Authorization ?? ""))?.[1];
  if (typeof entry?.url !== "string" || key === undefined || !isAgentKey(key)) return undefined;
  let url: URL;
  try {
    url = new URL("/sensor", entry.url);
  } catch {
    return undefined;
  }
  const local =
    ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    url.hostname.endsWith(".localhost");
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) return undefined;
  return { url: url.toString(), key };
}
