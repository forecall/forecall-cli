// `forecall dump`: asks an MCP server for its tools/list and prints it as JSON that `forecall lint`,
// forecall.dev and the dashboard accept. The only command that talks
// to the network: it starts the stdio server the user names, or connects to the URL they give.
// Bundled apart from `lint` (build.ts), which never loads it.
import { writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { MAX_INPUT_BYTES, MAX_TOOLS } from "@forecall/lint/internal/tools-list";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { version } from "../package.json";
import { DUMP_HELP } from "./dump-help";
import { EXIT, type Io } from "./io";

export { DUMP_HELP };

export const DEFAULT_TIMEOUT_SECONDS = 60;

export type Target =
  | { kind: "stdio"; command: string; args: string[] }
  | { kind: "http"; url: URL };

export interface DumpOptions {
  target: Target;
  output: string | undefined;
  headers: Record<string, string>;
  env: Record<string, string>;
  cwd: string | undefined;
  timeoutSeconds: number;
}

export type ParsedDumpArgs =
  | { ok: true; help: true }
  | { ok: true; help: false; options: DumpOptions }
  | { ok: false; message: string };

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

/** Reads `forecall dump`'s arguments. The server's own command comes after `--`, untouched. */
export function parseDumpArgs(args: string[]): ParsedDumpArgs {
  const split = args.indexOf("--");
  const ours = split === -1 ? args : args.slice(0, split);
  const command = split === -1 ? [] : args.slice(split + 1);
  let parsed: ReturnType<typeof parseOwn>;
  try {
    parsed = parseOwn(ours);
  } catch (error) {
    return { ok: false, message: (error as Error).message };
  }
  const { values, positionals } = parsed;
  if (values.help) return { ok: true, help: true };

  let target: Target;
  if (split !== -1) {
    if (positionals.length > 0) return fail("give either a URL or a command after --, not both");
    const [name, ...rest] = command;
    if (name === undefined) return fail("missing the server's command after --");
    target = { kind: "stdio", command: name, args: rest };
  } else {
    if (positionals.length === 0) return fail("missing <url>, or the server's command after --");
    if (positionals.length > 1) return fail("give one <url>; put a server's command after --");
    const url = URL.canParse(positionals[0] as string) ? new URL(positionals[0] as string) : null;
    if (url === null || !["https:", "http:"].includes(url.protocol)) {
      return fail("<url> must start with https:// or http://; put a server's command after --");
    }
    target = { kind: "http", url };
  }

  const headers: Record<string, string> = {};
  for (const header of values.header ?? []) {
    const at = header.indexOf(":");
    const name = header.slice(0, Math.max(at, 0)).trim();
    if (at === -1 || !HEADER_NAME.test(name)) return fail(`--header must be "Name: value"`);
    headers[name] = header.slice(at + 1).trim();
  }
  const env: Record<string, string> = {};
  for (const pair of values.env ?? []) {
    const at = pair.indexOf("=");
    const name = pair.slice(0, Math.max(at, 0));
    if (at === -1 || !ENV_NAME.test(name)) return fail("--env must be NAME=value");
    env[name] = pair.slice(at + 1);
  }
  if (target.kind === "http" && (values.env !== undefined || values.cwd !== undefined)) {
    return fail("--env and --cwd are for a server's command, not a URL");
  }
  if (target.kind === "stdio" && values.header !== undefined) {
    return fail("--header is for a URL, not a server's command");
  }
  const timeoutSeconds =
    values.timeout === undefined ? DEFAULT_TIMEOUT_SECONDS : Number(values.timeout);
  if (!(timeoutSeconds > 0 && timeoutSeconds <= 600)) {
    return fail("--timeout must be a number of seconds from 1 to 600");
  }
  return {
    ok: true,
    help: false,
    options: { target, output: values.output, headers, env, cwd: values.cwd, timeoutSeconds },
  };
}

function parseOwn(args: string[]) {
  return parseArgs({
    args,
    allowPositionals: true,
    strict: true,
    options: {
      output: { type: "string", short: "o" },
      header: { type: "string", multiple: true },
      env: { type: "string", multiple: true },
      cwd: { type: "string" },
      timeout: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
}

const fail = (message: string) => ({ ok: false as const, message });

/** Where the tools came from, without secrets: a URL keeps only its origin and path. */
export function describeSource(target: Target): { command: string[] } | { url: string } {
  if (target.kind === "stdio") return { command: [target.command, ...target.args] };
  return { url: `${target.url.origin}${target.url.pathname}` };
}

/** The file `dump` writes: the tools/list as `{"tools": [...]}`, with where and when it came from. */
export function dumpOutput(input: {
  target: Target;
  capturedAt: Date;
  server: unknown;
  instructions: string | undefined;
  tools: unknown[];
}): Record<string, unknown> {
  return {
    source: {
      ...describeSource(input.target),
      capturedAt: input.capturedAt.toISOString(),
      forecall: version,
    },
    server: input.server ?? {},
    ...(input.instructions === undefined ? {} : { instructions: input.instructions }),
    tools: input.tools,
  };
}

/** What forecall.dev would refuse, said before the user pastes the file. */
export function limitWarnings(text: string, tools: number): string[] {
  const warnings: string[] = [];
  if (tools > MAX_TOOLS) {
    warnings.push(`${tools} tools: forecall lint and forecall.dev score up to ${MAX_TOOLS}.`);
  }
  if (Buffer.byteLength(text) > MAX_INPUT_BYTES) {
    warnings.push("The JSON is over 1 MiB: forecall lint and forecall.dev read up to 1 MiB.");
  }
  return warnings;
}

/** Runs `forecall dump` and returns the exit code. */
export async function dump(args: string[], io: Io): Promise<number> {
  const parsed = parseDumpArgs(args);
  if (!parsed.ok) {
    io.stderr(`forecall: ${parsed.message}\n\n${DUMP_HELP}`);
    return EXIT.error;
  }
  if (parsed.help) {
    io.stdout(DUMP_HELP);
    return EXIT.ok;
  }
  const { target, output, headers, env, cwd, timeoutSeconds } = parsed.options;
  const client = new Client({ name: "forecall", version });
  const transport =
    target.kind === "stdio"
      ? new StdioClientTransport({
          command: target.command,
          args: target.args,
          // As in a shell: the server gets this environment, plus --env.
          env: { ...definedOnly(io.env), ...env },
          cwd,
          stderr: "inherit",
        })
      : new StreamableHTTPClientTransport(target.url, { requestInit: { headers } });

  let tools: unknown[];
  try {
    tools = await withTimeout(listAllTools(client, transport), timeoutSeconds);
  } catch (error) {
    io.stderr(`forecall: could not get the tools: ${(error as Error).message}\n`);
    await client.close().catch(() => {});
    return EXIT.error;
  }
  const server = client.getServerVersion();
  const text = `${JSON.stringify(
    dumpOutput({
      target,
      capturedAt: new Date(),
      server,
      instructions: client.getInstructions(),
      tools,
    }),
    null,
    2,
  )}\n`;
  await client.close().catch(() => {});

  const name = server ? `${server.name} ${server.version}` : "the server";
  if (output === undefined) {
    io.stdout(text);
  } else {
    try {
      await writeFile(output, text);
    } catch (error) {
      io.stderr(`forecall: could not write ${output}: ${(error as Error).message}\n`);
      return EXIT.error;
    }
  }
  io.stderr(`${tools.length} tools from ${name}${output === undefined ? "" : ` in ${output}`}\n`);
  for (const warning of limitWarnings(text, tools.length)) io.stderr(`Note: ${warning}\n`);
  return EXIT.ok;
}

/** Connects and reads every page of tools/list. */
async function listAllTools(
  client: Client,
  transport: StdioClientTransport | StreamableHTTPClientTransport,
): Promise<unknown[]> {
  await client.connect(transport);
  const tools: unknown[] = [];
  let cursor: string | undefined;
  do {
    const page = await client.listTools(cursor === undefined ? undefined : { cursor });
    tools.push(...page.tools);
    cursor = page.nextCursor;
    // A server that keeps paging is cut off well past what can be scored.
  } while (cursor !== undefined && tools.length <= MAX_TOOLS * 5);
  return tools;
}

function withTimeout<T>(work: Promise<T>, seconds: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`no answer in ${seconds} s`)), seconds * 1000);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

function definedOnly(env: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
}
