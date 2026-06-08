/**
 * CLI entrypoint for `tournamental-bot-mcp`.
 *
 * Boots the MCP server and pipes it onto stdio so Claude Desktop, Cursor,
 * and any other MCP-compatible AI client can attach via the standard
 * subprocess transport.
 *
 * All MCP protocol traffic flows over stdout / stdin. Log lines therefore
 * MUST go to stderr (anything on stdout that isn't JSON-RPC will desync
 * the client).
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { createServer } from "./index.js";

async function main(): Promise<void> {
  let server;
  try {
    server = createServer();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[tournamental-bot-mcp] boot failed: ${message}\n`);
    process.exit(1);
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(
    "[tournamental-bot-mcp] connected on stdio; awaiting MCP traffic\n",
  );
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`[tournamental-bot-mcp] fatal: ${message}\n`);
  process.exit(1);
});
