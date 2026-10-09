import { describe, expect, it } from "vitest";
import cases from "./fixtures/cases.json";
import {
  extractTools,
  MAX_INPUT_BYTES,
  MAX_TOOLS,
  parseToolsList,
  readToolsList,
  type ToolsListError,
} from "./tools-list.ts";

const tool = { name: "search", description: "Search records.", inputSchema: { type: "object" } };
const tools = [tool];

function errorOf(result: ReturnType<typeof readToolsList>): ToolsListError | undefined {
  return result.ok ? undefined : result.error;
}

describe("extractTools", () => {
  it.each([
    ["a bare array", tools],
    ["an MCP result", { tools }],
    ["our dump", { server: { name: "x" }, instructions: "…", tools }],
    ["a JSON-RPC response", { jsonrpc: "2.0", id: 1, result: { tools } }],
    ["tools and result together (tools wins)", { tools, result: { tools: [] } }],
  ])("accepts %s", (_, data) => {
    expect(extractTools(data)).toMatchObject({ ok: true, tools });
  });

  // A dump says what the server answered at initialize; a bare list cannot (forecall-cli#12).
  it.each([
    [
      "our dump",
      { server: { name: "x" }, instructions: "Use me.", tools },
      { instructions: "Use me." },
    ],
    [
      "our dump of a server with no instructions",
      { server: { name: "x" }, tools },
      { instructions: undefined },
    ],
    [
      "a dump with only instructions",
      { instructions: "Use me.", tools },
      { instructions: "Use me." },
    ],
    [
      "a dump whose instructions are not a string",
      { server: {}, instructions: 5, tools },
      { instructions: undefined },
    ],
  ])("reads the handshake of %s", (_, data, handshake) => {
    expect(extractTools(data)).toEqual({ ok: true, tools, handshake });
    expect(readToolsList(data)).toMatchObject({ ok: true, handshake });
  });

  it.each([
    ["a bare array", tools],
    ["an MCP result", { tools }],
    ["a JSON-RPC response", { jsonrpc: "2.0", id: 1, result: { tools } }],
  ])("gives no handshake for %s", (_, data) => {
    expect(extractTools(data)).not.toHaveProperty("handshake");
    expect(readToolsList(data)).not.toHaveProperty("handshake");
  });

  it.each([
    ["null", null],
    ["a number", 42],
    ["a string", "[]"],
    ["an empty object", {}],
    ["tools that is not an array", { tools: { 0: tool } }],
    ["result that is not an object", { result: [tools] }],
    ["result.tools that is not an array", { result: { tools: "x" } }],
    ["a JSON-RPC error", { jsonrpc: "2.0", id: 1, error: { code: -32601, message: "x" } }],
  ])("rejects %s", (_, data) => {
    expect(extractTools(data)).toEqual({ ok: false, error: { code: "unrecognized_shape" } });
  });
});

describe("parseToolsList: size and syntax", () => {
  // Pads a valid JSON array with whitespace to an exact UTF-8 byte length.
  const arrayOfBytes = (bytes: number) => `[${" ".repeat(bytes - 2)}]`;

  it.each([
    ["exactly the limit", arrayOfBytes(MAX_INPUT_BYTES), true],
    ["one byte over the limit", arrayOfBytes(MAX_INPUT_BYTES + 1), false],
    // Fewer UTF-16 code units than the limit, but more UTF-8 bytes (3 bytes per character).
    ["multibyte text over the limit in bytes", `["${"あ".repeat(MAX_INPUT_BYTES / 3)}"]`, false],
  ])("%s", (_, text, accepted) => {
    const result = parseToolsList(text);
    expect(result.ok ? true : result.error.code !== "input_too_large").toBe(accepted);
  });

  it("reports the limit", () => {
    expect(errorOf(parseToolsList(arrayOfBytes(MAX_INPUT_BYTES + 1)))).toEqual({
      code: "input_too_large",
      limit: MAX_INPUT_BYTES,
    });
  });

  it.each(["", "{", "[1,]", "{'tools': []}", "undefined"])("rejects invalid JSON %j", (text) => {
    expect(errorOf(parseToolsList(text))).toEqual({ code: "invalid_json" });
  });

  it("parses valid input", () => {
    expect(parseToolsList(JSON.stringify({ tools }))).toEqual({ ok: true, tools });
  });
});

describe("readToolsList: tool count", () => {
  const many = (count: number) => Array.from({ length: count }, (_, i) => ({ name: `t${i}` }));

  it.each([
    [0, true],
    [MAX_TOOLS, true],
    [MAX_TOOLS + 1, false],
  ])("%s tools", (count, accepted) => {
    expect(readToolsList(many(count)).ok).toBe(accepted);
  });

  it("reports the count and the limit", () => {
    expect(errorOf(readToolsList(many(MAX_TOOLS + 1)))).toEqual({
      code: "too_many_tools",
      count: MAX_TOOLS + 1,
      limit: MAX_TOOLS,
    });
  });

  it("rejects an unrecognized shape", () => {
    expect(errorOf(readToolsList({ list: tools }))).toEqual({ code: "unrecognized_shape" });
  });
});

describe("readToolsList: snake_case keys", () => {
  const cases: [key: string, fields: object, path: string, expected: string][] = [
    ["input_schema", { input_schema: {} }, "tools[0].input_schema", "inputSchema"],
    ["output_schema", { output_schema: {} }, "tools[0].output_schema", "outputSchema"],
    [
      "read_only_hint",
      { annotations: { read_only_hint: true } },
      "tools[0].annotations.read_only_hint",
      "readOnlyHint",
    ],
    [
      "destructive_hint",
      { annotations: { destructive_hint: true } },
      "tools[0].annotations.destructive_hint",
      "destructiveHint",
    ],
    [
      "idempotent_hint",
      { annotations: { idempotent_hint: true } },
      "tools[0].annotations.idempotent_hint",
      "idempotentHint",
    ],
    [
      "open_world_hint",
      { annotations: { open_world_hint: true } },
      "tools[0].annotations.open_world_hint",
      "openWorldHint",
    ],
  ];

  it.each(cases)("detects %s", (key, fields, path, expected) => {
    expect(errorOf(readToolsList([{ name: "t", ...fields }]))).toEqual({
      code: "snake_case_keys",
      keys: [{ path, key, expected }],
    });
  });

  it("lists every key across tools, with the tool index", () => {
    const input = [
      { name: "a", inputSchema: {} },
      { name: "b", input_schema: {}, inputSchema: {}, annotations: { read_only_hint: true } },
    ];
    expect(errorOf(readToolsList(input))).toEqual({
      code: "snake_case_keys",
      keys: [
        { path: "tools[1].input_schema", key: "input_schema", expected: "inputSchema" },
        {
          path: "tools[1].annotations.read_only_hint",
          key: "read_only_hint",
          expected: "readOnlyHint",
        },
      ],
    });
  });

  it.each([
    [
      "argument names in inputSchema",
      { inputSchema: { properties: { file_path: {}, input_schema: {} } } },
    ],
    ["keys the linter does not read", { execution: { task_support: "forbidden" }, _meta: {} }],
    ["keys in outputSchema", { outputSchema: { properties: { read_only_hint: {} } } }],
  ])("ignores %s", (_, fields) => {
    expect(readToolsList([{ name: "t", ...fields }]).ok).toBe(true);
  });
});

describe("readToolsList: field types", () => {
  it.each([
    ["a tool that is not an object", "search", "tools[0]", "object"],
    ["a tool that is null", null, "tools[0]", "object"],
    ["a tool that is an array", [tool], "tools[0]", "object"],
    ["a missing name", { description: "x" }, "tools[0].name", "non-empty string"],
    ["an empty name", { name: "" }, "tools[0].name", "non-empty string"],
    ["a name that is not a string", { name: 1 }, "tools[0].name", "non-empty string"],
    ["a title that is not a string", { name: "t", title: 1 }, "tools[0].title", "string"],
    [
      "a description that is not a string",
      { name: "t", description: ["x"] },
      "tools[0].description",
      "string",
    ],
    ["an inputSchema array", { name: "t", inputSchema: [] }, "tools[0].inputSchema", "object"],
    ["an inputSchema string", { name: "t", inputSchema: "{}" }, "tools[0].inputSchema", "object"],
    ["an outputSchema number", { name: "t", outputSchema: 1 }, "tools[0].outputSchema", "object"],
    [
      "annotations that are an array",
      { name: "t", annotations: [] },
      "tools[0].annotations",
      "object",
    ],
    [
      "a hint that is not a boolean",
      { name: "t", annotations: { readOnlyHint: "true" } },
      "tools[0].annotations.readOnlyHint",
      "boolean",
    ],
    [
      "an annotation title that is not a string",
      { name: "t", annotations: { title: false } },
      "tools[0].annotations.title",
      "string",
    ],
  ])("rejects %s", (_, value, path, expected) => {
    expect(errorOf(readToolsList([value]))).toEqual({ code: "invalid_tool", path, expected });
  });

  it("reports the first invalid tool by index", () => {
    expect(errorOf(readToolsList([tool, { name: "t", title: 1 }, { name: "" }]))).toEqual({
      code: "invalid_tool",
      path: "tools[1].title",
      expected: "string",
    });
  });

  it("keeps the fields Forecall reads", () => {
    const full = {
      name: "delete_page",
      title: "Delete page",
      description: "Deletes a page.",
      inputSchema: { type: "object", properties: { page_id: { type: "string" } } },
      outputSchema: { type: "object" },
      annotations: {
        title: "Delete",
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    };
    expect(readToolsList([full])).toStrictEqual({ ok: true, tools: [full] });
  });

  it("treats null as absent and drops fields Forecall does not read", () => {
    const input = {
      name: "t",
      title: null,
      description: null,
      inputSchema: null,
      outputSchema: null,
      annotations: { readOnlyHint: null, destructiveHint: true, extraHint: 1 },
      execution: { taskSupport: "optional" },
      _meta: { a: 1 },
    };
    expect(readToolsList([input])).toStrictEqual({
      ok: true,
      tools: [{ name: "t", annotations: { destructiveHint: true } }],
    });
  });

  it("treats null annotations as absent", () => {
    expect(readToolsList([{ name: "t", annotations: null }])).toStrictEqual({
      ok: true,
      tools: [{ name: "t" }],
    });
  });
});

// A list of entries that is not a tools/list: search results, endpoints (forecall-cli#18).
describe("readToolsList: entries", () => {
  const endpoints = [
    {
      method: "get",
      path: "/users/{id}",
      summary: "Read one user.",
      parameters: [
        {
          name: "id",
          in: "path",
          required: true,
          schema: { type: "string" },
          description: "The user's id.",
        },
        { name: "expand", in: "query", schema: { type: "boolean" } },
        { in: "header" },
      ],
    },
    { method: "delete", path: "/users/{id}", summary: "Remove a user." },
  ];

  it("reads endpoints under their method and path, with the parameters as a schema", () => {
    expect(readToolsList({ endpoints })).toEqual({
      ok: true,
      shape: "entries",
      tools: [
        {
          name: "GET /users/{id}",
          description: "Read one user.",
          inputSchema: {
            type: "object",
            properties: {
              id: { type: "string", description: "The user's id." },
              expand: { type: "boolean" },
            },
            required: ["id"],
          },
        },
        { name: "DELETE /users/{id}", description: "Remove a user." },
      ],
    });
  });

  const results = [
    { id: "r1", snippet: "First." },
    { id: "r2", text: "Second." },
  ];
  it.each([
    ["a bare array of results", results],
    ["results under results", { results }],
    [
      "items under items",
      {
        items: [
          { title: "r1", summary: "First." },
          { title: "r2", summary: "Second." },
        ],
      },
    ],
  ])("reads %s", (_, data) => {
    expect(readToolsList(data)).toMatchObject({
      ok: true,
      shape: "entries",
      tools: [
        { name: "r1", description: "First." },
        { name: "r2", description: "Second." },
      ],
    });
  });

  it("prefers name, then operationId, id, title and path; a schema object is taken as is", () => {
    const result = readToolsList({
      entries: [
        { name: "a", operationId: "opA", summary: "A." },
        { operationId: "opB", id: "b", summary: "B.", params: { type: "object", properties: {} } },
        { title: "C", path: "/c", text: "C.", inputSchema: { type: "object" }, parameters: [] },
        { path: "/d", snippet: "D." },
      ],
    });
    expect(result).toMatchObject({
      ok: true,
      tools: [
        { name: "a", description: "A." },
        { name: "opB", description: "B.", inputSchema: { type: "object", properties: {} } },
        { name: "C", description: "C.", inputSchema: { type: "object" } },
        { name: "/d", description: "D." },
      ],
    });
  });

  it("keeps entries of the same name apart with _2, _3", () => {
    const result = readToolsList({ results: [{ id: "x" }, { id: "x" }, { id: "x" }] });
    expect(result.ok && result.tools.map((tool) => tool.name)).toEqual(["x", "x_2", "x_3"]);
  });

  it("reads a tools/list as tools, and a list with one entry in it as entries", () => {
    expect(readToolsList(tools)).toEqual({ ok: true, tools });
    expect(readToolsList({ tools })).toEqual({ ok: true, tools });
    // A tool beside an entry is read as the entry it also is.
    const mixed = readToolsList([tool, { id: "r1", snippet: "First." }]);
    expect(mixed).toMatchObject({ ok: true, shape: "entries" });
    expect(mixed.ok && mixed.tools[1]).toEqual({ name: "r1", description: "First." });
    // A dump is always a tools/list.
    expect(readToolsList({ server: { name: "x" }, tools: [{ id: "r1" }] })).toMatchObject({
      ok: false,
      error: { code: "invalid_tool", path: "tools[0].name" },
    });
  });

  it("rejects an entry with no name, a non-object entry and too many entries", () => {
    expect(errorOf(readToolsList({ results: [{ id: "r1" }, { snippet: "no name" }] }))).toEqual({
      code: "invalid_tool",
      path: "entries[1].name",
      expected: "non-empty string",
    });
    expect(errorOf(readToolsList({ results: [{ id: "r1" }, 5] }))).toEqual({
      code: "invalid_tool",
      path: "entries[1]",
      expected: "object",
    });
    const many = Array.from({ length: MAX_TOOLS + 1 }, (_, i) => ({ id: `r${i}` }));
    expect(errorOf(readToolsList({ results: many }))).toEqual({
      code: "too_many_tools",
      count: MAX_TOOLS + 1,
      limit: MAX_TOOLS,
    });
    expect(errorOf(readToolsList({ foo: [] }))).toEqual({ code: "unrecognized_shape" });
  });

  it("does not report snake_case keys in entries, whose keys are their own", () => {
    expect(readToolsList({ results: [{ id: "r1", input_schema: {} }] })).toMatchObject({
      ok: true,
      shape: "entries",
    });
  });
});

describe("the synthetic cases (fixtures/cases.json)", () => {
  const servers = [
    ["the tools", cases.tools.map((entry) => entry.tool)],
    ...cases.servers.map((server) => [server.name, server.tools] as const),
  ] as const;

  it.each(servers)("%s are accepted as pasted text", (_, fixture) => {
    const result = parseToolsList(JSON.stringify({ tools: fixture }));
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    expect(result.tools).toHaveLength(fixture.length);
    for (const [index, parsed] of result.tools.entries()) {
      const raw = fixture[index] as Record<string, unknown>;
      expect(parsed.name).toBe(raw.name);
      expect(parsed.description).toBe(raw.description);
    }
  });
});
