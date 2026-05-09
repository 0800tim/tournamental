/**
 * Strict structural validator for canonical VTourn spec messages
 * (`@vtorn/spec` v0.1.1). Used:
 *   - in tests to assert every emitted message is well-formed,
 *   - by the CLI in `--strict` debug mode (future toggle),
 *   - by other producers as a copy-and-adapt reference.
 *
 * We don't pull in zod/io-ts to keep the runtime deps tiny — and because
 * the spec types are intentionally narrow.
 */
import type { Message } from "@vtorn/spec";

export class SpecValidationError extends Error {
  constructor(message: string, public readonly path: string[] = []) {
    super(`${path.length > 0 ? `[${path.join(".")}] ` : ""}${message}`);
    this.name = "SpecValidationError";
  }
}

const VALID_ANIM_TAGS = new Set([
  "idle", "walk", "run", "sprint", "kick", "pass", "header",
  "shoot", "tackle", "fall", "celebrate", "throw", "catch", "dribble", "jump",
]);

const VALID_SPORTS = new Set([
  "soccer", "rugby_union", "rugby_league", "basketball",
  "american_football", "australian_rules", "field_hockey",
]);

function isVec2(v: unknown): v is [number, number] {
  return Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === "number" && Number.isFinite(n));
}

function isVec3(v: unknown): v is [number, number, number] {
  return Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === "number" && Number.isFinite(n));
}

function isString(v: unknown): v is string {
  return typeof v === "string";
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function isNonNegativeInt(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && Math.floor(v) === v && v >= 0;
}

export function validateMessage(msg: unknown): asserts msg is Message {
  if (!msg || typeof msg !== "object") {
    throw new SpecValidationError("not an object");
  }
  const m = msg as Record<string, unknown>;
  if (!isString(m.type)) throw new SpecValidationError("missing type", ["type"]);

  if (m.type === "match.init") return validateMatchInit(m);
  if (m.type === "state") return validateStateFrame(m);
  if (m.type.startsWith("event.")) return validateEvent(m);
  throw new SpecValidationError(`unknown message type "${m.type}"`, ["type"]);
}

function validateMatchInit(m: Record<string, unknown>): void {
  if (!isString(m.spec_version)) throw new SpecValidationError("missing spec_version", ["spec_version"]);
  if (!isString(m.match_id)) throw new SpecValidationError("missing match_id", ["match_id"]);
  if (!isString(m.sport) || !VALID_SPORTS.has(m.sport)) {
    throw new SpecValidationError(`invalid sport: ${String(m.sport)}`, ["sport"]);
  }
  const field = m.field as Record<string, unknown> | undefined;
  if (!field || !isFiniteNumber(field.length) || !isFiniteNumber(field.width)
      || (field.units !== "m" && field.units !== "ft")) {
    throw new SpecValidationError("invalid field", ["field"]);
  }
  if (!Array.isArray(m.teams) || m.teams.length !== 2) {
    throw new SpecValidationError("must have exactly 2 teams", ["teams"]);
  }
  for (let i = 0; i < 2; i++) {
    const t = m.teams[i] as Record<string, unknown>;
    if (!isString(t.id) || !isString(t.name)) {
      throw new SpecValidationError("team missing id/name", ["teams", String(i)]);
    }
    const kit = t.kit as Record<string, unknown> | undefined;
    if (!kit || !isString(kit.primary) || !isString(kit.secondary)) {
      throw new SpecValidationError("team missing kit.primary/secondary", ["teams", String(i), "kit"]);
    }
    if (!Array.isArray(t.players) || t.players.length === 0) {
      throw new SpecValidationError("team missing players", ["teams", String(i), "players"]);
    }
    for (let j = 0; j < t.players.length; j++) {
      const p = t.players[j] as Record<string, unknown>;
      if (!isString(p.id) || !isString(p.name) || !isFiniteNumber(p.number) || !isString(p.position)) {
        throw new SpecValidationError("player missing required fields", ["teams", String(i), "players", String(j)]);
      }
    }
  }
  if (!isString(m.start_time)) throw new SpecValidationError("missing start_time", ["start_time"]);
}

function validateStateFrame(m: Record<string, unknown>): void {
  if (!isNonNegativeInt(m.t)) throw new SpecValidationError("invalid t", ["t"]);
  const ball = m.ball as Record<string, unknown> | undefined;
  if (!ball || !isVec3(ball.pos)) throw new SpecValidationError("ball.pos must be Vec3", ["ball", "pos"]);
  if (ball.vel !== undefined && !isVec3(ball.vel)) throw new SpecValidationError("ball.vel must be Vec3", ["ball", "vel"]);
  if (ball.carrier !== undefined && !isString(ball.carrier)) throw new SpecValidationError("ball.carrier must be string", ["ball", "carrier"]);
  if (!Array.isArray(m.players)) throw new SpecValidationError("players must be array", ["players"]);
  let hasBallCount = 0;
  for (let i = 0; i < m.players.length; i++) {
    const p = m.players[i] as Record<string, unknown>;
    if (!isString(p.id)) throw new SpecValidationError("player.id missing", ["players", String(i), "id"]);
    if (!isVec2(p.pos)) throw new SpecValidationError("player.pos must be Vec2", ["players", String(i), "pos"]);
    if (!isFiniteNumber(p.facing)) throw new SpecValidationError("player.facing must be number", ["players", String(i), "facing"]);
    if (!isString(p.anim) || !VALID_ANIM_TAGS.has(p.anim)) {
      throw new SpecValidationError(`invalid anim tag: ${String(p.anim)}`, ["players", String(i), "anim"]);
    }
    if (p.has_ball === true) hasBallCount++;
    if (p.fatigue !== undefined && (!isFiniteNumber(p.fatigue) || p.fatigue < 0 || p.fatigue > 1)) {
      throw new SpecValidationError("player.fatigue must be 0..1", ["players", String(i), "fatigue"]);
    }
  }
  if (hasBallCount > 1) {
    throw new SpecValidationError("at most one player may have_ball=true per state frame", ["players"]);
  }
}

function validateEvent(m: Record<string, unknown>): void {
  if (!isNonNegativeInt(m.t)) throw new SpecValidationError("invalid t", ["t"]);
  const type = m.type as string;
  switch (type) {
    case "event.kickoff":
      if (!isString(m.team)) throw new SpecValidationError("missing team", ["team"]);
      return;
    case "event.pass":
      if (!isString(m.from)) throw new SpecValidationError("missing from", ["from"]);
      if (m.to !== undefined && !isString(m.to)) throw new SpecValidationError("to must be string", ["to"]);
      if (!isVec2(m.target)) throw new SpecValidationError("target must be Vec2", ["target"]);
      return;
    case "event.shot":
      if (!isString(m.player)) throw new SpecValidationError("missing player", ["player"]);
      if (!isVec3(m.target)) throw new SpecValidationError("target must be Vec3", ["target"]);
      if (typeof m.on_target !== "boolean") throw new SpecValidationError("on_target must be bool", ["on_target"]);
      return;
    case "event.goal":
      if (!isString(m.player)) throw new SpecValidationError("missing player", ["player"]);
      if (!isString(m.team)) throw new SpecValidationError("missing team", ["team"]);
      return;
    case "event.tackle":
      if (!isString(m.player) || !isString(m.victim) || typeof m.success !== "boolean") {
        throw new SpecValidationError("tackle requires player, victim, success");
      }
      return;
    case "event.foul":
      if (!isString(m.player)) throw new SpecValidationError("missing player", ["player"]);
      if (m.severity !== "soft" && m.severity !== "yellow" && m.severity !== "red") {
        throw new SpecValidationError("invalid severity", ["severity"]);
      }
      return;
    case "event.save":
      if (!isString(m.keeper)) throw new SpecValidationError("missing keeper", ["keeper"]);
      return;
    case "event.out_of_bounds":
      if (!["throw_in", "corner", "goal_kick", "free_kick", "penalty"].includes(String(m.restart))) {
        throw new SpecValidationError("invalid restart", ["restart"]);
      }
      return;
    case "event.substitution":
      if (!isString(m.team) || !isString(m.player_in) || !isString(m.player_out)) {
        throw new SpecValidationError("substitution requires team, player_in, player_out");
      }
      return;
    case "event.score_change":
      if (!isNonNegativeInt(m.home) || !isNonNegativeInt(m.away)) {
        throw new SpecValidationError("score_change requires non-negative integer home/away");
      }
      return;
    case "event.period_start":
    case "event.period_end":
      if (typeof m.period !== "number" || !Number.isFinite(m.period) || m.period < 1) {
        throw new SpecValidationError("period must be >= 1", ["period"]);
      }
      return;
    case "event.match_end":
    case "event.penalty_shootout_start":
      return;
    case "event.penalty_attempt":
      if (!isString(m.player) || !isString(m.team)) {
        throw new SpecValidationError("penalty_attempt requires player and team");
      }
      if (!["scored", "missed", "saved"].includes(String(m.outcome))) {
        throw new SpecValidationError("invalid penalty_attempt outcome", ["outcome"]);
      }
      return;
    case "event.penalty_shootout_end":
      if (!isString(m.winner)) throw new SpecValidationError("missing winner", ["winner"]);
      return;
    case "event.commentary":
      if (!isString(m.text)) throw new SpecValidationError("missing text", ["text"]);
      return;
    default:
      throw new SpecValidationError(`unknown event type: ${type}`, ["type"]);
  }
}
