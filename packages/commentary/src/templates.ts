import type {
  EventMessage,
  Player as SpecPlayer,
  Team as SpecTeam,
} from "@vtorn/spec";

/**
 * Per-line "intent" — drives audio voice selection (excited vs neutral)
 * and visual emphasis (banner vs ticker).
 */
export type CommentaryIntent =
  | "neutral"
  | "build"
  | "danger"
  | "celebration"
  | "anguish"
  | "structural"
  | "colour";

export interface CommentaryLine {
  /** Stable id for caching ((event_id, variant)). */
  id: string;
  /** The text to speak / display. Plain English, no SSML for now. */
  text: string;
  /** When to schedule it relative to the source event's t_ms. Negative = pre-roll, positive = post-roll. */
  offset_ms: number;
  /** Approximate read duration; used by the scheduler to decide cooldowns. */
  duration_ms: number;
  intent: CommentaryIntent;
  /**
   * Which "channel" the line claims while playing. Lines on the same
   * channel can't play simultaneously — the scheduler defers / drops.
   */
  channel: "play-by-play" | "colour" | "structural";
}

export interface CommentaryContext {
  /**
   * Lookup by player id. Source of name/jersey/team_id. Build once at
   * MatchInit and pass into every call.
   */
  players: Map<string, SpecPlayer & { team_id: string }>;
  /** Lookup by team id. */
  teams: Map<string, SpecTeam>;
  /** Last known score per team_id. */
  score: Record<string, number>;
  /** Current match minute (cumulative across periods). */
  minute: number;
  /** Optional, default false. Adds extra colour for goals etc. */
  enthusiastic?: boolean;
}

const PLAYER_FALLBACK = "the player";
const TEAM_FALLBACK = "their side";

function playerName(ctx: CommentaryContext, id?: string): string {
  if (!id) return PLAYER_FALLBACK;
  const p = ctx.players.get(id);
  return p?.name ?? PLAYER_FALLBACK;
}

/**
 * Pick the most commentator-recognisable single token from a full name.
 *
 * Naming-convention realities we have to handle:
 *   - Spanish: "Lionel Andrés Messi Cuccittini" -> commentator says "Messi"
 *     (paternal surname, second-to-last; the last is the maternal surname).
 *   - French/English/single-surname: "Kylian Mbappé Lottin" -> "Mbappé".
 *     Three tokens, again take second-to-last.
 *   - Two tokens: "Diego Maradona" -> "Maradona". Last.
 *   - Single token: "Pelé" -> "Pelé".
 *
 * Heuristic: if 3+ tokens, return tokens[length-2]; else return last.
 * Caller can override by injecting a `displayName(id)` resolver later.
 */
function shortPlayerName(ctx: CommentaryContext, id?: string): string {
  const full = playerName(ctx, id);
  if (full === PLAYER_FALLBACK) return full;
  const parts = full.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return full;
  if (parts.length >= 3) return parts[parts.length - 2]!;
  return parts[parts.length - 1]!;
}

function teamName(ctx: CommentaryContext, id?: string): string {
  if (!id) return TEAM_FALLBACK;
  return ctx.teams.get(id)?.name ?? TEAM_FALLBACK;
}

const goalCelebrations: ReadonlyArray<(name: string, team: string) => string> = [
  (name, team) => `GOAL! ${name} for ${team}!`,
  (name, team) => `It's there! ${name} scores for ${team}!`,
  (name, team) => `${name} buries it! ${team} have the lead!`,
  (name, team) => `Yes! ${name}! What a finish for ${team}!`,
  (name, team) => `${team} score, and it's ${name} with the goal!`,
];

const shotDescriptors: ReadonlyArray<string> = [
  "tries his luck",
  "lets fly",
  "shoots",
  "has a go",
  "tries to find the net",
];

function pickVariant<T>(arr: ReadonlyArray<T>, key: string): T {
  // Stable mod-by-hash so the same event always picks the same variant.
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  return arr[Math.abs(h) % arr.length]!;
}

function minuteLabel(ctx: CommentaryContext): string {
  return `${ctx.minute}'`;
}

/**
 * Pure function: spec event + lookup context -> 0..N commentary lines.
 *
 * Lines may be empty when the event isn't worth commentating (e.g. routine
 * passes mid-pitch). The scheduler trims further based on cooldowns.
 */
export function generateCommentary(
  ev: EventMessage,
  ctx: CommentaryContext,
): CommentaryLine[] {
  // Stable id seed: the (t, type) pair is unique within a match for our needs.
  const id = `${ev.t}:${ev.type}`;
  const lines: CommentaryLine[] = [];

  switch (ev.type) {
    case "event.kickoff": {
      lines.push({
        id: `${id}:kickoff`,
        text: ctx.minute === 0
          ? `And we're underway. ${teamName(ctx, ev.team)} get us going.`
          : `Game on after the goal. ${teamName(ctx, ev.team)} restart.`,
        offset_ms: 0,
        duration_ms: 2400,
        intent: "structural",
        channel: "structural",
      });
      break;
    }

    case "event.period_start": {
      const labels: Record<number, string> = {
        1: "Kick off, first half.",
        2: "Second half. Game on.",
        3: "Extra time, first period.",
        4: "Second period of extra time.",
        5: "We're going to penalties.",
      };
      const text = labels[ev.period ?? 1] ?? `Period ${ev.period ?? "?"} starts.`;
      lines.push({ id: `${id}:p`, text, offset_ms: 0, duration_ms: 2200, intent: "structural", channel: "structural" });
      break;
    }

    case "event.period_end": {
      const text = ev.period === 1
        ? "Half time. They've earned it."
        : ev.period === 2
          ? "Full time of regulation."
          : `End of period ${ev.period ?? "?"}.`;
      lines.push({ id: `${id}:pe`, text, offset_ms: 0, duration_ms: 2000, intent: "structural", channel: "structural" });
      break;
    }

    case "event.shot": {
      const who = shortPlayerName(ctx, ev.player);
      const verb = pickVariant(shotDescriptors, id);
      lines.push({
        id: `${id}:shot`,
        text: `${who} ${verb}!`,
        offset_ms: 0,
        duration_ms: 1400,
        intent: "danger",
        channel: "play-by-play",
      });
      break;
    }

    case "event.save": {
      const who = shortPlayerName(ctx, ev.keeper);
      lines.push({
        id: `${id}:save`,
        text: `Saved by ${who}!`,
        offset_ms: 0,
        duration_ms: 1300,
        intent: "danger",
        channel: "play-by-play",
      });
      break;
    }

    case "event.goal": {
      const team = teamName(ctx, ev.team);
      const scorer = shortPlayerName(ctx, ev.player);
      const variant = pickVariant(goalCelebrations, id);
      lines.push({
        id: `${id}:goal`,
        text: variant(scorer, team),
        offset_ms: 200,
        duration_ms: 3200,
        intent: "celebration",
        channel: "play-by-play",
      });
      if (ctx.enthusiastic) {
        lines.push({
          id: `${id}:goal:colour`,
          text: `What a moment in the ${minuteLabel(ctx)} minute.`,
          offset_ms: 3500,
          duration_ms: 2000,
          intent: "colour",
          channel: "colour",
        });
      }
      break;
    }

    case "event.score_change": {
      // Skip — covered by event.goal. Score line shown in HUD only.
      break;
    }

    case "event.foul": {
      const who = shortPlayerName(ctx, ev.player);
      lines.push({
        id: `${id}:foul`,
        text: `Foul on ${who}.`,
        offset_ms: 0,
        duration_ms: 1500,
        intent: "neutral",
        channel: "play-by-play",
      });
      break;
    }

    case "event.substitution": {
      const onName = playerName(ctx, ev.player_in);
      const offName = playerName(ctx, ev.player_out);
      const team = teamName(ctx, ev.team);
      lines.push({
        id: `${id}:sub`,
        text: `Substitution for ${team}: ${onName} on, ${offName} off.`,
        offset_ms: 0,
        duration_ms: 3200,
        intent: "structural",
        channel: "structural",
      });
      break;
    }

    case "event.penalty_shootout_start": {
      lines.push({
        id: `${id}:pso`,
        text: "We're going to penalties to decide it.",
        offset_ms: 0,
        duration_ms: 2400,
        intent: "structural",
        channel: "structural",
      });
      break;
    }

    case "event.penalty_attempt": {
      const taker = shortPlayerName(ctx, ev.player);
      const team = teamName(ctx, ev.team);
      const outcome = ev.outcome === "scored"
        ? `${taker} scores for ${team}!`
        : ev.outcome === "saved"
          ? `Saved! ${taker} denied!`
          : ev.outcome === "missed"
            ? `${taker} misses!`
            : `${taker} steps up.`;
      lines.push({
        id: `${id}:pen`,
        text: outcome,
        offset_ms: 0,
        duration_ms: 2200,
        intent: ev.outcome === "scored" ? "celebration" : "danger",
        channel: "play-by-play",
      });
      break;
    }

    case "event.penalty_shootout_end": {
      const winner = teamName(ctx, ev.winner);
      lines.push({
        id: `${id}:psoe`,
        text: `${winner} win the shootout!`,
        offset_ms: 200,
        duration_ms: 3000,
        intent: "celebration",
        channel: "play-by-play",
      });
      break;
    }

    default:
      // Routine events (passes, dribbles, restarts) don't get commentary
      // by default — the colour-channel scheduler can layer ad-libs later.
      break;
  }

  return lines;
}
