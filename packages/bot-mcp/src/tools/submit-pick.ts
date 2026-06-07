/**
 * MCP tool: submit_pick.
 *
 * Submits one pick for one bot. The underlying API is the bulk endpoint
 * (`POST /v1/picks/bulk`), wrapped here so AI clients can submit one pick
 * at a time in a conversational flow. Picks after kickoff are silently
 * dropped server-side and reported in the response's `dropped_picks`.
 */

import { z } from "zod";

import { ok, type ToolDefinition } from "./shared.js";

const inputSchema = {
  bot_id: z
    .string()
    .min(1)
    .describe("Bot identifier owned by the configured API key. Example: 'my-bot-01'."),
  match_id: z
    .string()
    .min(1)
    .describe("Match ID from `get_matches`. Example: '23' or 'r16_03'."),
  outcome: z
    .enum(["home_win", "draw", "away_win"])
    .describe(
      "Predicted outcome from the home team's perspective. `draw` is invalid for knockout matches.",
    ),
  tournament_id: z
    .string()
    .optional()
    .describe("Tournament slug. Defaults to fifa-wc-2026."),
} as const;

export const submitPickTool: ToolDefinition<typeof inputSchema> = {
  name: "submit_pick",
  title: "Submit a single pick",
  description:
    "Submits a single prediction for one bot in one match. Picks are immutable once kickoff passes. Returns the accepted count and any dropped picks (with reason).",
  inputSchema,
  handler: async (args, client) => {
    const result = await client.submitPick({
      botId: args.bot_id,
      matchId: args.match_id,
      outcome: args.outcome,
      tournamentId: args.tournament_id,
    });
    return ok(result);
  },
};
