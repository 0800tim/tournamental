/**
 * MCP tool: get_matches.
 *
 * Returns the 104-match catalogue for the requested tournament (defaults to
 * the 2026 FIFA World Cup) with stage, team codes, and kickoff times. AI
 * clients call this first to understand the bracket before making picks.
 */

import { z } from "zod";

import { ok, type ToolDefinition } from "./shared.js";

const inputSchema = {
  tournament_id: z
    .string()
    .optional()
    .describe(
      "Tournament slug. Defaults to fifa-wc-2026. Example: fifa-wc-2026.",
    ),
} as const;

export const getMatchesTool: ToolDefinition<typeof inputSchema> = {
  name: "get_matches",
  title: "Get match catalogue",
  description:
    "Lists every match in the tournament (all 104 matches for FIFA World Cup 2026) with stage, team codes, and UTC kickoff times. Use this to plan picks before submitting.",
  inputSchema,
  handler: async (args, client) => {
    const result = await client.getMatches(args.tournament_id);
    return ok(result);
  },
};
