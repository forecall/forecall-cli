// What agents send to the Failure KB is redacted before it is stored:
// secrets, addresses, paths and identifiers become placeholders, and a report says what was
// removed. Pure functions over text: the raw text never leaves the caller, and nothing here logs.

/** What gets removed, each with its placeholder. */
export const REDACTION_KINDS = [
  "secret",
  "token",
  "email",
  "query",
  "id",
  "path",
  "ip",
  "port",
] as const;
export type RedactionKind = (typeof REDACTION_KINDS)[number];

export const PLACEHOLDERS: Record<RedactionKind, string> = {
  secret: "<SECRET>",
  token: "<TOKEN>",
  email: "<EMAIL>",
  query: "<QUERY>",
  id: "<ID>",
  path: "<PATH>",
  ip: "<IP>",
  port: "<PORT>",
};

/** How many of each kind were removed; kinds with none are absent. */
export type RedactionCounts = Partial<Record<RedactionKind, number>>;

/**
 * What `kb_report` returns and the KB keeps with a record: the counts over the error text, the
 * workaround and the notes together, and the share of the workaround's characters that were
 * removed.
 */
export interface RedactionReport {
  kinds: RedactionCounts;
  workaround_ratio: number;
}

export interface Redacted {
  text: string;
  counts: RedactionCounts;
  /** Characters of the input that are not in the output. */
  removed: number;
}

interface Tally {
  counts: RedactionCounts;
  removed: number;
}

function hit(tally: Tally, kind: RedactionKind, removed: number): string {
  tally.counts[kind] = (tally.counts[kind] ?? 0) + 1;
  tally.removed += removed;
  return PLACEHOLDERS[kind];
}

// The value after an HTTP authentication scheme.
const SCHEME_VALUE = /\b(Bearer|Basic)\s+([A-Za-z0-9._~+/=-]{8,})/g;
const JWT = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g;

/**
 * Keys by their published prefixes (prefixes only, no guessing at
 * random-looking strings). Add a vendor's prefix here when a report shows its keys getting through.
 */
export const SECRET_PREFIXES: readonly string[] = [
  "sk-[A-Za-z0-9_-]{16,}", // OpenAI and Anthropic
  "[sr]k_(?:live|test)_[A-Za-z0-9]{8,}", // Stripe
  "whsec_[A-Za-z0-9]{16,}", // Stripe webhook signing
  "gh[pousr]_[A-Za-z0-9]{20,}", // GitHub
  "github_pat_[A-Za-z0-9_]{20,}",
  "xox[abeprs]-[A-Za-z0-9-]{10,}", // Slack
  "(?:AKIA|ASIA)[0-9A-Z]{16}", // AWS
  "AIza[0-9A-Za-z_-]{30,}", // Google
  "npm_[A-Za-z0-9]{30,}",
  "glpat-[A-Za-z0-9_-]{16,}", // GitLab
  "hf_[A-Za-z0-9]{20,}", // Hugging Face
  "ntn_[A-Za-z0-9]{20,}", // Notion
  "SG\\.[A-Za-z0-9_-]{16,}\\.[A-Za-z0-9_-]{16,}", // SendGrid
  "fc_(?:agent|vendor|ci)_[A-Za-z0-9_-]{8,}", // Forecall
];
const SECRET = new RegExp(`\\b(?:${SECRET_PREFIXES.join("|")})`, "g");

// `api_key=…`, `password: "…"`: a value of 8 characters or more with a digit in it, after a
// name that means a secret. Words like `token: expired` have no digit and stay.
const NAMED_SECRET =
  /\b(password|passwd|pwd|secret|token|api[_-]?key|apikey|access[_-]?key|private[_-]?key|client[_-]?secret)(\s*[=:]\s*["']?)((?=[^\s"',;)}\]]*\d)[^\s"',;)}\]]{8,})/gi;

// Not the `<SECRET>@host` a URL's userinfo became: the local part starts where no name does.
const EMAIL = /(?<![\w.%+<-])[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

// A bracketed IPv6 host is the one place a URL has `]` in it: "(see https://x)" ends at `)`.
const HTTP_URL = /\bhttps?:\/\/(?:\[[0-9a-f:.]*\])?[^\s"'<>)\]]*/gi;
const URL_PARTS =
  /^(https?:\/\/)(?:([^/?#@]*)@)?(\[[^\]]*\]|[^/?#:]+)(:\d{1,5})?([^?#]*)(\?[^#]*)?(#.*)?$/;
const IPV4 = /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/;
const IPV4_HOST = new RegExp(`^${IPV4.source}$`);

// File paths. Not every slash-separated name: `/v1/servers` in "POST /v1/servers failed" is a
// route and stays. A path is one under a known root, one ending in a file extension, one from
// `~`, `.` or `..`, or a Windows drive path. A full stop after a path is not part of it.
const WINDOWS_PATH = /\b[A-Za-z]:\\(?:[^\\\s"'<>|?*:]+\\)*[^\\\s"'<>|?*:]*/g;
const ROOTED_PATH =
  /(?<![\w./:@>-])\/(?:Users|home|root|tmp|var|etc|opt|private|mnt|srv|usr|Applications|Library|Volumes|workspace|app|data|proc|dev|run|snap|node_modules)\/(?:[\w.@%+/-]*[\w@%+/-])?/g;
const FILE_PATH =
  /(?<![\w./:@>-])(?:~|\.{1,2})?\/(?:[\w.@%+-]+\/)*[\w.@%+-]+\.[A-Za-z0-9]{1,8}(?!\w|\.\w)/g;
const HOME_PATH = /(?<![\w./:@>-])(?:~|\.{1,2})\/(?:[\w.@%+/-]*[\w@%+/-])?/g;

const IPV6 =
  /(?<![\w:.])(?:(?:[0-9a-f]{1,4}:){7}[0-9a-f]{1,4}|(?:[0-9a-f]{1,4}:){1,7}:(?:[0-9a-f]{1,4}(?::[0-9a-f]{1,4}){0,6})?|::[0-9a-f]{1,4}(?::[0-9a-f]{1,4}){0,6}|(?:[0-9a-f]{1,4}:){3,6}[0-9a-f]{1,4})(?![\w:.])/gi;
const IPV4_PORT = new RegExp(`${IPV4.source}(:\\d{1,5}\\b)?`, "g");

// `host:5432`, `<IP>:5432`, `[<IP>]:5432` and "port 5432". A host's labels start with a letter,
// so `2026-10-06T12:30` is not one; a source file (`index.ts:12`) is not one either.
const HOST_PORT =
  /((?:\b(?:[A-Za-z][A-Za-z0-9-]*\.)*[A-Za-z][A-Za-z0-9-]*)|<IP>|\]):(\d{2,5})(?![\d.:])/g;
const SOURCE_FILE =
  /\.(?:[cm]?[jt]sx?|py|rb|go|rs|java|kt|php|cs|json|ya?ml|toml|md|txt|css|html?|vue|svelte|sql|sh)$/i;
const PORT_WORD = /\b(port)\s+(\d{2,5})\b/gi;

const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
// Stripe's and the like (`cus_…`), and any `abc_` + 20 or more characters with a digit among them.
const PREFIXED_ID =
  /\b(?:cus|ch|pi|pm|seti|sub|in|price|prod|acct|evt|req|txn|cs|bpc|re|tok|card|src|sku|plan)_[A-Za-z0-9]{8,}\b|\b[a-z]{2,5}_(?=[A-Za-z]*\d)[A-Za-z0-9]{20,}\b/g;
const HEX_ID = /\b[0-9a-f]{32,}\b/gi;

/** A URL without a host (`https://?q=1`) is not one and stays as it is. */
function redactUrl(url: string, tally: Tally): string {
  return url.replace(
    URL_PARTS,
    (
      _,
      scheme: string,
      userinfo: string | undefined,
      host: string,
      port: string | undefined,
      path: string,
      query: string | undefined,
      fragment: string | undefined,
    ) => {
      let out = scheme;
      if (userinfo !== undefined) out += `${hit(tally, "secret", userinfo.length)}@`;
      if (host.startsWith("[") && host.endsWith("]")) {
        out += `[${hit(tally, "ip", host.length - 2)}]`;
      } else out += IPV4_HOST.test(host) ? hit(tally, "ip", host.length) : host;
      if (port !== undefined) out += `:${hit(tally, "port", port.length - 1)}`;
      out += path;
      if (query !== undefined) out += `?${hit(tally, "query", query.length - 1)}`;
      return out + (fragment ?? "");
    },
  );
}

/** Redacts one text. The counts and the removed characters are for the report. */
export function redactText(text: string): Redacted {
  const tally: Tally = { counts: {}, removed: 0 };
  const out = text
    .replace(SCHEME_VALUE, (_, scheme: string, value: string) => {
      return `${scheme} ${hit(tally, "token", value.length)}`;
    })
    .replace(JWT, (match) => hit(tally, "secret", match.length))
    .replace(SECRET, (match) => hit(tally, "secret", match.length))
    .replace(NAMED_SECRET, (_, name: string, separator: string, value: string) => {
      return `${name}${separator}${hit(tally, "secret", value.length)}`;
    })
    .replace(HTTP_URL, (match) => redactUrl(match, tally))
    .replace(EMAIL, (match) => hit(tally, "email", match.length))
    .replace(WINDOWS_PATH, (match) => hit(tally, "path", match.length))
    .replace(ROOTED_PATH, (match) => hit(tally, "path", match.length))
    .replace(FILE_PATH, (match) => hit(tally, "path", match.length))
    .replace(HOME_PATH, (match) => hit(tally, "path", match.length))
    .replace(IPV6, (match) => hit(tally, "ip", match.length))
    .replace(IPV4_PORT, (match, port: string | undefined) => {
      const ip = hit(tally, "ip", match.length - (port?.length ?? 0));
      return port === undefined ? ip : `${ip}:${hit(tally, "port", port.length - 1)}`;
    })
    .replace(HOST_PORT, (match, host: string, port: string) => {
      return SOURCE_FILE.test(host) ? match : `${host}:${hit(tally, "port", port.length)}`;
    })
    .replace(
      PORT_WORD,
      (_, word: string, port: string) => `${word} ${hit(tally, "port", port.length)}`,
    )
    .replace(UUID, (match) => hit(tally, "id", match.length))
    .replace(PREFIXED_ID, (match) => hit(tally, "id", match.length))
    .replace(HEX_ID, (match) => hit(tally, "id", match.length));
  return { text: out, counts: tally.counts, removed: tally.removed };
}

// args_shape: the keys, types and lengths of a tool call's arguments, never the values.

export const JSON_TYPES = ["string", "number", "boolean", "null", "array", "object"] as const;
export type JsonType = (typeof JSON_TYPES)[number];

export interface ArgShape {
  type: JsonType;
  /** Characters of a string, items of an array. */
  length?: number;
  /** An object's arguments, to MAX_ARGS_DEPTH. */
  properties?: ArgsShape;
}
export type ArgsShape = Record<string, ArgShape>;

/** Keys kept at each level, and levels kept, of an args_shape. */
export const MAX_ARGS_KEYS = 100;
export const MAX_ARGS_DEPTH = 5;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** An object that already is a shape: a type, and nothing but an optional length and properties. */
function isShape(value: Record<string, unknown>): boolean {
  return (
    JSON_TYPES.includes(value.type as JsonType) &&
    Object.keys(value).every((key) => key === "type" || key === "length" || key === "properties") &&
    (value.length === undefined ||
      (Number.isInteger(value.length) && (value.length as number) >= 0)) &&
    (value.properties === undefined || isRecord(value.properties))
  );
}

function shapeOf(value: unknown, depth: number): ArgShape {
  if (isRecord(value) && isShape(value)) {
    const shape: ArgShape = { type: value.type as JsonType };
    if (typeof value.length === "number") shape.length = value.length;
    if (value.properties !== undefined && depth < MAX_ARGS_DEPTH) {
      shape.properties = shapeOfRecord(value.properties as Record<string, unknown>, depth + 1);
    }
    return shape;
  }
  if (typeof value === "string") return { type: "string", length: Array.from(value).length };
  if (typeof value === "number") return { type: "number" };
  if (typeof value === "boolean") return { type: "boolean" };
  if (Array.isArray(value)) return { type: "array", length: value.length };
  if (isRecord(value)) {
    return depth < MAX_ARGS_DEPTH
      ? { type: "object", properties: shapeOfRecord(value, depth + 1) }
      : { type: "object" };
  }
  return { type: "null" };
}

function shapeOfRecord(record: Record<string, unknown>, depth: number): ArgsShape {
  const shape: ArgsShape = {};
  for (const key of Object.keys(record).slice(0, MAX_ARGS_KEYS))
    shape[key] = shapeOf(record[key], depth);
  return shape;
}

/**
 * The shape of a tool call's arguments: what an agent sent as `args_shape`, whether it already
 * was a shape (then kept, with anything else dropped) or the raw arguments (then each value
 * replaced by its type and length). An argument whose value happens to be a shape, like
 * `{ type: "string" }`, is taken as one: it carries no value either way. Anything that is not an
 * object has no arguments.
 */
export function argsShape(value: unknown): ArgsShape {
  return isRecord(value) ? shapeOfRecord(value, 1) : {};
}

export interface Submission {
  errorText: string;
  workaround: string;
  notes?: string;
  argsShape?: unknown;
}

export interface RedactedSubmission {
  errorText: string;
  workaround: string;
  notes?: string;
  argsShape: ArgsShape;
  report: RedactionReport;
}

/** Redacts a `kb_report` before it is stored: the texts, the args_shape and the report. */
export function redactSubmission(input: Submission): RedactedSubmission {
  const errorText = redactText(input.errorText);
  const workaround = redactText(input.workaround);
  const notes = input.notes === undefined ? undefined : redactText(input.notes);
  const kinds: RedactionCounts = {};
  for (const part of [errorText, workaround, notes]) {
    for (const [kind, count] of Object.entries(part?.counts ?? {})) {
      kinds[kind as RedactionKind] = (kinds[kind as RedactionKind] ?? 0) + count;
    }
  }
  const ratio = input.workaround.length === 0 ? 0 : workaround.removed / input.workaround.length;
  return {
    errorText: errorText.text,
    workaround: workaround.text,
    ...(notes === undefined ? {} : { notes: notes.text }),
    argsShape: argsShape(input.argsShape),
    report: { kinds, workaround_ratio: Math.round(ratio * 1000) / 1000 },
  };
}
