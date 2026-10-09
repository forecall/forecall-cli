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

- 0.8.0 (2026-10-09, forecall-cli#18): `lint` also reads a list of entries that is not a
  tools/list, such as what a search tool returns or a list of endpoints, and scores it as
  entries (see `@forecall/lint` 0.4.0). Rules stay v2.
- 0.7.0 (2026-10-09): with `@forecall/lint` 0.3.0, `--fail-on major` no longer trips on
  near-identical descriptions (now minor), and the report shows the two new findings.
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

- 0.4.0 (2026-10-09, forecall-cli#18): `parseToolsList` and `readToolsList` also read a list of
  entries that is not a tools/list (`{"entries" | "results" | "items" | "endpoints": [...]}`, or
  a bare array whose elements are entries): each entry is named by its `name`, `operationId`,
  `id`, `title` or `path` (with its `method` in front), described by its `description`,
  `summary`, `text` or `snippet`, and given its arguments from a schema object or an
  OpenAPI-style `parameters` array; names made the same get `_2`, `_3`, …. The result says
  `shape: "entries"`. The entries are scored exactly as tools with that text would be, so the
  rules stay v2. Asked for on dev.to: scoring the candidates an agent picks from at run time
  (forecall/forecall#466).
- 0.3.0 (2026-10-09, forecall-cli#16): from the calibration of 2026-10-09 (forecall/forecall#448:
  868 one-step cases on nine servers, two models), where no ambiguous case went to the pair's
  other tool and 72% of the misses were a lookup first.
  - `confusable_pair` and `confusable_pair_total` are minor, not major: models tell such pairs
    apart by their names and schemas; the finding is about the text.
  - New `deprecated` (minor): the description says the tool is deprecated. Models rightly avoid
    such a tool, so name the replacement and consider removing it.
  - New `id_source_missing` (minor): a required argument named like an identifier (`id`,
    `page_id`, `libraryId`, `uid`, `ref`, `parent`, a cursor) whose description, or the tool's,
    does not say where the value comes from ("from the snapshot", "returned by …", "call
    list_pages", "retrieved from 'resolve-library-id'"). Without it, models look the id up first.
  - No score moves, so the rules stay v2; the research servers' scores are unchanged.
- 0.2.1 (2026-10-09): the `confusable_pair` and `confusable_pair_total` sentences say the
  descriptions are nearly the same and only the names and schemas differ, instead of "easy to
  mix up". Wording only; the code and the rules (v2) are unchanged.
- 0.2.0 (2026-10-09): scoring rules v2; `parseToolsList` returns the dump's `handshake`;
  `lintTools` takes `{ handshake }`; `Handshake` and `LintOptions` types.
- 0.1.2 (2026-10-08): the `confusable_pair` sentence. 0.1.1: plural forms in the English
  sentences.
- 0.1.0 (2026-10-08): first version published from this repository.
