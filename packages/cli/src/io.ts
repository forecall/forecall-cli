// What the commands read and write, and their exit codes. Shared by `lint`
// and `dump`, which are bundled apart (build.ts), so it stays free of anything else.

/** What a command reads and writes, so tests can pass their own. */
export interface Io {
  stdin: AsyncIterable<Uint8Array>;
  stdout(text: string): void;
  stderr(text: string): void;
  /** Whether stdout is a terminal (for colors). */
  isTTY: boolean;
  env: Record<string, string | undefined>;
}

/** Exit codes: done; a gate of lint failed (--fail-under, --min-tool-score, --fail-on); could not do it. */
export const EXIT = { ok: 0, belowThreshold: 1, error: 2 } as const;
