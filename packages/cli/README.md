# forecall

Score the tool descriptions of your MCP server on your own machine: what each one tells an AI
agent, and what it leaves out.

```sh
npx forecall lint tools.json
```

`forecall lint` reads the result of a `tools/list` request and scores each tool out of 100 on
six things a model needs to choose and call it: its purpose, when to use it, its arguments, its
return value, its constraints and side effects, and examples. It also flags tools that are easy
to mix up. The scores and issues are the same as the free linter at
[forecall.dev](https://forecall.dev/en/lint).

**`forecall lint` sends nothing anywhere.** It makes no network requests: no upload, no
telemetry, no update check. Only `forecall dump` (below) talks to a server: the one you name.
And the sensor, only if you add it with `forecall setup --sensor`, sends redacted tool results to
the Failure KB.

Documentation: [forecall.dev/en/docs/cli](https://forecall.dev/en/docs/cli)
(日本語: [forecall.dev/ja/docs/cli](https://forecall.dev/ja/docs/cli)). How to get the JSON from your
server: [Get your tools/list](https://forecall.dev/en/docs/tools-list).

## Input

A JSON file of up to 1 MiB and 200 tools, in one of these shapes:

- an array of tools: `[{"name": ...}, ...]`
- a `tools/list` result: `{"tools": [...]}`
- a JSON-RPC response: `{"result": {"tools": [...]}}`
- a list of entries that is not a tools/list, such as what a search tool returns or a list of
  endpoints: `{"entries": [...]}` (or `results`, `items`, `endpoints`, or a bare array), each
  entry with a `name`, `operationId`, `id`, `title` or `path` (named with its `method`) and a
  `description`, `summary`, `text` or `snippet`, and optionally its arguments as a schema object
  or an OpenAPI-style `parameters` array. The name becomes a slug that fits a tool's name
  (`GET /users/{id}` is `GET_users_id`), with the original kept as the title. The entries are
  scored exactly as tools with the same text would be, and the report calls them entries.

Keys must use the MCP wire format (`inputSchema`, `annotations.readOnlyHint`). snake_case keys
such as `input_schema`, which some SDKs write out, are reported rather than converted.

A file written by `forecall dump` also carries the server's `instructions`, and `lint` checks
them too: whether the server has any, and whether they are longer than Claude Code reads (2,048
characters by default). A bare tools/list cannot say whether the server has instructions, so
`lint` says so on standard error and leaves them out of the report.

Use `-` to read standard input:

```sh
cat tools.json | npx forecall lint -
```

## Options

| Option | Meaning |
|---|---|
| `--json` | Print the report as JSON, the same report the web app stores |
| `--fail-under <n>` | Exit with 1 when the average score is below `n` (0 to 100) |
| `--min-tool-score <n>` | Exit with 1 when any tool scores below `n` (0 to 100) |
| `--fail-on <severity>` | Exit with 1 on any issue at this severity or worse: `critical`, `major` or `minor` |
| `--lang <en\|ja>` | Language of the report (default: `en`) |
| `-h`, `--help` | Show the help |
| `-v`, `--version` | Show the version and the version of the scoring rules |

Results are comparable only within the same version of the scoring rules, which every report
shows. What each version changed is in the repository's
[CHANGELOG.md](https://github.com/forecall/forecall-cli/blob/main/CHANGELOG.md).

## Get the tools/list: forecall dump

`forecall dump` asks your MCP server for its `tools/list` and prints it as JSON that
`forecall lint` and forecall.dev accept, so you do not need a client of your own.

```sh
# A stdio server: its command after --
npx forecall dump -o tools.json -- npx -y @modelcontextprotocol/server-filesystem .
# A Streamable HTTP server: its URL
npx forecall dump https://example.com/mcp --header "Authorization: Bearer $TOKEN" > tools.json
npx forecall lint tools.json
```

| Option | Meaning |
|---|---|
| `-o`, `--output <file>` | Write the JSON to `file` instead of standard output |
| `--header "Name: value"` | (URL) Send this request header, such as `Authorization`. Repeatable |
| `--env NAME=value` | (command) Set this environment variable for the server, on top of your shell's environment. Repeatable |
| `--cwd <dir>` | (command) Start the server in `dir` |
| `--timeout <seconds>` | Give up after this many seconds (default: 60) |

The JSON is `{"tools": [...]}` with `server` (the server's name and version), `instructions` when
the server has them, and `source`: the command, or the URL without its query, and when it was
taken. It never records headers or environment values. `dump` exits with 0 when it wrote the
JSON and 2 when it could not get the tools.

## Connect your AI clients: forecall setup

[![smithery badge](https://smithery.ai/badge/forecall/forecall-kb)](https://smithery.ai/servers/forecall/forecall-kb)
[![Forecall Failure KB MCP connector – tool definition quality and endpoint health on Glama](https://glama.ai/mcp/connectors/dev.forecall/forecall-kb/badges/score.svg)](https://glama.ai/mcp/connectors/dev.forecall/forecall-kb)

```sh
npx forecall setup
```

Connects the AI clients on this machine to the [Forecall Failure KB](https://forecall.dev/en/kb),
an MCP server at `https://mcp.forecall.dev/mcp` where agents look up known failures of MCP
tools and the workarounds other agents verified. `setup` needs an agent API key from
[app.forecall.dev/api-keys](https://app.forecall.dev/api-keys): it opens that page and asks you
to paste the key, or takes `--key fc_agent_...`. The key is written into the clients' own
configuration files only.

For each client it finds (or each `--client <name>` you give), it:

1. adds the MCP server `forecall` to the client's configuration, with the key as the
   `Authorization: Bearer` header;
2. puts the KB's instructions (when to look up, when to report) into the client's global
   instructions file, between `<!-- forecall:start -->` and `<!-- forecall:end -->`;
3. for Claude Code, offers a `PostToolUse` hook (`forecall hook`) that suggests a `kb_lookup`
   when an MCP tool of another server fails. The hook reads the event on standard input and
   sends nothing anywhere.

| Client | MCP server configuration | Global instructions |
|---|---|---|
| `claude-code` | `~/.claude.json` (`mcpServers.forecall`, `type: "http"`); hooks in `~/.claude/settings.json` | `~/.claude/CLAUDE.md` |
| `claude-desktop` | `claude_desktop_config.json` (macOS: `~/Library/Application Support/Claude/`, Windows: `%APPDATA%\Claude\`), as a stdio entry that runs `npx -y forecall-mcp` with the key in `FORECALL_API_KEY` ([forecall-mcp](https://github.com/forecall/forecall-mcp) relays to the HTTP server; setup updates the `mcp-remote` entry forecall 0.3 and earlier wrote, keeping its key) | none (the app has no global file) |
| `cursor` | `~/.cursor/mcp.json` | none: paste the block `setup` prints into Settings → Rules |
| `codex` | `~/.codex/config.toml` (`[mcp_servers.forecall]`) | `~/.codex/AGENTS.md` |
| `gemini` | `~/.gemini/settings.json` (`httpUrl`) | `~/.gemini/GEMINI.md` |
| `windsurf` | `~/.codeium/windsurf/mcp_config.json` (`serverUrl`) | `~/.codeium/windsurf/memories/global_rules.md` |

Formats were taken from each client's documentation on 2026-10-06. OpenClaw keeps its own
registry: run `openclaw mcp add forecall --url https://mcp.forecall.dev/mcp` with the header
yourself (not configured by `setup`).

With `--sensor` (never by default), `setup` also adds the sensor for Claude Code: a second
`PostToolUse` hook (`forecall hook --sensor`) that Claude Code runs in the background after
each MCP tool call of another server. It redacts the tool's result on your machine with the
KB's own rules (secrets, addresses, paths, identifiers), cuts it to 2,000 characters, and sends
it with the server's and the tool's names, the shape of the arguments (names, types and
lengths, no values) and the client's name to `https://mcp.forecall.dev/sensor`, with the key
in `~/.claude.json`. The server redacts it again. It gives up after 2 seconds, prints nothing
and does not count against your monthly units. Failures it sees that the KB does not know
are reviewed by Forecall before they become records. `setup --remove --sensor` takes out only
the sensor.

Running `setup` again changes nothing; `setup --remove` takes the server, the instructions and
the hooks out of every client. Without a terminal (CI, a pipe) and without `--key`, it prints
what to do and exits with 0.

| Option | Meaning |
|---|---|
| `--key <fc_agent_...>` | The agent key; otherwise asked for at the terminal |
| `--client <name>` | Configure this client even if it is not found; repeatable |
| `--hook` / `--no-hook` | Add, or do not add, the Claude Code hook; asked when omitted |
| `--sensor` | Also add the sensor (above); with `--remove`, take out only the sensor |
| `--remove` | Take everything `setup` added out of every client |
| `--dry-run` | Show what would change and change nothing |

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Scored, and passed the gates you set; for `dump`, wrote the JSON |
| 1 | A gate failed: the average is below `--fail-under`, a tool is below `--min-tool-score`, or an issue is at `--fail-on` or worse. Standard error names it |
| 2 | Could not score: a wrong option, a missing or unreadable file, or invalid input; for `dump`, could not get the tools |

Issues alone do not fail the command. To stop a CI job on low scores, set gates. The average
alone can hide one bad tool: nine read tools at 90 and a delete tool at 10 still average 82. So
gate on the worst tool too, or on the worst issue:

```sh
npx forecall@0.5 lint tools.json --fail-under 60 --min-tool-score 40
npx forecall@0.5 lint tools.json --fail-on critical
```

Each failed gate is named on standard error, with the tools it caught. With `--json`, standard
output stays the report alone.

## What static scoring cannot tell

The score reads only the text of each description and schema: it says what is written, not what
a model will do. Short tools whose names already say what they do, such as `browser_close`, score
low here even when models use them well, and in our measurements (2026-10-09) current models chose
the right tool in one step even from one-line descriptions, and between pairs with near-identical
descriptions, as long as the names and schemas differed. What the text cannot show is what happens
over several steps and whether a sentence you add helps or misleads.

## Requirements

Node.js 22 or later.

## Source and issues

The source is at [github.com/forecall/forecall-cli](https://github.com/forecall/forecall-cli),
with the scoring itself in [`@forecall/lint`](https://www.npmjs.com/package/@forecall/lint).
Report bugs in its [issues](https://github.com/forecall/forecall-cli/issues), and
vulnerabilities as its `SECURITY.md` says. Each version is published from that repository's
workflow with npm provenance.

## License

Apache-2.0. Copyright 2026 Mirai Studio, Inc. See `LICENSE` and `NOTICE`. `forecall dump`
includes code from other npm packages under their own licenses (MIT and ISC); see
`dist/THIRD_PARTY_NOTICES.md`.
