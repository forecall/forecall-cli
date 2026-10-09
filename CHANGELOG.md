# Changelog

What changed in each version of the scoring rules and of the two packages. Scores are comparable
only within one version of the rules; every report and `forecall --version` show which.

## Scoring rules

### v2 — 2026-10-09 (`@forecall/lint` 0.2.0, `forecall` 0.6.0)

- **A note repeated in most tools no longer counts for each of them.** When the same sentences
  (20 words or more) appear in at least three tools and at least half of them, they are taken
  out of every description before the tool is scored and before descriptions are compared, and
  the server gets one `repeated_note` (major) instead. Before, such a note earned "when to use"
  and "constraints" points in every tool it was pasted into, and made the tools look alike:
  PubMed's seven tools, each carrying the same 1,000-character scope notice, had 21 confusable
  pairs and usage-context points from the notice alone. Scored on what each tool says itself,
  their average goes from 65.3 to 51.7 and the pairs from 21 to 1, with or without the notice.
  (The pair left is two tools that share an attribution paragraph only they carry: below the
  threshold, so it stays, and they are rightly alike.) MCP's specification says the server's
  `instructions` should not duplicate the tool descriptions: that is where such a note belongs,
  once.
- Tools whose own text is short after the note is taken out get `too_short` or `restates_name`,
  as they would without the note.
- Nothing changes for a server without such a note. The eight research servers the rules were
  calibrated on score the same under v1 and v2.
- **The server's `instructions` are read** when the input carries them (a `forecall dump` file).
  Two new server issues: `instructions_missing` (minor) when the server has none, and
  `instructions_long` (minor) when they are over 2,048 characters, which is how much Claude Code
  passes to its model by default (Codex CLI 0.154.0 passes them whole, measured 2026-10-09).
  A bare tools/list says nothing about the instructions, so neither does the report.
- Adding or rewording an issue code alone does not change the rules' version; a change that can
  move a score does.

### v1 — 2026-10-02 (`@forecall/lint` 0.1.0 to 0.1.2, `forecall` 0.1.0 to 0.5.0)

- The Python prototype's table from Forecall's research, ported exactly: six components (purpose
  20, when to use 20, arguments 25, return value 15, constraints and side effects 10, examples
  10), 21 issue codes, confusable pairs by the Jaccard similarity of the descriptions' words.

## `forecall`

- 0.6.1 (2026-10-09): the summary's "Confusable pairs" line is "Near-identical descriptions",
  and the note on what static scoring cannot tell says the score reads what is written, not
  what a model will do: measured on 2026-10-09, current models chose the right tool in one step
  from one-line descriptions and between near-identical pairs when names and schemas differed.
  Wording only; rules stay v2.
- 0.6.0 (2026-10-09): scoring rules v2; `lint` reads the server's instructions from a dump and
  says on standard error when a bare tools/list carries none.
- 0.5.0 (2026-10-08): `--min-tool-score <n>` and `--fail-on <severity>` gates; each failed gate
  is named on standard error.
- 0.4.2 (2026-10-08): the `confusable_pair` finding says to point each description at the other
  tool. 0.4.1: "1 word", not "1 words".
- 0.4.0 (2026-10-08): `forecall setup` connects Claude Desktop through `forecall-mcp`.
- 0.3.2 (2026-10-08): first version published from this repository, with npm provenance.

## `@forecall/lint`

- 0.2.1 (2026-10-09): the `confusable_pair` and `confusable_pair_total` sentences say the
  descriptions are nearly the same and only the names and schemas differ, instead of "easy to
  mix up". Wording only; the code and the rules (v2) are unchanged.
- 0.2.0 (2026-10-09): scoring rules v2; `parseToolsList` returns the dump's `handshake`;
  `lintTools` takes `{ handshake }`; `Handshake` and `LintOptions` types.
- 0.1.2 (2026-10-08): the `confusable_pair` sentence. 0.1.1: plural forms in the English
  sentences.
- 0.1.0 (2026-10-08): first version published from this repository.
