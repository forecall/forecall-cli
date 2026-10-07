# forecall

Score the tool descriptions of your MCP server on your own machine, before an AI agent has to
guess what they mean.

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

Keys must use the MCP wire format (`inputSchema`, `annotations.readOnlyHint`). snake_case keys
such as `input_schema`, which some SDKs write out, are reported rather than converted.

Use `-` to read standard input:

```sh
cat tools.json | npx forecall lint -
```

## Options

| Option | Meaning |
|---|---|
| `--json` | Print the report as JSON, the same report the web app stores |
| `--fail-under <n>` | Exit with 1 when the average score is below `n` (0 to 100) |
| `--lang <en\|ja>` | Language of the report (default: `en`) |
| `-h`, `--help` | Show the help |
| `-v`, `--version` | Show the version and the version of the scoring rules |

Results are comparable only within the same version of the scoring rules, which every report
shows.

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
| `claude-desktop` | `claude_desktop_config.json` (macOS: `~/Library/Application Support/Claude/`, Windows: `%APPDATA%\Claude\`), as a stdio entry that runs `npx -y mcp-remote` to the HTTP server | none (the app has no global file) |
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
| 0 | Scored (and, with `--fail-under`, the average is at least `n`); for `dump`, wrote the JSON |
| 1 | The average score is below `--fail-under` |
| 2 | Could not score: a wrong option, a missing or unreadable file, or invalid input; for `dump`, could not get the tools |

Issues alone do not fail the command. To stop a CI job on low scores, set `--fail-under`:

```sh
npx forecall@0.1 lint tools.json --fail-under 60
```

## What static scoring cannot tell

The score reads only the text of each description and schema. Short tools whose names already
say what they do, such as `browser_close`, score low here even when models use them well.

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
