# Forecall CLI

The open-source parts of [Forecall](https://forecall.dev): the linter that scores how well an MCP
server's tools are described for the AI agents that read them, and the `forecall` command that runs
it on your machine and connects your AI clients to the Forecall Failure KB.

| Package | npm | What it is |
|---|---|---|
| [`packages/cli`](packages/cli) | [`forecall`](https://www.npmjs.com/package/forecall) | The command: `lint`, `dump`, `setup` and `hook` |
| [`packages/lint`](packages/lint) | [`@forecall/lint`](https://www.npmjs.com/package/@forecall/lint) | The scoring, with no dependencies and no network |

```sh
npx forecall lint tools.json
```

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
