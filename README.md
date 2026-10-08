# Forecall CLI

The open-source parts of [Forecall](https://forecall.dev): the linter that scores how well an MCP
server's tools are described for the AI agents that read them, and the `forecall` command that runs
it on your machine and connects your AI clients to the Forecall Failure KB.

```sh
npx forecall lint tools.json
```

```text
Forecall lint · tools.json
Scoring rules v1

Average score     42.5 / 100
Tools             2
Confusable pairs  0

Across the server
  No server-wide issues.

Tools

  6 / 100  search
    Purpose 6/20 · When to use 0/20 · Arguments 0/25 · Return value 0/15 · Constraints and side effects 0/10 · Examples 0/10
    Major     restates_name         The description only restates the name (2 words).
    Major     too_short             The description is too short (2 words).
    Major     no_usage_context      Says nothing about when to use it, or when not to.
    Major     param_no_description  Arguments without a description: q.
    Minor     loose_string_param    String arguments with no constraint or example: q.
    Minor     no_required           No `required` list, so every argument is optional.
    Minor     no_return_info        Says nothing about what it returns.
    Minor     no_constraints        No constraints, side effects, auth or rate limits described, and no annotations.

  79 / 100  get_forecast
    Purpose 17/20 · When to use 20/20 · Arguments 18/25 · Return value 7/15 · Constraints and side effects 7/10 · Examples 10/10
    No issues.
```

<details>
<summary>The <code>tools.json</code> above</summary>

```json
{
  "tools": [
    {
      "name": "search",
      "description": "Search records.",
      "inputSchema": { "type": "object", "properties": { "q": { "type": "string" } } }
    },
    {
      "name": "get_forecast",
      "description": "Returns the weather forecast for a city for the next 7 days, with the high and low temperature in Celsius for each day. Use it when the user asks about upcoming weather; for the current conditions, use get_current_weather instead. Example: city \"Tokyo\", days 3.",
      "inputSchema": {
        "type": "object",
        "properties": {
          "city": { "type": "string", "description": "The city's name, such as Tokyo." },
          "days": { "type": "integer", "minimum": 1, "maximum": 7, "description": "How many days to return, 1 to 7." }
        },
        "required": ["city"]
      },
      "annotations": { "readOnlyHint": true }
    }
  ]
}
```

</details>

Each tool is scored out of 100 on six parts, and the server as a whole is checked for too many
tools, tools easy to mix up and shared descriptions. Nothing leaves your machine. `--json` prints
the report as JSON, and `--fail-under <n>` fails a CI job when the average is below `n`. Get the
JSON from your own server with `npx forecall dump`, or paste it at
[forecall.dev/en/lint](https://forecall.dev/en/lint) for a page you can share.

| Package | npm | What it is |
|---|---|---|
| [`packages/cli`](packages/cli) | [`forecall`](https://www.npmjs.com/package/forecall) | The command: `lint`, `dump`, `setup` and `hook` |
| [`packages/lint`](packages/lint) | [`@forecall/lint`](https://www.npmjs.com/package/@forecall/lint) | The scoring, with no dependencies and no network |

How to use them: [forecall.dev/en/docs/cli](https://forecall.dev/en/docs/cli) and each package's
README. The Forecall service itself (the website, the dashboard, the API and the Failure KB's
server) is not in this repository.

## Development

The versions of Node.js and pnpm are in `mise.toml`.

```sh
mise install
pnpm install
pnpm check       # Biome, the type checks and the tests of both packages
```

- `pnpm format` formats and fixes what Biome can.
- `pnpm --filter forecall build` writes the command to `packages/cli/dist/forecall.js`; run it
  with `node packages/cli/dist/forecall.js lint <file>`.
- `node packages/lint/pack.ts <dir>` and `node packages/cli/pack.ts <dir>` make the tarballs npm
  would get, and `scripts/try-package.sh <lint|cli> <tarball>` installs one and runs it.
- `LINT_VERSION` in `packages/lint/lint.ts` is the version of the scoring rules. Any change that
  can give some input a different score, component, issue code or severity raises it, and updates
  the expected results in `packages/lint/fixtures/cases.json`.

## Releases

A pull request that raises a package's version starts the Release workflow when it lands on
`main`. The workflow stages every version npm does not have yet (`@forecall/lint` first) with
provenance, and each goes live only when a maintainer approves it on npm with 2FA. Maintainers can
also run the workflow by hand on `main` and pick one package.

## Contributing and security

See [CONTRIBUTING.md](CONTRIBUTING.md). Report vulnerabilities privately, as
[SECURITY.md](SECURITY.md) says, not in a public issue.

## License

Apache-2.0. Copyright 2026 Mirai Studio, Inc. See [LICENSE](LICENSE).
