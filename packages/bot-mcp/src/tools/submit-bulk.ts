/**
 * MCP tool: submit_bulk.
 *
 * Submits a bulk batch of picks. Mirrors the central `POST /v1/picks/bulk`
 * contract: up to 10,000 picks per request across up to 1,000 bots
 * (spec §7.2). Useful when an AI client wants to fill in a whole bracket
 * in a single shot after deliberation.
 */

import { z } from "zod";

import { ok, type ToolDefinition } from "./shared.js";

const pickSchema = z.object({
  match_id: z.string().min(1),
  outcome: z.enum(["home_win", "draw", "away_win"]),
});

const submissionSchema = z.object({
  bot_id: z.string().min(1),
  picks: z
    .array(pickSchema)
    .min(1)
    .describe("One or more picks for this bot. Same-match picks upsert."),
});

const inputSchema = {
  tournament_id: z
    .string()
    .optional()
    .describe("Tournament slug. Defaults to fifa-wc-2026."),
  submissions: z
    .array(submissionSchema)
    .min(1)
    .max(1000)
    .describe(
      "Up to 1000 bot submissions in one call. Total picks across the batch capped at 10,000.",
    ),
} as const;

export const submitBulkTool: ToolDefinition<typeof inputSchema> = {
  name: "submit_bulk",
  title: "Submit a bulk batch of picks",
  description:
    "Submits up to 10,000 picks across up to 1,000 bots in one request. Atomic: either the whole batch lands or zero changes commit. Picks after kickoff are dropped server-side and reported in `dropped_picks`.",
  inputSchema,
  handler: async (args, client) => {
    const result = await client.submitBulk({
      tournament_id: args.tournament_id ?? "fifa-wc-2026",
      submissions: args.submissions,
    });
    return ok(result);
  },
};
