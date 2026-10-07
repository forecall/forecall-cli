# @forecall/lint

Scores how well the tools of an MCP server are described for the AI agents that read them: each
tool out of 100 on its purpose, when to use it, its arguments, its return value, its constraints
and examples, and the server as a whole (too many tools, tools easy to mix up, shared
descriptions). It is the linter behind [forecall.dev](https://forecall.dev/en/lint) and the
[`forecall`](https://www.npmjs.com/package/forecall) command, and runs anywhere JavaScript does,
with no dependencies and no network.

```sh
npm install @forecall/lint
```

```js
import { readFile } from "node:fs/promises";
import { lintToolsList } from "@forecall/lint";

const result = lintToolsList(await readFile("tools.json", "utf8"));
if (result.ok) {
  console.log(result.report.scoreAvg);
  for (const tool of result.report.tools) console.log(tool.name, tool.score, tool.issues);
} else {
  console.error(result.error.code);
}
```

## API

- `lintToolsList(text)`: reads a tools/list in any accepted shape (an array of tools,
  `{ "tools": [...] }`, or a JSON-RPC `{ "result": { "tools": [...] } }`) and scores it. Returns
  `{ ok: true, report }`, or `{ ok: false, error }` when the text cannot be read.
- `parseToolsList(text)`: the reading alone. Returns `{ ok: true, tools }` or `{ ok: false, error }`.
- `LINT_VERSION`: the version of the scoring rules. Compare scores only within one version.
- The types: `Tool`, `LintReport`, `ToolScore`, `ToolIssue`, `ServerIssue`, `ToolsListError` and
  the others the functions use.

These follow semver. What every issue code means is at
[forecall.dev/en/docs/reading-scores](https://forecall.dev/en/docs/reading-scores).

`@forecall/lint/internal/*` is for Forecall's own apps. It may change in any version, minor or
patch: do not depend on it.

## Source and issues

The source is at [github.com/forecall/forecall-cli](https://github.com/forecall/forecall-cli)
(`packages/lint`). Report bugs in its [issues](https://github.com/forecall/forecall-cli/issues),
and vulnerabilities as its `SECURITY.md` says. Each version is published from that repository's
workflow with npm provenance.

## License

Apache-2.0. Copyright 2026 Mirai Studio, Inc.
