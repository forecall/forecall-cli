// `forecall dump --help`, apart from dump.ts so that it can be read without the MCP client
// (forecall.dev's docs are checked against it).

export const DUMP_HELP = `Usage: forecall dump [options] <url>
       forecall dump [options] -- <command> [args...]

Asks an MCP server for its tools/list and prints the result as JSON that "forecall lint" and
forecall.dev accept. This is the only command that talks to the network: it starts the server
you name, or connects to the URL you give.

  <url>                   A Streamable HTTP server (https:// or http://)
  -- <command> [args...]  A stdio server: the command that starts it, after --

Options:
  -o, --output <file>     Write the JSON to <file> instead of standard output
  --header "Name: value"  (URL) Send this request header, e.g. Authorization. Repeatable
  --env NAME=value        (command) Set this environment variable for the server, on top of
                          this shell's environment. Repeatable
  --cwd <dir>             (command) Start the server in <dir>
  --timeout <seconds>     Give up after this many seconds (default: 60)
  -h, --help              Show this help

The JSON records where the tools came from (the command, or the URL without its query) and
when. It never records headers or environment values.

Exit codes: 0 written, 2 could not get the tools.
`;
