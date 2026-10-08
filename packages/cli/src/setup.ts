// `forecall setup` and `forecall setup --remove`: connects the AI
// clients on this machine to the Failure KB. Every change is to a client's own file (clients.ts),
// made once and undone by --remove; the key is asked for, or taken from --key, and written into
// those files only. Without a terminal and without --key, it says what to do and exits with 0,
// so that a CI job that runs it by mistake does not fail. `--sensor` adds the sensor's hook too,
// never by default; `--remove --sensor` takes only that out. Without a home directory it writes
// nothing: every path would be relative to the working directory.
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";
import {
  addBlock,
  CLIENT_IDS,
  CLIENTS,
  type Client,
  type ClientId,
  clientById,
  hasBlock,
  homeDir,
  INSTRUCTIONS_BLOCK,
  parseJson,
  removeBlock,
} from "./clients";
import { EXIT, type Io } from "./io";
import { SETUP_HELP } from "./setup-help";
import { brand, isAgentKey } from "./shared";

export { SETUP_HELP };

export const KEYS_URL = `https://app.${brand.domain}/api-keys?new=agent`;
/** The hook Claude Code runs after an MCP tool call (hook.ts); npx finds the CLI wherever it is. */
export const HOOK_COMMAND = "npx -y forecall hook";
export const HOOK_MATCHER = "mcp__.*";
/** npx can take a moment the first time; the hook itself is done in well under a second. */
export const HOOK_TIMEOUT_SECONDS = 10;
/** The sensor (sensor.ts): an `async` hook, so that Claude Code does not wait for its send. */
export const SENSOR_COMMAND = "npx -y forecall hook --sensor";

type HookKind = "hint" | "sensor";
const HOOK_COMMANDS: Record<HookKind, string> = { hint: HOOK_COMMAND, sensor: SENSOR_COMMAND };

/** What the command touches on the machine, so tests can pass their own. */
export interface SetupDeps {
  platform: NodeJS.Platform;
  read(file: string): Promise<string | undefined>;
  write(file: string, text: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  openBrowser(url: string): Promise<void>;
  /** A line typed at the terminal, or undefined when there is none. */
  prompt(question: string): Promise<string | undefined>;
}

export const defaultDeps: SetupDeps = {
  platform: process.platform,
  read: async (file) => {
    try {
      return await readFile(file, "utf8");
    } catch (error) {
      if ((error as { code?: string }).code === "ENOENT") return undefined;
      throw error;
    }
  },
  write: async (file, text) => {
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, text, "utf8");
  },
  exists: async (path) => {
    try {
      await readFile(path).catch((error: { code?: string }) => {
        if (error.code === "EISDIR") return;
        throw error;
      });
      return true;
    } catch {
      return false;
    }
  },
  openBrowser: async (url) => {
    const [command, args] =
      process.platform === "darwin"
        ? ["open", [url]]
        : process.platform === "win32"
          ? ["cmd", ["/c", "start", "", url]]
          : ["xdg-open", [url]];
    await new Promise<void>((resolve) => {
      const child = spawn(command, args, { stdio: "ignore", detached: true });
      child.on("error", () => resolve());
      child.on("spawn", () => {
        child.unref();
        resolve();
      });
    });
  },
  prompt: async (question) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
      return await rl.question(question);
    } finally {
      rl.close();
    }
  },
};

type Parsed =
  | { ok: true; help: true }
  | {
      ok: true;
      help: false;
      key?: string;
      clients: ClientId[];
      hook?: boolean;
      sensor: boolean;
      remove: boolean;
      dryRun: boolean;
    }
  | { ok: false; message: string };

export function parseSetupArgs(args: string[]): Parsed {
  let values: ReturnType<typeof parseArgs>["values"];
  try {
    ({ values } = parseArgs({
      args,
      allowPositionals: false,
      strict: true,
      options: {
        key: { type: "string" },
        client: { type: "string", multiple: true },
        hook: { type: "boolean" },
        "no-hook": { type: "boolean" },
        sensor: { type: "boolean" },
        remove: { type: "boolean" },
        "dry-run": { type: "boolean" },
        help: { type: "boolean", short: "h" },
      },
    }));
  } catch (error) {
    return { ok: false, message: (error as Error).message };
  }
  if (values.help) return { ok: true, help: true };
  const clients: ClientId[] = [];
  for (const id of (values.client as string[] | undefined) ?? []) {
    if (!(CLIENT_IDS as readonly string[]).includes(id)) {
      return { ok: false, message: `unknown client "${id}" (one of ${CLIENT_IDS.join(", ")})` };
    }
    clients.push(id as ClientId);
  }
  if (values.hook && values["no-hook"])
    return { ok: false, message: "--hook and --no-hook together" };
  const key = values.key as string | undefined;
  if (key !== undefined && !isAgentKey(key)) {
    return {
      ok: false,
      message: "--key must be an agent key (fc_agent_... from app.forecall.dev/api-keys)",
    };
  }
  return {
    ok: true,
    help: false,
    ...(key === undefined ? {} : { key }),
    clients,
    ...(values.hook ? { hook: true } : values["no-hook"] ? { hook: false } : {}),
    sensor: values.sensor === true,
    remove: values.remove === true,
    dryRun: values["dry-run"] === true,
  };
}

export async function setup(
  args: string[],
  io: Io,
  deps: SetupDeps = defaultDeps,
): Promise<number> {
  const parsed = parseSetupArgs(args);
  if (!parsed.ok) {
    io.stderr(`forecall: ${parsed.message}\n\n${SETUP_HELP}`);
    return EXIT.error;
  }
  if (parsed.help) {
    io.stdout(SETUP_HELP);
    return EXIT.ok;
  }
  if (homeDir(io.env) === undefined) {
    io.stderr("forecall: cannot find your home directory: set HOME (USERPROFILE on Windows)\n");
    return EXIT.error;
  }
  const targets =
    parsed.clients.length > 0
      ? parsed.clients.map((id) => clientById(id) as Client)
      : await detect(deps, io);
  if (targets.length === 0) {
    io.stdout(
      `No supported client found (${CLIENT_IDS.join(", ")}). Install one, or run with --client <name> to write its files anyway.\n`,
    );
    return EXIT.ok;
  }
  const { remove, dryRun, sensor } = parsed;
  const wantsClaudeCode = targets.some((client) => client.id === "claude-code");
  if (sensor && !wantsClaudeCode) {
    io.stdout(
      "The sensor is a Claude Code hook, and Claude Code was not found: run with --client claude-code to add it anyway.\n",
    );
  }
  // `--remove --sensor` takes out the sensor's hook and nothing else.
  const sensorOnly = remove && sensor;
  let key: string | undefined;
  if (!remove) {
    // A key is asked for only when some client still lacks the server (adding the sensor later).
    key = parsed.key ?? ((await allHaveServer(targets, io, deps)) ? "" : await askKey(io, deps));
    if (key === undefined) return EXIT.ok;
  }
  let hook = parsed.hook;
  if (!remove && wantsClaudeCode && hook === undefined) {
    hook = await askHook(io, deps);
    if (hook === undefined) return EXIT.ok;
  }

  const verb = dryRun ? (remove ? "would remove" : "would add") : remove ? "removed" : "added";
  let failed = false;
  for (const client of targets) {
    if (sensorOnly && client.id !== "claude-code") continue;
    const paths = client.paths(io.env, deps.platform);
    const changes: string[] = [];
    try {
      // The MCP server. An entry already there changes only when an earlier forecall wrote it in
      // another form (clients.ts), which is then updated, keeping its key.
      const text = (await deps.read(paths.servers)) ?? "";
      const had = !remove && !sensorOnly && client.has(text);
      const next = sensorOnly ? null : remove ? client.remove(text) : client.add(text, key ?? "");
      if (next !== null) {
        if (!dryRun) await deps.write(paths.servers, next);
        const update = dryRun ? "would update" : "updated";
        changes.push(`${had ? update : verb} the server in ${paths.servers}`);
      }
      // The instructions.
      if (paths.instructions !== undefined && !sensorOnly) {
        const current = (await deps.read(paths.instructions)) ?? "";
        const block = remove ? removeBlock(current) : addBlock(current);
        if (block !== null) {
          if (!dryRun) await deps.write(paths.instructions, block);
          changes.push(`${verb} the instructions in ${paths.instructions}`);
        }
      }
      // Claude Code's hooks: each added when asked for, removed with everything else.
      const kinds: HookKind[] = sensorOnly
        ? ["sensor"]
        : remove
          ? ["hint", "sensor"]
          : [...(hook === true ? ["hint" as const] : []), ...(sensor ? ["sensor" as const] : [])];
      if (paths.settings !== undefined && kinds.length > 0) {
        let settings = (await deps.read(paths.settings)) ?? "";
        const changed: HookKind[] = [];
        for (const kind of kinds) {
          const next = remove ? removeHook(settings, [kind]) : addHook(settings, kind);
          if (next === null) continue;
          settings = next;
          changed.push(kind);
        }
        if (changed.length > 0) {
          if (!dryRun) await deps.write(paths.settings, settings);
          const names = changed.map((kind) =>
            kind === "hint" ? "PostToolUse hook" : "sensor's hook",
          );
          changes.push(`${verb} the ${names.join(" and the ")} in ${paths.settings}`);
        }
      }
    } catch (error) {
      failed = true;
      io.stderr(`${client.name}: ${(error as Error).message}\n`);
      continue;
    }
    io.stdout(
      changes.length === 0
        ? `${client.name}: nothing to ${remove ? "remove" : "change"}\n`
        : `${client.name}: ${changes.join("; ")}\n`,
    );
    if (!remove && client.id === "cursor") {
      io.stdout(
        "  Cursor keeps its global rules in Settings → Rules: paste the block below there once.\n",
      );
    }
    if (!remove && client.id === "claude-desktop") {
      io.stdout(
        "  Restart Claude Desktop to load the server (it runs forecall-mcp through npx).\n",
      );
    }
  }
  if (!remove && targets.some((client) => client.id === "cursor")) {
    io.stdout(`\n${INSTRUCTIONS_BLOCK}\n`);
  }
  if (!remove && sensor && wantsClaudeCode) {
    io.stdout(
      "\nThe sensor sends each MCP tool's result, redacted on this machine and cut to 2,000 characters, with the tool's name and the shape of its arguments, to the Failure KB. `npx forecall setup --remove --sensor` stops it.\n",
    );
  }
  if (!remove && !dryRun && !failed) {
    io.stdout(`\nDone. Ask your agent to call kb_lookup on the ${brand.name} server to try it.\n`);
  }
  return failed ? EXIT.error : EXIT.ok;
}

/** Whether every client already has the server, so that no key is needed. */
async function allHaveServer(targets: Client[], io: Io, deps: SetupDeps): Promise<boolean> {
  for (const client of targets) {
    const text = (await deps.read(client.paths(io.env, deps.platform).servers)) ?? "";
    try {
      if (!client.has(text)) return false;
    } catch {
      return false;
    }
  }
  return true;
}

async function detect(deps: SetupDeps, io: Io): Promise<Client[]> {
  const found: Client[] = [];
  for (const client of CLIENTS) {
    const paths = client.paths(io.env, deps.platform);
    if ((await deps.exists(paths.marker)) || (await deps.exists(paths.servers))) found.push(client);
  }
  return found;
}

/** The key, from the terminal; undefined when there is no terminal (the guidance is printed). */
async function askKey(io: Io, deps: SetupDeps): Promise<string | undefined> {
  if (!io.isTTY) {
    io.stdout(
      `No terminal to ask for the key. Make an agent key at ${KEYS_URL} and run:\n  npx forecall setup --key <fc_agent_...>\n`,
    );
    return undefined;
  }
  io.stdout(`Make an agent key at ${KEYS_URL} (opening it in your browser).\n`);
  await deps.openBrowser(KEYS_URL).catch(() => undefined);
  for (let attempt = 0; attempt < 3; attempt++) {
    const typed = (await deps.prompt("Paste the key (fc_agent_...): "))?.trim();
    if (typed === undefined) return undefined;
    if (isAgentKey(typed)) return typed;
    io.stderr("That is not an agent key: it starts with fc_agent_ and is 41 characters long.\n");
  }
  return undefined;
}

async function askHook(io: Io, deps: SetupDeps): Promise<boolean | undefined> {
  if (!io.isTTY) {
    io.stdout(
      "Not adding the Claude Code hook without a terminal: run again with --hook to add it, or --no-hook to skip it.\n",
    );
    return false;
  }
  const answer = await deps.prompt(
    "Add a Claude Code PostToolUse hook that suggests kb_lookup when an MCP tool fails? It runs `npx -y forecall hook` after each MCP tool call, offline. [y/N] ",
  );
  if (answer === undefined) return undefined;
  return /^y(es)?$/i.test(answer.trim());
}

interface HookEntry {
  matcher?: unknown;
  hooks?: unknown;
}

/** Which of our hooks an entry holds: the sensor's (`forecall hook --sensor`), the hint, or none. */
function kindOf(entry: unknown): HookKind | undefined {
  const hooks = (entry as HookEntry | null)?.hooks;
  if (!Array.isArray(hooks)) return undefined;
  const commands = hooks
    .map((hook) => (hook as { command?: unknown })?.command)
    .filter((command): command is string => typeof command === "string");
  if (commands.some((command) => command.includes("forecall hook --sensor"))) return "sensor";
  if (commands.some((command) => command.includes("forecall hook"))) return "hint";
  return undefined;
}

function hooksOf(settings: Record<string, unknown>): {
  hooks: Record<string, unknown>;
  post: unknown[];
} {
  const hooks =
    typeof settings.hooks === "object" && settings.hooks !== null && !Array.isArray(settings.hooks)
      ? (settings.hooks as Record<string, unknown>)
      : {};
  const post = Array.isArray(hooks.PostToolUse) ? hooks.PostToolUse : [];
  return { hooks, post };
}

export function addHook(text: string, kind: HookKind = "hint"): string | null {
  const settings = parseJson(text, "settings.json");
  const { hooks, post } = hooksOf(settings);
  if (post.some((entry) => kindOf(entry) === kind)) return null;
  const command = { type: "command", command: HOOK_COMMANDS[kind], timeout: HOOK_TIMEOUT_SECONDS };
  const entry = {
    matcher: HOOK_MATCHER,
    hooks: [kind === "sensor" ? { ...command, async: true } : command],
  };
  return `${JSON.stringify({ ...settings, hooks: { ...hooks, PostToolUse: [...post, entry] } }, null, 2)}\n`;
}

export function removeHook(
  text: string,
  kinds: readonly HookKind[] = ["hint", "sensor"],
): string | null {
  const settings = parseJson(text, "settings.json");
  const { hooks, post } = hooksOf(settings);
  const ours = (entry: unknown) => kinds.includes(kindOf(entry) as HookKind);
  if (!post.some(ours)) return null;
  const kept = post.filter((entry) => !ours(entry));
  const { PostToolUse: _removed, ...otherHooks } = hooks;
  const nextHooks = kept.length > 0 ? { ...otherHooks, PostToolUse: kept } : otherHooks;
  const { hooks: _hooks, ...rest } = settings;
  const next = Object.keys(nextHooks).length > 0 ? { ...rest, hooks: nextHooks } : rest;
  return `${JSON.stringify(next, null, 2)}\n`;
}

export const instructionsBlock = INSTRUCTIONS_BLOCK;
export const hasInstructions = hasBlock;
