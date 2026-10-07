// `forecall setup --help`, apart from setup.ts so that it can be read without the setup code
// (forecall.dev's docs are checked against it).

export const SETUP_HELP = `Usage: forecall setup [options]
       forecall setup --remove [options]

Connects your AI clients to the Forecall Failure KB (https://mcp.forecall.dev/mcp): adds the
MCP server to each client it finds, puts the KB's instructions into each client's global
instructions file between <!-- forecall:start --> and <!-- forecall:end -->, and, for Claude
Code, can add a PostToolUse hook that suggests a kb_lookup when an MCP tool fails. Runs again
without changing anything; --remove takes all of it out.

Clients: claude-code (~/.claude.json, ~/.claude/CLAUDE.md, ~/.claude/settings.json),
claude-desktop (claude_desktop_config.json, through mcp-remote), cursor (~/.cursor/mcp.json),
codex (~/.codex/config.toml, ~/.codex/AGENTS.md), gemini (~/.gemini/settings.json,
~/.gemini/GEMINI.md), windsurf (~/.codeium/windsurf/mcp_config.json, memories/global_rules.md).

Options:
  --key <fc_agent_...>   Your agent API key (app.forecall.dev/api-keys). Without it, setup
                         opens that page and asks you to paste the key. The key is written
                         into the clients' own files only
  --client <name>        Configure this client even if it is not found. Repeatable
  --hook / --no-hook     Add, or do not add, the Claude Code hook (asked when omitted)
  --sensor               Also add the sensor, a background Claude Code hook that sends each
                         MCP tool's result, redacted on this machine and cut to 2,000
                         characters, to the Failure KB. Never added without this option.
                         With --remove, takes out only the sensor
  --remove               Take the server, the instructions and the hooks out of every client
  --dry-run              Show what would change and change nothing
  -h, --help             Show this help

Without a terminal (CI, a pipe) and without --key, setup prints what to do and exits with 0.

Exit codes: 0 done (or nothing to do), 2 could not read or write a client's file.
`;
