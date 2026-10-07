// The AI clients `forecall setup` configures: where each keeps its
// MCP servers and its global instructions, and how an entry for mcp.forecall.dev is written into
// that file and taken out again. Every write edits the client's own file in place (JSON parsed and
// written back; Codex's TOML by its table), touching only the `forecall` entry, so that a second
// run changes nothing and `--remove` leaves the file as it was found. The key goes into these
// files only. Formats were read from each client's documentation on 2026-10-06 (README).

import { join } from "node:path";
import { SERVER_NAME } from "./server-name";
import { MCP_ENDPOINT, MCP_INSTRUCTIONS } from "./shared";

export { SERVER_NAME };

export const CLIENT_IDS = [
  "claude-code",
  "claude-desktop",
  "cursor",
  "codex",
  "gemini",
  "windsurf",
] as const;
export type ClientId = (typeof CLIENT_IDS)[number];

export interface Env {
  HOME?: string;
  USERPROFILE?: string;
  APPDATA?: string;
  CLAUDE_CONFIG_DIR?: string;
}

export interface ClientPaths {
  /** The directory whose presence says the client is installed. */
  marker: string;
  /** The MCP servers file. */
  servers: string;
  /** The global instructions file, where the client has one. */
  instructions?: string;
  /** Claude Code's settings, for the hook. */
  settings?: string;
}

export interface Client {
  id: ClientId;
  name: string;
  paths(env: Env, platform: NodeJS.Platform): ClientPaths;
  /** Puts the server into the file's text (parsed where JSON); returns the new text, or null when it is there. */
  add(text: string, key: string): string | null;
  /** Takes the server out; returns the new text, or null when it is not there. */
  remove(text: string): string | null;
  /** Whether the server is in the file. */
  has(text: string): boolean;
}

function home(env: Env): string {
  return env.HOME ?? env.USERPROFILE ?? "";
}

/** JSON parsed, or an error that names the file as unreadable. */
export function parseJson(text: string, file: string): Record<string, unknown> {
  if (text.trim() === "") return {};
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error(`${file} is not valid JSON; fix it or move it aside`);
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${file} does not hold a JSON object`);
  }
  return value as Record<string, unknown>;
}

function servers(config: Record<string, unknown>): Record<string, unknown> {
  const existing = config.mcpServers;
  if (typeof existing === "object" && existing !== null && !Array.isArray(existing)) {
    return existing as Record<string, unknown>;
  }
  return {};
}

const stringify = (config: Record<string, unknown>) => `${JSON.stringify(config, null, 2)}\n`;

/** A client whose file is JSON with `mcpServers`; `entry` is what the server looks like in it. */
function jsonClient(
  id: ClientId,
  name: string,
  paths: Client["paths"],
  entry: (key: string) => Record<string, unknown>,
): Client {
  return {
    id,
    name,
    paths,
    has: (text) => Object.hasOwn(servers(parseJson(text, name)), SERVER_NAME),
    add: (text, key) => {
      const config = parseJson(text, name);
      const list = servers(config);
      if (Object.hasOwn(list, SERVER_NAME)) return null;
      return stringify({ ...config, mcpServers: { ...list, [SERVER_NAME]: entry(key) } });
    },
    remove: (text) => {
      const config = parseJson(text, name);
      const list = servers(config);
      if (!Object.hasOwn(list, SERVER_NAME)) return null;
      const { [SERVER_NAME]: _removed, ...rest } = list;
      return stringify({ ...config, mcpServers: rest });
    },
  };
}

const bearer = (key: string) => ({ Authorization: `Bearer ${key}` });

/** Codex keeps TOML: the server is a `[mcp_servers.forecall]` table, added or removed as text. */
const CODEX_TABLE = `[mcp_servers.${SERVER_NAME}]`;
const codexTable = (key: string) =>
  `${CODEX_TABLE}\nurl = "${MCP_ENDPOINT}"\nhttp_headers = { Authorization = "Bearer ${key}" }\n`;

function codexHas(text: string): boolean {
  return text.split("\n").some((line) => line.trim() === CODEX_TABLE);
}

function codexRemove(text: string): string | null {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => line.trim() === CODEX_TABLE);
  if (start === -1) return null;
  let end = start + 1;
  while (end < lines.length && !/^\s*\[/.test(lines[end] ?? "")) end += 1;
  // The table's trailing blank lines go with it, but one stays between the neighbours.
  const before = lines.slice(0, start);
  while (before.length > 0 && before.at(-1)?.trim() === "") before.pop();
  const after = lines.slice(end);
  const joined = [
    ...before,
    ...(before.length > 0 && after.some((l) => l.trim() !== "") ? [""] : []),
    ...after,
  ];
  const out = joined.join("\n");
  return out.trim() === "" ? "" : out.endsWith("\n") ? out : `${out}\n`;
}

export const CLIENTS: readonly Client[] = [
  jsonClient(
    "claude-code",
    "Claude Code",
    (env) => {
      const config = env.CLAUDE_CONFIG_DIR ?? join(home(env), ".claude");
      return {
        marker: config,
        // User-scope servers live in ~/.claude.json, beside the config directory.
        servers: env.CLAUDE_CONFIG_DIR
          ? join(env.CLAUDE_CONFIG_DIR, ".claude.json")
          : join(home(env), ".claude.json"),
        instructions: join(config, "CLAUDE.md"),
        settings: join(config, "settings.json"),
      };
    },
    (key) => ({ type: "http", url: MCP_ENDPOINT, headers: bearer(key) }),
  ),
  jsonClient(
    "claude-desktop",
    "Claude Desktop",
    (env, platform) => {
      const dir =
        platform === "win32"
          ? join(env.APPDATA ?? join(home(env), "AppData", "Roaming"), "Claude")
          : platform === "darwin"
            ? join(home(env), "Library", "Application Support", "Claude")
            : join(home(env), ".config", "Claude");
      return { marker: dir, servers: join(dir, "claude_desktop_config.json") };
    },
    // The desktop app starts stdio servers only: mcp-remote bridges to the HTTP server, with the
    // key in the entry's environment (its README's form for a header with a space).
    (key) => ({
      command: "npx",
      // biome-ignore lint/suspicious/noTemplateCurlyInString: mcp-remote expands ${…} from the entry's env, not we.
      args: ["-y", "mcp-remote", MCP_ENDPOINT, "--header", "Authorization:${FORECALL_AUTH}"],
      env: { FORECALL_AUTH: `Bearer ${key}` },
    }),
  ),
  jsonClient(
    "cursor",
    "Cursor",
    (env) => ({
      marker: join(home(env), ".cursor"),
      servers: join(home(env), ".cursor", "mcp.json"),
    }),
    (key) => ({ url: MCP_ENDPOINT, headers: bearer(key) }),
  ),
  {
    id: "codex",
    name: "Codex",
    paths: (env) => ({
      marker: join(home(env), ".codex"),
      servers: join(home(env), ".codex", "config.toml"),
      instructions: join(home(env), ".codex", "AGENTS.md"),
    }),
    has: codexHas,
    add: (text, key) => {
      if (codexHas(text)) return null;
      const base = text.trim() === "" ? "" : `${text.replace(/\s+$/, "")}\n\n`;
      return `${base}${codexTable(key)}`;
    },
    remove: codexRemove,
  },
  jsonClient(
    "gemini",
    "Gemini CLI",
    (env) => ({
      marker: join(home(env), ".gemini"),
      servers: join(home(env), ".gemini", "settings.json"),
      instructions: join(home(env), ".gemini", "GEMINI.md"),
    }),
    (key) => ({ httpUrl: MCP_ENDPOINT, headers: bearer(key) }),
  ),
  jsonClient(
    "windsurf",
    "Windsurf",
    (env) => {
      const dir = join(home(env), ".codeium", "windsurf");
      return {
        marker: dir,
        servers: join(dir, "mcp_config.json"),
        instructions: join(dir, "memories", "global_rules.md"),
      };
    },
    (key) => ({ serverUrl: MCP_ENDPOINT, headers: bearer(key) }),
  ),
];

export function clientById(id: string): Client | undefined {
  return CLIENTS.find((client) => client.id === id);
}

// The instructions, once, between markers (Bhived's form), so that a second run finds them and
// --remove takes exactly them out.
export const BLOCK_START = "<!-- forecall:start -->";
export const BLOCK_END = "<!-- forecall:end -->";

export const INSTRUCTIONS_BLOCK = [
  BLOCK_START,
  "## Forecall Failure KB (MCP server `forecall`)",
  "",
  MCP_INSTRUCTIONS,
  BLOCK_END,
].join("\n");

export function hasBlock(text: string): boolean {
  return text.includes(BLOCK_START);
}

export function addBlock(text: string): string | null {
  if (hasBlock(text)) return null;
  const base = text.trim() === "" ? "" : `${text.replace(/\s+$/, "")}\n\n`;
  return `${base}${INSTRUCTIONS_BLOCK}\n`;
}

export function removeBlock(text: string): string | null {
  const start = text.indexOf(BLOCK_START);
  if (start === -1) return null;
  const endMarker = text.indexOf(BLOCK_END, start);
  const end = endMarker === -1 ? text.length : endMarker + BLOCK_END.length;
  const before = text.slice(0, start).replace(/\s+$/, "");
  const after = text.slice(end).replace(/^\s+/, "");
  if (before === "" && after === "") return "";
  if (before === "") return `${after.replace(/\s+$/, "")}\n`;
  if (after === "") return `${before}\n`;
  return `${before}\n\n${after.replace(/\s+$/, "")}\n`;
}
