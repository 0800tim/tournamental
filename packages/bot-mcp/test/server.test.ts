/**
 * End-to-end MCP server test.
 *
 * Boots the real `McpServer` produced by `createServer`, links it to a Client
 * over `InMemoryTransport.createLinkedPair()`, and asserts `tools/list`
 * reports exactly the six Tournamental tools. This is the "manual confirm
 * the binary responds to tools/list" criterion from the task spec, expressed
 * as a deterministic test.
 */

import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { createServer, TOOL_NAMES } from "../src/index.js";

describe("MCP server end-to-end", () => {
  it("responds to tools/list with the six Tournamental tools", async () => {
    const server = createServer({
      apiKey: "tnm_test_key_abcdef0123456789",
      baseUrl: "https://api.tournamental.test",
      fetchImpl: (async () =>
        new Response("{}", { status: 200 })) as unknown as typeof fetch,
    });

    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();

    const client = new Client(
      { name: "tournamental-bot-mcp-test", version: "0.0.0" },
      { capabilities: {} },
    );

    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    try {
      const result = await client.listTools();
      const names = result.tools.map((t) => t.name).sort();
      expect(names).toEqual([...TOOL_NAMES].sort());
    } finally {
      await Promise.all([client.close(), server.close()]);
    }
  });
});
