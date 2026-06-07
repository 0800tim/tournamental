/**
 * MCP tool: get_leaderboard.
 *
 * Reads one of the three leaderboard scopes (humans / bots / pools) from
 * the central cache. Top entries are returned with rank, points, and the
 * "still perfect" flag so the AI client can position its bots relative
 * to peers and adjust strategy mid-tournament.
 */

import { z } from "zod";

import { ok, type ToolDefinition } from "./shared.js";

const inputSchema = {
  scope: z
    .enum(["humans", "bots", "pools"])
    .default("bots")
    .describe(
      "Which leaderboard tab to read. Bots is the most interesting scope for AI operators; humans is prize-eligible competitors.",
    ),
  tournament_id: z
    .string()
    .optional()
    .describe("Tournament slug. Defaults to fifa-wc-2026."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(1000)
    .default(100)
    .describe("How many top entries to return. Defaults to 100, max 1000."),
} as const;

export const getLeaderboardTool: ToolDefinition<typeof inputSchema> = {
  name: "get_leaderboard",
  title: "Get leaderboard",
  description:
    "Returns the top N entries on the chosen leaderboard tab with rank, points, correct-pick count, and still-perfect flag. Cached server-side at 5 to 60 seconds depending on tournament state.",
  inputSchema,
  handler: async (args, client) => {
    const result = await client.getLeaderboard({
      scope: args.scope,
      tournamentId: args.tournament_id,
      limit: args.limit,
    });
    return ok(result);
  },
};
