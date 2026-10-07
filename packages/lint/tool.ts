/** JSON values as JSON.parse produces them. */
export type JsonValue = string | number | boolean | null | JsonValue[] | JsonObject;
export type JsonObject = { [key: string]: JsonValue };

/** MCP tool annotations. All are hints; an absent key means the server did not declare it. */
export interface ToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

/**
 * One tool from an MCP tools/list result, in the MCP wire format (camelCase), keeping only the
 * fields the linter reads.
 */
export interface Tool {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: JsonObject;
  outputSchema?: JsonObject;
  annotations?: ToolAnnotations;
}
