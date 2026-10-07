// A minimal MCP server over stdio for the dump tests: answers initialize and a tools/list in two
// pages, and puts FAKE_TOOL_SUFFIX (an environment variable) and its working directory in the
// tools, so the tests can see that --env and --cwd reach it.
import { createInterface } from "node:readline";

const suffix = process.env.FAKE_TOOL_SUFFIX ?? "";
const pages = [
  {
    tools: [
      {
        name: `search${suffix}`,
        description: "Finds pages by keyword.",
        inputSchema: { type: "object", properties: { q: { type: "string" } }, required: ["q"] },
        annotations: { readOnlyHint: true },
      },
    ],
    nextCursor: "page-2",
  },
  { tools: [{ name: "where", description: process.cwd(), inputSchema: { type: "object" } }] },
];

const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);

for await (const line of createInterface({ input: process.stdin })) {
  if (line.trim() === "") continue;
  const message = JSON.parse(line);
  if (message.id === undefined) continue; // notifications
  if (message.method === "initialize") {
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        protocolVersion: message.params.protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: "fake-stdio", version: "1.2.3" },
        instructions: "Use search first.",
      },
    });
  } else if (message.method === "tools/list") {
    const page = message.params?.cursor === "page-2" ? pages[1] : pages[0];
    send({ jsonrpc: "2.0", id: message.id, result: page });
  } else {
    send({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "not found" } });
  }
}
