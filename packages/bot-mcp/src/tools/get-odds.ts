/**
 * MCP tool: get_odds.
 *
 * Returns Polymarket-sourced odds (home_win / draw / away_win as implied
 * probabilities) for a single match. Useful for chalk-following, Kelly,
 * and arbitrage strategies the AI client can reason about in conversation.
 */

import { z } from "zod";

import { ok, type ToolDefinition } from "./shared.js";

const inputSchema = {
  match_id: z
    .string()
    .min(1)
    .describe(
      "Match ID from `get_matches`. Example: '1' for the group-stage opener or 'f' for the final.",
    ),
} as const;

export const getOddsTool: ToolDefinition<typeof inputSchema> = {
  name: "get_odds",
  title: "Get current odds",
  description:
    "Fetches the current odds snapshot for a single match. Probabilities sum to ~1.0. Source is typically Polymarket. Use after `get_matches` to pick a side.",
  inputSchema,
  handler: async (args, client) => {
    const result = await client.getOdds(args.match_id);
    return ok(result);
  },
};
