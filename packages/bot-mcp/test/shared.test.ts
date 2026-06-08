/**
 * Tests for the registerTool wrapper: thrown SDK errors must surface as
 * MCP `isError: true` text responses, not propagate to the transport.
 */

import { describe, expect, it } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { registerTool } from "../src/tools/shared.js";
import { getOddsTool } from "../src/tools/get-odds.js";
import { makeClient, decodeMcp } from "./helpers.js";

describe("registerTool wrapper", () => {
  it("turns thrown BotApiError into an MCP isError response", async () => {
    const server = new McpServer(
      { name: "test", version: "0.0.0" },
      { capabilities: { tools: {} } },
    );
    const { client } = makeClient([
      {
        method: "GET",
        path: "/v1/matches/bogus/odds",
        status: 500,
        body: { error: "upstream odds feed down" },
      },
    ]);
    registerTool(server, getOddsTool, client);

    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const mcpClient = new Client(
      { name: "test-client", version: "0.0.0" },
      { capabilities: {} },
    );
    await Promise.all([
      server.connect(serverTransport),
      mcpClient.connect(clientTransport),
    ]);

    try {
      const result = await mcpClient.callTool({
        name: "get_odds",
        arguments: { match_id: "bogus" },
      });
      const decoded = decodeMcp(
        result as unknown as {
          content: { type: string; text?: string }[];
          isError?: boolean;
        },
      );
      expect(decoded.isError).toBe(true);
      const payload = decoded.payload as { error: string; status: number };
      expect(payload.error).toMatch(/upstream odds feed down/);
      expect(payload.status).toBe(500);
    } finally {
      await Promise.all([mcpClient.close(), server.close()]);
    }
  });
});
