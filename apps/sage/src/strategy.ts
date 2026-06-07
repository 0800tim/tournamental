/**
 * Sage's per-match decision function.
 *
 * Asks Claude Opus 4.7 to nominate one of `home_win | draw | away_win` for a
 * single match given the public Polymarket odds snapshot. The model is asked
 * for a single token-style answer; if it returns anything else we fall back
 * to the favourite implied by the odds (lowest implied probability of
 * loss). This makes the function deterministic in failure modes: Sage never
 * skips a match.
 *
 * Spec ref: docs/superpowers/specs/2026-06-07-bot-arena-design.md §9.
 */

import type { MatchSpec, OddsSnapshot, Outcome } from "@tournamental/bot-sdk";

/**
 * Minimal subset of the Anthropic SDK we depend on. Defined as an interface so
 * tests can inject a mock without touching the real network. The real
 * `@anthropic-ai/sdk` client implements this shape (the response body is the
 * `Anthropic.Messages.Message` type but we narrow to what we use).
 */
export interface ClaudeLike {
  messages: {
    create: (req: ClaudeRequest) => Promise<ClaudeResponse>;
  };
}

export interface ClaudeRequest {
  model: string;
  max_tokens: number;
  messages: { role: "user" | "assistant"; content: string }[];
}

export interface ClaudeResponse {
  content: { type: string; text?: string }[];
}

export interface DecideOpts {
  /** Optional injected Claude client. Defaults to a real Anthropic SDK instance built from ANTHROPIC_API_KEY. */
  claude?: ClaudeLike;
  /** Override the Claude model id. Defaults to claude-opus-4-7. */
  model?: string;
}

export const DEFAULT_MODEL = "claude-opus-4-7";

/**
 * Build the user prompt for a single match. Kept tiny so the model returns
 * one token; keeps cost low and parsing simple.
 */
export function buildPrompt(match: MatchSpec, odds: OddsSnapshot | null): string {
  const home = match.home_code ?? "HOME";
  const away = match.away_code ?? "AWAY";
  const oddsBlob = odds
    ? `home_win=${odds.home_win.toFixed(3)} draw=${odds.draw.toFixed(3)} away_win=${odds.away_win.toFixed(3)}`
    : "no live market";
  return [
    `Football match: ${home} vs ${away}.`,
    `Kickoff: ${match.kickoff_utc}.`,
    `Public market probabilities: ${oddsBlob}.`,
    `Reply with exactly one of: home_win | draw | away_win. No punctuation, no explanation.`,
  ].join("\n");
}

/**
 * Pick the favourite implied by an odds snapshot. Used as the deterministic
 * fallback when Claude returns garbage or is unavailable.
 *
 * Tie-breaks deterministically: prefer home_win, then draw, then away_win.
 * This matches the chalk-bot baseline so Sage never drifts below it on a
 * pure-fallback day.
 */
export function favourite(odds: OddsSnapshot | null): Outcome {
  if (!odds) return "home_win";
  const ranked: { outcome: Outcome; p: number }[] = [
    { outcome: "home_win", p: odds.home_win },
    { outcome: "draw", p: odds.draw },
    { outcome: "away_win", p: odds.away_win },
  ];
  ranked.sort((a, b) => b.p - a.p);
  return ranked[0]!.outcome;
}

/** Strict outcome parser. Trims, lowercases, accepts only the three canonical strings. */
export function parseOutcome(raw: string): Outcome | null {
  const trimmed = raw
    .trim()
    .toLowerCase()
    .replace(/^[`"'.\s]+/g, "")
    .replace(/[`"'.\s]+$/g, "");
  if (trimmed === "home_win" || trimmed === "draw" || trimmed === "away_win") {
    return trimmed;
  }
  return null;
}

/**
 * Ask Claude for a pick. Falls back to the odds favourite if:
 *   - no Claude client was provided AND no API key in env (lets tests skip the network),
 *   - the API call throws,
 *   - the response is missing text content,
 *   - or the returned text is not one of the three allowed tokens.
 */
export async function decide(
  match: MatchSpec,
  odds: OddsSnapshot | null,
  opts: DecideOpts = {},
): Promise<Outcome> {
  const client = opts.claude;
  if (!client) {
    // No injected client and no key: bail to the favourite without throwing.
    // The runtime in src/index.ts wires the real SDK in production.
    return favourite(odds);
  }
  const model = opts.model ?? DEFAULT_MODEL;
  const prompt = buildPrompt(match, odds);
  try {
    const res = await client.messages.create({
      model,
      max_tokens: 16,
      messages: [{ role: "user", content: prompt }],
    });
    const block = res.content.find((c) => c.type === "text");
    const text = block?.text ?? "";
    const parsed = parseOutcome(text);
    return parsed ?? favourite(odds);
  } catch {
    return favourite(odds);
  }
}
