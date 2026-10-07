# Security

## Reporting a vulnerability

Report it privately through GitHub: open this repository's **Security** tab and choose
**Report a vulnerability**
([github.com/forecall/forecall-cli/security/advisories/new](https://github.com/forecall/forecall-cli/security/advisories/new)).
Do not open a public issue or pull request for it.

Please include what is affected (the package and its version), how to reproduce it, and what an
attacker could do with it. We will reply in the report, keep you updated while we fix it, and
credit you in the advisory unless you prefer otherwise.

Vulnerabilities in the Forecall service (forecall.dev, app.forecall.dev, api.forecall.dev and
mcp.forecall.dev) can be reported the same way.

## Supported versions

Fixes go into the latest version of `forecall` and of `@forecall/lint` on npm. Update to it.

## What runs on your machine

- `forecall lint` reads the file you give it and never connects to the network.
- `forecall dump` connects only to the server you name.
- `forecall setup` changes only Forecall's own entries in your AI clients' files (the MCP server,
  the instructions and the hooks), and `forecall setup --remove` takes them out again.
- `forecall hook --sensor`, which `forecall setup --sensor` adds only when asked, redacts each MCP
  tool result on your machine and sends its head, with the shape (never the values) of the
  arguments, to the Forecall server your configuration names.

Every version on npm is published from this repository's Release workflow with npm provenance, so
you can check which commit built it.
