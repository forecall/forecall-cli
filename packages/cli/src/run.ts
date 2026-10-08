// `forecall <command>`: argument parsing, output and exit codes. Nothing here talks to the
// network. `dump` and the sensor (`hook --sensor`) do, and are loaded only when they run;
// bundle.test.ts checks what `lint` loads.
import { parseArgs } from "node:util";
import { LINT_VERSION, lintTools } from "@forecall/lint/internal/lint";
import { version } from "../package.json";
import { formatInputError, formatReport, style } from "./format";
import { failedGates, isSeverity, SEVERITIES } from "./gates";
import { DEFAULT_LANG, isLang, LANGS, t } from "./i18n";
import { readInput } from "./input";
import { EXIT, type Io } from "./io";

export { EXIT, type Io };

export const HELP = `Usage: forecall <command> [options]

Commands:
  lint <file>      Score the tool descriptions in an MCP tools/list JSON file, on this
                   machine. Nothing is sent anywhere. Use - to read standard input.
  dump <server>    Ask an MCP server for its tools/list and print it as JSON for lint and
                   forecall.dev. Starts the server you name, or connects to the URL you give.
  setup            Connect your AI clients (Claude Code, Claude Desktop, Cursor, Codex, Gemini
                   CLI, Windsurf) to the Forecall Failure KB. --remove takes it out again.
  hook             Claude Code's PostToolUse hook, which setup can add: suggests a kb_lookup
                   when an MCP tool fails. Reads the event on standard input, sends nothing.
                   With --sensor (setup --sensor adds it), sends the tool's result, redacted
                   on this machine, to the Failure KB instead, and prints nothing.

Options:
  -h, --help       Show this help
  -v, --version    Show the version and the scoring rules version

Run "forecall lint --help", "forecall dump --help" or "forecall setup --help" for the options of
each command.
`;

export const LINT_HELP = `Usage: forecall lint <file> [options]

Scores the tool descriptions in an MCP tools/list result, on this machine. Nothing is sent
anywhere. <file> holds an array of tools, {"tools": [...]}, or a JSON-RPC response
{"result": {"tools": [...]}}, up to 1 MiB and 200 tools. Use - to read standard input. A file
written by "forecall dump" also carries the server's instructions, which are checked too.

Options:
  --json                Print the report as JSON (the same report the web app stores)
  --fail-under <n>      Exit with 1 when the average score is below n (0 to 100)
  --min-tool-score <n>  Exit with 1 when any tool scores below n (0 to 100)
  --fail-on <severity>  Exit with 1 on any issue at this severity or worse: critical, major or
                        minor
  --lang <en|ja>        Language of the report (default: en)
  -h, --help            Show this help

Exit codes: 0 scored, 1 a gate above failed (named on standard error), 2 could not score.
`;

/** Runs the command line `argv` (without node and the script) and returns the exit code. */
export async function run(argv: string[], io: Io): Promise<number> {
  const [command, ...rest] = argv;
  if (command === undefined || command === "-h" || command === "--help" || command === "help") {
    io.stdout(HELP);
    return EXIT.ok;
  }
  if (command === "-v" || command === "--version") {
    io.stdout(`forecall ${version} (scoring rules v${LINT_VERSION})\n`);
    return EXIT.ok;
  }
  if (command === "dump") {
    // The MCP client (and its network and process APIs) is in a chunk of its own (build.ts).
    const { dump } = await import("./dump");
    return dump(rest, io);
  }
  if (command === "setup") {
    // Bundled apart, like dump (build.ts): loaded only for this command.
    const { setup } = await import("./setup");
    return setup(rest, io);
  }
  if (command === "hook") {
    if (rest.includes("--sensor")) {
      // The one hook that sends: bundled apart, like dump (build.ts).
      const { sensor } = await import("./sensor");
      return sensor(io);
    }
    const { hook } = await import("./hook");
    return hook(io);
  }
  if (command !== "lint") return usage(io, `unknown command "${command}"`, HELP);
  return lint(rest, io);
}

function usage(io: Io, message: string, help: string): number {
  io.stderr(`forecall: ${message}\n\n${help}`);
  return EXIT.error;
}

async function lint(args: string[], io: Io): Promise<number> {
  let parsed: ReturnType<typeof parseLintArgs>;
  try {
    parsed = parseLintArgs(args);
  } catch (error) {
    return usage(io, (error as Error).message, LINT_HELP);
  }
  const { values, positionals } = parsed;
  if (values.help) {
    io.stdout(LINT_HELP);
    return EXIT.ok;
  }
  if (positionals.length !== 1) {
    const message = positionals.length === 0 ? "missing <file>" : "give only one <file>";
    return usage(io, message, LINT_HELP);
  }
  const lang = values.lang ?? DEFAULT_LANG;
  if (!isLang(lang)) return usage(io, `--lang must be one of ${LANGS.join(", ")}`, LINT_HELP);
  const failUnder = score(values["fail-under"]);
  if (Number.isNaN(failUnder)) {
    return usage(io, "--fail-under must be a number from 0 to 100", LINT_HELP);
  }
  const minToolScore = score(values["min-tool-score"]);
  if (Number.isNaN(minToolScore)) {
    return usage(io, "--min-tool-score must be a number from 0 to 100", LINT_HELP);
  }
  const failOn = values["fail-on"];
  if (failOn !== undefined && !isSeverity(failOn)) {
    return usage(io, `--fail-on must be one of ${SEVERITIES.join(", ")}`, LINT_HELP);
  }

  const source = positionals[0] as string;
  const input = await readInput(source, io.stdin);
  if (!input.ok) {
    if (values.json) io.stdout(`${JSON.stringify({ error: input.error }, null, 2)}\n`);
    else io.stderr(formatInputError(input.error, lang));
    return EXIT.error;
  }

  const report = lintTools(input.tools, { handshake: input.handshake });
  if (values.json) {
    io.stdout(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    const s = style(io.isTTY, io.env.NO_COLOR);
    io.stdout(formatReport(report, { lang, source, style: s }));
  }
  // A bare tools/list says nothing about the server's instructions, so neither does the report;
  // a dump would. Said on standard error, so that --json's standard output stays the report alone.
  if (input.handshake === undefined) io.stderr(`forecall: ${t(lang, "cli.note.noInstructions")}\n`);
  const failed = failedGates(report, { failUnder, minToolScore, failOn }, lang);
  for (const sentence of failed) io.stderr(`forecall: ${sentence}\n`);
  return failed.length > 0 ? EXIT.belowThreshold : EXIT.ok;
}

/** A score option's value: undefined when not given, NaN when it is not from 0 to 100. */
function score(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  return value.trim() !== "" && n >= 0 && n <= 100 ? n : Number.NaN;
}

function parseLintArgs(args: string[]) {
  return parseArgs({
    args,
    allowPositionals: true,
    strict: true,
    options: {
      json: { type: "boolean" },
      "fail-under": { type: "string" },
      "min-tool-score": { type: "string" },
      "fail-on": { type: "string" },
      lang: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
}
