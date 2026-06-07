/**
 * @tournamental/bot-mcp public library entrypoint.
 *
 * Exposes:
 *  - `createServer`: builds a fully-wired `McpServer` (all tools registered)
 *    so callers can mount it on any transport. The bundled `cli.ts` mounts
 *    it on stdio; other consumers (HTTP, in-process testing) can do their
 *    own transport plumbing.
 *  - Tool definitions and the underlying API client, for advanced users
 *    building bespoke bots on top.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { TournamentalApiClient } from "./api-client.js";
import { loadAuthConfig, ENV_VAR_NAMES } from "./auth.js";
import { getMatchesTool } from "./tools/get-matches.js";
import { getOddsTool } from "./tools/get-odds.js";
import { submitPickTool } from "./tools/submit-pick.js";
import { submitBulkTool } from "./tools/submit-bulk.js";
import { getLeaderboardTool } from "./tools/get-leaderboard.js";
import { getMyBotsTool } from "./tools/get-my-bots.js";
import { registerTool } from "./tools/shared.js";

export interface CreateServerOptions {
  apiKey?: string;
  baseUrl?: string;
  /** Test seam; defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

const SERVER_NAME = "tournamental-bot-mcp";
const SERVER_VERSION = "0.1.0";

/** Build a fully-wired MCP server (no transport attached). */
export function createServer(opts: CreateServerOptions = {}): McpServer {
  const auth = opts.apiKey
    ? { apiKey: opts.apiKey, baseUrl: (opts.baseUrl ?? "https://api.tournamental.com").replace(/\/+$/, "") }
    : loadAuthConfig();

  const client = new TournamentalApiClient({
    apiKey: auth.apiKey,
    baseUrl: opts.baseUrl ?? auth.baseUrl,
    fetchImpl: opts.fetchImpl,
  });

  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      capabilities: { tools: {} },
      instructions:
        "You are connected to the Tournamental Open Bot Arena. Use these tools to read the 104-match FIFA World Cup 2026 catalogue, fetch live odds, manage your bots, and submit picks. Picks lock at each match's kickoff time. Bots are not eligible for the cash prize but compete on a dedicated leaderboard.",
    },
  );

  registerTool(server, getMatchesTool, client);
  registerTool(server, getOddsTool, client);
  registerTool(server, submitPickTool, client);
  registerTool(server, submitBulkTool, client);
  registerTool(server, getLeaderboardTool, client);
  registerTool(server, getMyBotsTool, client);

  return server;
}

/** Names of the tools this server exposes, in registration order. */
export const TOOL_NAMES = [
  getMatchesTool.name,
  getOddsTool.name,
  submitPickTool.name,
  submitBulkTool.name,
  getLeaderboardTool.name,
  getMyBotsTool.name,
] as const;

export { ENV_VAR_NAMES };
export {
  TournamentalApiClient,
  BotApiError,
  type LeaderboardEntry,
  type LeaderboardResponse,
  type BotRecord,
  type MyBotsResponse,
  type MatchesResponse,
} from "./api-client.js";
export {
  getMatchesTool,
  getOddsTool,
  submitPickTool,
  submitBulkTool,
  getLeaderboardTool,
  getMyBotsTool,
};
export { registerTool, type ToolDefinition, type McpTextResponse } from "./tools/shared.js";
