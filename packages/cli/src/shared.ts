// What the CLI shares with the Forecall service, as its own copies: the brand, the Failure KB's
// MCP endpoint and the instructions its server gives, and the shape of an agent key. Forecall's
// own tests check that a released forecall still matches the service.

export const brand = { name: "Forecall", domain: "forecall.dev" } as const;

export const MCP_ENDPOINT = `https://mcp.${brand.domain}/mcp`;

/** What the KB's server tells a client at `initialize`. */
export const MCP_INSTRUCTIONS = [
  "The Failure KB holds MCP tool failures and workarounds others verified by reproducing them.",
  "Before first using a third-party tool, call kb_lookup with mode preflight and the args_shape; after a call errors or returns an odd shape, call it with the error text. Try a verified or reproduced workaround first.",
  "After applying one, call kb_confirm with its record_id and the outcome: that verifies records.",
  "When you fix a failure the KB did not know, call kb_report with the error and the workaround; secrets, paths and ids are redacted, so send no raw payloads.",
  "Flag a wrong record with kb_dispute.",
].join(" ");

/** An agent key from the dashboard: `fc_agent_` and 32 letters and digits. */
export function isAgentKey(value: string): boolean {
  return /^fc_agent_[0-9A-Za-z]{32}$/.test(value);
}
