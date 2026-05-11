/**
 * Stdio transport entrypoint.
 *
 * Used by local MCP clients (Claude Desktop, Cursor, Windsurf,
 * Continue, etc.). The client spawns this process and pipes JSON-RPC
 * over stdin/stdout. Auth keys come from env vars set in the client's
 * MCP server config, so the operator never types them mid-chat.
 *
 * Env vars consumed:
 *   - TOURNAMENTAL_USER_KEY   (optional) - sent on user-tier calls
 *   - TOURNAMENTAL_ADMIN_KEY  (optional) - sent on admin-tier calls
 *   - GAME_BASE_URL           (optional) - defaults to http://127.0.0.1:3360
 *   - MCP_AUDIT_PATH          (optional) - defaults to ./data/mcp-audit.jsonl
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { buildMcpServer } from '../server.js';

export async function startStdio(): Promise<void> {
  const built = buildMcpServer({
    transport: 'stdio',
    contextResolver: () => ({
      ip: null,
      userKey: process.env.TOURNAMENTAL_USER_KEY ?? null,
      adminKey: process.env.TOURNAMENTAL_ADMIN_KEY ?? null,
    }),
  });

  const transport = new StdioServerTransport();
  await built.server.connect(transport);

  // Tell the local operator we're up. stdout is reserved for JSON-RPC
  // so banners go to stderr.
  process.stderr.write(
    `tournamental-mcp ${process.env.npm_package_version ?? 'dev'} (stdio) ready\n`,
  );
}
