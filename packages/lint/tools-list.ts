import type { Tool } from "./tool.ts";
import { web } from "./web.ts";

/** Limits on a pasted tools/list. "1 MB" is read as 1 MiB of UTF-8. */
export const MAX_INPUT_BYTES = 1_048_576;
export const MAX_TOOLS = 200;

/**
 * snake_case spellings of the camelCase keys the linter reads. Only these
 * are reported: argument names inside inputSchema are often snake_case on purpose, and keys the
 * linter does not read are left alone (the Python SDK dumps `execution.task_support` as is).
 */
const SNAKE_CASE_KEYS = {
  tool: { input_schema: "inputSchema", output_schema: "outputSchema" },
  annotations: {
    read_only_hint: "readOnlyHint",
    destructive_hint: "destructiveHint",
    idempotent_hint: "idempotentHint",
    open_world_hint: "openWorldHint",
  },
};

type FieldType = "string" | "boolean" | "object";
const TOOL_FIELDS: [string, FieldType][] = [
  ["title", "string"],
  ["description", "string"],
  ["inputSchema", "object"],
  ["outputSchema", "object"],
];
const ANNOTATION_FIELDS: [string, FieldType][] = [
  ["title", "string"],
  ["readOnlyHint", "boolean"],
  ["destructiveHint", "boolean"],
  ["idempotentHint", "boolean"],
  ["openWorldHint", "boolean"],
];

export interface SnakeCaseKey {
  /** Where the key is, e.g. `tools[3].annotations.read_only_hint`. */
  path: string;
  key: string;
  /** The camelCase key to use instead. */
  expected: string;
}

/** Why an input was rejected. forecall.dev answers these with 413 / 400 / 422. */
export type ToolsListError =
  | { code: "input_too_large"; limit: number }
  | { code: "invalid_json" }
  | { code: "unrecognized_shape" }
  | { code: "too_many_tools"; count: number; limit: number }
  | { code: "snake_case_keys"; keys: SnakeCaseKey[] }
  | { code: "invalid_tool"; path: string; expected: string };

/**
 * What the server said at initialize, when the input is a `forecall dump` file (`server` or
 * `instructions` beside `tools`). A bare tools/list carries none, so the linter cannot tell
 * whether the server has instructions; a dump can.
 */
export interface Handshake {
  /** The server's instructions; undefined when the dump has none. */
  instructions: string | undefined;
}

export type ToolsListResult =
  | { ok: true; tools: Tool[]; handshake?: Handshake }
  | { ok: false; error: ToolsListError };

/** Checks the size of the pasted text, parses it and reads it with readToolsList. */
export function parseToolsList(text: string): ToolsListResult {
  // A UTF-16 code unit is at least one UTF-8 byte, so long text is rejected without encoding it.
  if (
    text.length > MAX_INPUT_BYTES ||
    new web.TextEncoder().encode(text).length > MAX_INPUT_BYTES
  ) {
    return { ok: false, error: { code: "input_too_large", limit: MAX_INPUT_BYTES } };
  }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: { code: "invalid_json" } };
  }
  return readToolsList(data);
}

/**
 * Reads parsed JSON: extracts the tools, checks the count and the key spelling, then checks each
 * tool's field types. null is treated as an absent field; fields Forecall does not read are dropped.
 */
export function readToolsList(data: unknown): ToolsListResult {
  const extracted = extractTools(data);
  if (!extracted.ok) return extracted;
  const raw = extracted.tools;
  if (raw.length > MAX_TOOLS) {
    return { ok: false, error: { code: "too_many_tools", count: raw.length, limit: MAX_TOOLS } };
  }
  const keys = findSnakeCaseKeys(raw);
  if (keys.length > 0) return { ok: false, error: { code: "snake_case_keys", keys } };

  const tools: Tool[] = [];
  for (const [index, value] of raw.entries()) {
    const tool = normalizeTool(value, `tools[${index}]`);
    if ("code" in tool) return { ok: false, error: tool };
    tools.push(tool);
  }
  return extracted.handshake === undefined
    ? { ok: true, tools }
    : { ok: true, tools, handshake: extracted.handshake };
}

/**
 * Accepts a bare array, `{"tools": [...]}` or a JSON-RPC response `{"result": {"tools": [...]}}`.
 * A `forecall dump` file (`{"tools": [...]}` with `server` or `instructions`) also gives the
 * handshake.
 */
export function extractTools(
  data: unknown,
):
  | { ok: true; tools: unknown[]; handshake?: Handshake }
  | { ok: false; error: { code: "unrecognized_shape" } } {
  if (Array.isArray(data)) return { ok: true, tools: data };
  if (isObject(data)) {
    if (Array.isArray(data.tools)) {
      if (isObject(data.server) || Object.hasOwn(data, "instructions")) {
        const instructions = typeof data.instructions === "string" ? data.instructions : undefined;
        return { ok: true, tools: data.tools, handshake: { instructions } };
      }
      return { ok: true, tools: data.tools };
    }
    if (isObject(data.result) && Array.isArray(data.result.tools)) {
      return { ok: true, tools: data.result.tools };
    }
  }
  return { ok: false, error: { code: "unrecognized_shape" } };
}

export function findSnakeCaseKeys(tools: readonly unknown[]): SnakeCaseKey[] {
  const found: SnakeCaseKey[] = [];
  const collect = (
    object: Record<string, unknown>,
    path: string,
    table: Record<string, string>,
  ) => {
    for (const [key, expected] of Object.entries(table)) {
      if (Object.hasOwn(object, key)) found.push({ path: `${path}.${key}`, key, expected });
    }
  };
  for (const [index, tool] of tools.entries()) {
    if (!isObject(tool)) continue;
    collect(tool, `tools[${index}]`, SNAKE_CASE_KEYS.tool);
    if (isObject(tool.annotations)) {
      collect(tool.annotations, `tools[${index}].annotations`, SNAKE_CASE_KEYS.annotations);
    }
  }
  return found;
}

type InvalidTool = Extract<ToolsListError, { code: "invalid_tool" }>;

function normalizeTool(value: unknown, path: string): Tool | InvalidTool {
  if (!isObject(value)) return invalid(path, "object");
  if (typeof value.name !== "string" || value.name === "") {
    return invalid(`${path}.name`, "non-empty string");
  }
  const tool: Record<string, unknown> = { name: value.name };
  const error = copyFields(value, tool, TOOL_FIELDS, path);
  if (error) return error;

  if (!isAbsent(value.annotations)) {
    if (!isObject(value.annotations)) return invalid(`${path}.annotations`, "object");
    const annotations: Record<string, unknown> = {};
    const annotationError = copyFields(
      value.annotations,
      annotations,
      ANNOTATION_FIELDS,
      `${path}.annotations`,
    );
    if (annotationError) return annotationError;
    tool.annotations = annotations;
  }
  return tool as unknown as Tool;
}

function copyFields(
  source: Record<string, unknown>,
  target: Record<string, unknown>,
  fields: [string, FieldType][],
  path: string,
): InvalidTool | undefined {
  for (const [key, type] of fields) {
    const value = source[key];
    if (isAbsent(value)) continue;
    if (type === "object" ? !isObject(value) : typeof value !== type) {
      return invalid(`${path}.${key}`, type);
    }
    target[key] = value;
  }
  return undefined;
}

function invalid(path: string, expected: string): InvalidTool {
  return { code: "invalid_tool", path, expected };
}

function isAbsent(value: unknown): value is null | undefined {
  return value === undefined || value === null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
