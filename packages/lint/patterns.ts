// The Python prototype's word lists and patterns, copied verbatim as Python raw strings and
// compiled with pyRegex. A change to any of them is a new LINT_VERSION (lint.ts).
import { pyRegex } from "./py-regex.ts";

export const STOP = new Set(
  "a an the to of in on for and or with by from is are be this that it as at into your you".split(
    " ",
  ),
);
export const GENERIC_NAME_TOKENS = new Set([
  "action",
  "call",
  "data",
  "do",
  "execute",
  "get",
  "handle",
  "helper",
  "info",
  "item",
  "items",
  "manage",
  "misc",
  "process",
  "run",
  "set",
  "thing",
  "util",
]);
const VERB_START_SOURCE = String.raw`^(get|list|search|create|update|delete|remove|add|fetch|read|write|send|run|execute|query|find|check|submit|share|open|close|browse|resolve|reply|vote|upvote|navigate|click|type|take|wait|scrape|crawl|extract|map|move|edit|append|insert|retrieve|return|generate|build|start|stop|use|inspect|initiate|post|patch|put|convert|parse|validate|compare|count|download|upload|copy|rename|deprecate|archive|restore|monitor|track|log|record|save|load|store|show|display|render|draw|calculate|compute|summarize|translate|describe|explain|scan|filter|sort|merge|split|join|bulk|batch|cancel|pause|resume|reset|clear|flush|sync|import|export|register|unregister|subscribe|unsubscribe|enable|disable|toggle|switch|configure|install|uninstall|deploy|publish|unpublish|approve|reject|assign|unassign|tag|untag|mark|unmark|pin|unpin|like|unlike|follow|unfollow|block|unblock|mute|unmute|report|flag|hide|unhide|lock|unlock|encrypt|decrypt|sign|verify|hash|encode|decode|compress|decompress|zip|unzip|tar|untar|mount|unmount|format|clean|repair|test|debug|profile|benchmark|measure|estimate|predict|classify|cluster|rank|score|rate|grade|review|audit|comment|annotate|highlight|underline|strike|bold|italic|link|unlink|embed|attach|detach|share|unshare|invite|uninvite|join|leave|kick|ban|unban|promote|demote|elevate|lower|raise|drop|pick|select|deselect|choose|decide|resolve|escalate|delegate|forward|reply|respond|answer|ask|request|require|demand|offer|accept|decline|confirm|deny|allow|permit|grant|revoke|refuse|prevent|avoid|skip|ignore|omit|include|exclude|contain|hold|keep|release|free|allocate|reserve|book|schedule|reschedule|unschedule|plan|organize|arrange|order|reorder|shuffle|randomize|seed|initialize|init|setup|teardown|destroy|kill|terminate|abort|exit|quit|end|finish|complete|succeed|fail|error|warn|notify|alert|remind|announce|broadcast|stream|pipe|redirect|route|dispatch|emit|trigger|fire|invoke|apply|wrap|unwrap|bind|unbind|attach|detach|connect|disconnect|reconnect|login|logout|signin|signout|signup|authenticate|authorize|impersonate|switch|swap|exchange|trade|buy|sell|pay|refund|charge|bill|invoice|quote|price|discount|tax|ship|deliver|receive|accept|reject|return|replace|repair|upgrade|downgrade|migrate|rollback|revert|undo|redo|snapshot|backup|recover|purge|prune|vacuum|compact|optimize|tune|scale|resize|crop|rotate|flip|mirror|blur|sharpen|adjust|enhance|correct|fix|patch|hotfix|bump|tag|release|ship|deliver|hand|give|take|grab|catch|throw|toss|drop|place|put|position|locate|geolocate|geocode|reverse|lookup|resolve|ping|traceroute|dig|whois|nslookup|curl|wget|ssh|scp|rsync|git|diff|merge|rebase|cherry|squash|amend|commit|push|pull|clone|fork|branch|checkout|stash|pop|apply|reset|clean|gc|fsck|blame|bisect|log|show|status|remote|submodule|worktree|notes|reflog|archive|bundle|describe|shortlog|rev|ls|cat|touch|mkdir|rmdir|rm|cp|mv|ln|chmod|chown|chgrp|df|du|free|top|ps|kill|nice|renice|nohup|bg|fg|jobs|wait|sleep|time|date|cal|uptime|w|who|whoami|id|groups|users|last|finger|write|wall|mesg|talk|mail|sendmail|telnet|ftp|sftp|nc|netcat|socat|openssl|gpg|md5sum|sha1sum|sha256sum|base64|xxd|od|hexdump|strings|file|stat|find|locate|which|whereis|type|alias|unalias|history|fc|source|export|env|printenv|set|unset|shift|getopts|read|echo|printf|test|expr|let|bc|dc|awk|sed|grep|egrep|fgrep|cut|paste|tr|sort|uniq|wc|head|tail|tee|xargs|split|csplit|fold|fmt|pr|nl|tac|rev|column|comm|join|diff|cmp|patch|tar|gzip|gunzip|bzip2|bunzip2|xz|unxz|zip|unzip|rar|unrar|7z)\b`;
const CTX_SOURCES = [
  String.raw`\buse (this|it)?\s*(when|if|for|to)\b`,
  String.raw`\bonly (use|when|if)\b`,
  String.raw`\bdo not\b`,
  String.raw`\bdon't\b`,
  String.raw`\bnot for\b`,
  String.raw`\binstead\b`,
  String.raw`\bprefer\b`,
  String.raw`\bbefore (calling|using)\b`,
  String.raw`\bafter\b`,
  String.raw`\brequires?\b`,
  String.raw`\bmust\b`,
  String.raw`\bshould\b`,
  String.raw`\bavoid\b`,
  String.raw`\bnever\b`,
  String.raw`\balways\b`,
  String.raw`\bwhen\b`,
];
const RET_SOURCES = [
  String.raw`\breturns?\b`,
  String.raw`\bresponse\b`,
  String.raw`\boutput\b`,
  String.raw`\bresult\b`,
  String.raw`\byields?\b`,
  String.raw`\bgives? back\b`,
];
const CONS_SOURCES = [
  String.raw`\brate.?limit`,
  String.raw`\bpaginat`,
  String.raw`\blimit\b`,
  String.raw`\bmax(imum)?\b`,
  String.raw`\bmin(imum)?\b`,
  String.raw`\bside.?effect`,
  String.raw`\bdestructive\b`,
  String.raw`\birreversible\b`,
  String.raw`\bcannot be undone\b`,
  String.raw`\bpermission`,
  String.raw`\bauth`,
  String.raw`\brequires? (an? )?(api key|token|login)`,
  String.raw`\bexpensive\b`,
  String.raw`\bslow\b`,
  String.raw`\btimeout`,
  String.raw`\bidempoten`,
  String.raw`\bread.?only\b`,
  String.raw`\bdeprecated\b`,
  String.raw`\bcost`,
  String.raw`\bquota`,
  String.raw`\bcredits?\b`,
];
const EX_SOURCES = [
  String.raw`\be\.g\.`,
  String.raw`\bfor example\b`,
  String.raw`\bexample`,
  String.raw`\bsuch as\b`,
  String.raw`\blike\b`,
  "`[^`]+`",
  '"[^"]{2,60}"',
  "'[^']{2,60}'",
];

const ignoreCase = (source: string) => pyRegex(source, "i");

export const VERB_START = ignoreCase(VERB_START_SOURCE);
export const CTX_PATTERNS = CTX_SOURCES.map(ignoreCase);
export const RET_PATTERNS = RET_SOURCES.map(ignoreCase);
export const CONS_PATTERNS = CONS_SOURCES.map(ignoreCase);
export const EX_PATTERNS = EX_SOURCES.map(ignoreCase);

/**
 * The prototype's `\b(instead of|rather than|not for|do not use|don't use|use .* instead|prefer)\b`
 * without the `use .* instead` branch, which hasUseInstead checks in linear time instead.
 */
export const DISAMBIGUATION = ignoreCase(
  String.raw`\b(instead of|rather than|not for|do not use|don't use|prefer)\b`,
);
export const DESTRUCTIVE = ignoreCase(
  String.raw`\b(delete|remove|destroy|purge|drop|overwrite|reset|wipe)\b`,
);
export const NAME_CHARS = pyRegex(String.raw`^[A-Za-z0-9_\-\.]+$`);

// Added for forecall-cli#16 (2026-10-09), after the calibration in forecall/forecall#448. Neither
// moves a score, so LINT_VERSION stays 2.
/** A tool whose description says so gets `deprecated`: models rightly avoid it. */
export const DEPRECATED = ignoreCase(String.raw`\bdeprecated\b`);
/** An argument name that carries an identifier or a reference: id, page_id, libraryId, uid, ref. */
export const ID_PARAM =
  /(?:^|[_-])(?:id|ids|uid|ref|refs|cursor)$|[a-z0-9](?:Id|Ids|Ref|Refs|Cursor)$|^parent$/;
/**
 * How an argument's description says where its value comes from. Plain JavaScript patterns, not
 * the prototype's, so they are not run through pyRegex. A quote may be ', " or a backtick.
 */
export const ID_SOURCE_PATTERNS = [
  // "from the page snapshot", "from a previous call", "from the search result"
  "\\bfrom (?:the |a |an |your )?(?:latest |previous |earlier |prior |last |page |content |current )*(?:snapshot|list|listing|search|results?|response|lookup|call|query|output)\\b",
  // "returned by list_pages", "obtained from", "retrieved from"
  "\\b(?:returned|obtained|retrieved|taken|received|comes|come) (?:by|from|via|with|in)\\b",
  // "Call list_pages to list pages", "see search_nodes", "use resolve-library-id first"
  "\\b(?:call|see|use|run|via|through) ['\"`]?[a-z][a-z0-9]*[_-][a-z0-9_.-]+['\"`]?\\b",
  // "from 'resolve-library-id'"
  "\\bfrom ['\"`][a-z][a-z0-9_.-]+['\"`]",
].map((source) => new RegExp(source, "i"));
export const WORD = pyRegex(String.raw`[a-zA-Z][a-zA-Z0-9_\-]*`, "g");
export const NAME_SEPARATOR = pyRegex(String.raw`[_\-\.\s]+|(?<=[a-z])(?=[A-Z])`);

const USE = ignoreCase(String.raw`\buse `);
const INSTEAD = ignoreCase(String.raw` instead\b`);

/**
 * Whether Python's re.search(r"\buse .* instead\b", text, re.I) matches. The regex backtracks
 * quadratically on text with many "use " and no "instead", which a 1 MiB paste could exploit, so
 * this checks each line for the first "use " followed by " instead" instead.
 */
export function hasUseInstead(text: string): boolean {
  return text.split("\n").some((line) => {
    const index = line.search(USE);
    return index !== -1 && INSTEAD.test(line.slice(index + "use ".length));
  });
}
