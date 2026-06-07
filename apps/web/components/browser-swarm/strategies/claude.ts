/**
 * Optional Anthropic Claude strategy.
 *
 * The browser swarm by default uses the chalk-weighted heuristic. If the
 * operator pastes an Anthropic API key, every Nth bot can be elevated
 * to a "reasoning" bot whose picks come from Claude. We don't run
 * Claude per-bot per-match for cost reasons: instead, for a chosen
 * number of "champion" bots we ask Claude once for a full 104-match
 * bracket and let those picks flow into the merkle commitment alongside
 * the chalk-weighted majority.
 *
 * This file deliberately keeps the network call shape minimal so the
 * worker can stream picks back to the UI as they arrive. We use the
 * Anthropic Messages API with CORS via `anthropic-dangerous-direct-browser-access`
 * because we're explicitly running inside the user's tab with the
 * user's own key, there is no server-side proxy.
 *
 * Falls back silently to the chalk strategy if the network or key
 * fails, so a swarm run never crashes mid-flight.
 */

import { chalkDecide, defaultChalkScore, type ChalkPick } from "./chalk";
import type { MatchSpec, Outcome } from "../types";

export const CLAUDE_STRATEGY_NAME = "claude-3-5-sonnet" as const;

const ANTHROPIC_ENDPOINT = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL = "claude-3-5-sonnet-latest";

export interface ClaudeBracketRequest {
  readonly api_key: string;
  readonly matches: readonly MatchSpec[];
  readonly bot_persona: string;
  readonly model?: string;
}

export interface ClaudePick {
  readonly match_id: string;
  readonly outcome: Outcome;
  readonly reasoning?: string;
}

interface AnthropicTextBlock {
  type: "text";
  text: string;
}

interface AnthropicResponse {
  content?: AnthropicTextBlock[];
}

/**
 * Ask Claude for a full 104-pick bracket for a single "champion" bot.
 *
 * Returns one pick per match in the input order. Any parse failure falls
 * back to the chalk strategy so we always return a complete bracket.
 */
export async function claudeBracket(
  req: ClaudeBracketRequest,
): Promise<ClaudePick[]> {
  const prompt = buildPrompt(req.matches, req.bot_persona);
  let parsed: ClaudePick[] | null = null;

  try {
    const res = await fetch(ANTHROPIC_ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": req.api_key,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: req.model ?? DEFAULT_MODEL,
        max_tokens: 4096,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (res.ok) {
      const json = (await res.json()) as AnthropicResponse;
      const text = json.content?.find((b) => b.type === "text")?.text ?? "";
      parsed = parseClaudeBracket(text, req.matches);
    }
  } catch {
    parsed = null;
  }

  if (parsed && parsed.length === req.matches.length) return parsed;

  // Fallback: chalk pick everything so the bracket is always complete.
  const fallbackSeed = `claude-fallback-${req.bot_persona}`;
  return req.matches.map((m) => {
    const pick: ChalkPick = chalkDecide(m, {
      seed: fallbackSeed,
      chalk_score: defaultChalkScore(fallbackSeed),
    });
    return { match_id: m.match_id, outcome: pick.outcome };
  });
}

function buildPrompt(matches: readonly MatchSpec[], persona: string): string {
  const lines = matches.map(
    (m, i) =>
      `${i + 1}. ${m.match_id}: ${m.home_team} vs ${m.away_team}` +
      (m.allows_draw ? " (group, draw allowed)" : " (knockout, winner only)"),
  );

  return [
    "You are a tournament prediction bot. Persona:",
    persona,
    "",
    "Predict the outcome of every match in this bracket. Respond with",
    "ONLY a JSON array of objects, no prose, in the form:",
    '[{"match_id":"...","outcome":"home_win|draw|away_win"}, ...]',
    "",
    "Group matches allow home_win, draw, away_win. Knockout matches",
    "allow home_win or away_win only. Use any tournament-football",
    "intuition you have about these teams.",
    "",
    "Matches:",
    ...lines,
  ].join("\n");
}

function parseClaudeBracket(
  text: string,
  matches: readonly MatchSpec[],
): ClaudePick[] | null {
  // Tolerate code-fence wrapping and surrounding prose.
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) return null;
  try {
    const raw = JSON.parse(match[0]) as Array<{
      match_id?: unknown;
      outcome?: unknown;
    }>;
    if (!Array.isArray(raw)) return null;

    const byId = new Map<string, Outcome>();
    for (const row of raw) {
      if (typeof row.match_id !== "string") continue;
      if (
        row.outcome !== "home_win" &&
        row.outcome !== "draw" &&
        row.outcome !== "away_win"
      ) {
        continue;
      }
      byId.set(row.match_id, row.outcome);
    }

    const picks: ClaudePick[] = [];
    for (const m of matches) {
      const outcome = byId.get(m.match_id);
      if (!outcome) return null;
      // Force a valid outcome for knockouts where Claude might have
      // wrongly said "draw".
      const safe: Outcome =
        !m.allows_draw && outcome === "draw" ? "home_win" : outcome;
      picks.push({ match_id: m.match_id, outcome: safe });
    }
    return picks;
  } catch {
    return null;
  }
}
