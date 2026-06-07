/**
 * MCP tool: get_my_bots.
 *
 * Lists every bot owned by the API key currently configured on the MCP
 * server, along with quota information. AI clients use this to discover
 * which `bot_id` values they can pass to `submit_pick` / `submit_bulk`.
 */

import { z } from "zod";

import { ok, type ToolDefinition } from "./shared.js";

// No inputs required, but MCP tools must declare a schema; an empty object
// keeps the protocol shape consistent.
const inputSchema = {} as const;

export const getMyBotsTool: ToolDefinition<typeof inputSchema> = {
  name: "get_my_bots",
  title: "List my bots",
  description:
    "Returns every bot owned by the API key on this MCP server, plus quota counters. Always call this before submitting picks if you don't already know your bot IDs.",
  inputSchema,
  handler: async (_args, client) => {
    const result = await client.getMyBots();
    return ok(result);
  },
};
