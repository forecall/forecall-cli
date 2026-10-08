// Reading the tools/list to score: a file, or standard input for `-`.
import { createReadStream } from "node:fs";
import type { Handshake, Tool } from "@forecall/lint";
import { parseToolsList, type ToolsListError } from "@forecall/lint";
import { MAX_INPUT_BYTES } from "@forecall/lint/internal/tools-list";

/** Why the input could not be scored: core's errors, plus the ones only a file or a pipe has. */
export type InputError =
  | ToolsListError
  | { code: "empty" }
  | { code: "not_found"; file: string }
  | { code: "unreadable"; file: string; reason: string };

/** The tools, and the server's handshake when the input is a `forecall dump` file. */
export type InputResult =
  | { ok: true; tools: Tool[]; handshake?: Handshake }
  | { ok: false; error: InputError };

/**
 * Reads `source` (a path, or `-` for `stdin`) and parses it as the web does. Stops reading once
 * the input is over the limit, decodes UTF-8 dropping a leading BOM like the browser's
 * `File.text()`, and rejects whitespace-only input like the web form.
 */
export async function readInput(
  source: string,
  stdin: AsyncIterable<Uint8Array>,
): Promise<InputResult> {
  let bytes: Uint8Array | "too_large";
  try {
    bytes = await readLimited(source === "-" ? stdin : createReadStream(source));
  } catch (error) {
    const reason = (error as NodeJS.ErrnoException).code ?? String(error);
    return {
      ok: false,
      error:
        reason === "ENOENT"
          ? { code: "not_found", file: source }
          : { code: "unreadable", file: source, reason },
    };
  }
  if (bytes === "too_large") {
    return { ok: false, error: { code: "input_too_large", limit: MAX_INPUT_BYTES } };
  }
  const text = new TextDecoder().decode(bytes);
  if (text.trim() === "") return { ok: false, error: { code: "empty" } };
  const parsed = parseToolsList(text);
  return parsed.ok ? parsed : { ok: false, error: parsed.error };
}

/** All the bytes, or "too_large" as soon as there are more than MAX_INPUT_BYTES. */
async function readLimited(chunks: AsyncIterable<Uint8Array>): Promise<Uint8Array | "too_large"> {
  const parts: Uint8Array[] = [];
  let length = 0;
  for await (const chunk of chunks) {
    length += chunk.length;
    // Leaving the loop closes a file stream; a pipe's writer may then see EPIPE, which is its own.
    if (length > MAX_INPUT_BYTES) return "too_large";
    parts.push(chunk);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return bytes;
}
