# Contributing

Thank you for helping. Issues and pull requests are welcome in English or Japanese.

## Issues

- For a wrong score or issue, include the tools/list (or the smallest part of it that shows the
  problem), the output of `forecall --version`, and what you expected.
- Never paste API keys, tokens or other secrets. `forecall dump` keeps the URL's query and the
  headers out of its output, but check what you share.
- For a vulnerability, do not open an issue: see [SECURITY.md](SECURITY.md).

## Pull requests

1. Keep each pull request to one change, and say why it is needed.
2. Add or update tests with the change.
3. Run `pnpm check` (Biome, the type checks and the tests) before you push. CI runs the same, and
   also packs both packages and tries them on Node.js 22 and 24.
4. Write the title as a [Conventional Commit](https://www.conventionalcommits.org/), such as
   `fix(lint): ...` or `feat(cli): ...`. Pull requests are squash-merged into `main`.
5. Leave the packages' versions to the maintainers: a version raised on `main` starts a release.

### Changing the scoring rules

A change to the patterns, the word lists, the thresholds or the rounding changes scores for everyone
who uses Forecall. Open an issue first to agree on it. The pull request then raises `LINT_VERSION`
in `packages/lint/lint.ts` and updates the expected results in `packages/lint/fixtures/cases.json`.

## License of contributions

This repository is under the Apache License 2.0. As its section 5 says, a contribution you submit
for inclusion is under the same license, with no additional terms. There is no separate contributor
agreement to sign.
