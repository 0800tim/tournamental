/**
 * SimulatedSports canonical message spec — v0.1
 *
 * Three message kinds flow over a single ordered stream:
 *   1. MatchInit  — sent once at stream start; static scene description.
 *   2. StateFrame — sent at 10–30 Hz; positions of all players + ball.
 *   3. EventMessage — irregular; discrete game events that drive animations
 *      and HUD updates (passes, shots, goals, fouls, etc).
 *
 * Coordinate system:
 *   Origin at pitch centre. +x along the long axis (toward team[1]'s goal
 *   in soccer/rugby/AF; toward team[1]'s basket in basketball). +y along
 *   the short axis. +z = height above ground. Units are metres unless
 *   `field.units` says otherwise. Distances use the same units throughout
 *   a stream.
 *
 * Time:
 *   `t` on every frame and event is integer milliseconds since the
 *   MatchInit was emitted. Use this for interpolation, not wall clock.
 *
 * Stability:
 *   Player IDs are stable strings unique within a match (e.g. "P_HAALAND",
 *   or a UUID). They are NOT jersey numbers — those change. Team IDs are
 *   stable strings unique within a match. The two team IDs in the array
 *   define "team 0" and "team 1" everywhere else in the stream.
 */

export const SPEC_VERSION = "0.1.1" as const;

// ---------- primitives ----------

export type Vec2 = [number, number];           // x, y
export type Vec3 = [number, number, number];   // x, y, z

export type Sport =
  | "soccer"
  | "rugby_union"
  | "rugby_league"
  | "basketball"
  | "american_football"
  | "australian_rules"
  | "field_hockey";

export type Units = "m" | "ft";

/**
 * The minimal set of animation tags every renderer must support. Any
 * world is free to interpret these stylistically (a low-poly fox running
 * looks different from a photoreal human running) but the semantics must
 * match. Renderers MAY accept additional vendor-prefixed tags, e.g.
 * "x_breakdance", and SHOULD fall back to the closest standard tag.
 */
export type AnimTag =
  | "idle"
  | "walk"
  | "run"
  | "sprint"
  | "kick"
  | "pass"
  | "header"
  | "shoot"
  | "tackle"
  | "fall"
  | "celebrate"
  | "throw"
  | "catch"
  | "dribble"
  | "jump";

// ---------- static (MatchInit) ----------

export interface FieldSpec {
  /** Length along the +x axis. */
  length: number;
  /** Width along the +y axis. */
  width: number;
  units: Units;
  /** Optional surface hint — affects shader/material in some renderers. */
  surface?: "grass" | "synthetic" | "court" | "clay" | "ice";
}

export interface Kit {
  /** CSS hex string, e.g. "#6CABDD". */
  primary: string;
  secondary: string;
  /** Number/text colour on the jersey. Defaults to white if omitted. */
  text?: string;
  /** Goalkeeper / outlier kit override, if relevant. */
  goalkeeper?: { primary: string; secondary: string; text?: string };
}

export interface Player {
  /** Stable string ID for the duration of the match. */
  id: string;
  name: string;
  /** Jersey number AT MATCH START. May change on substitution; renderers
   *  should listen for `event.substitution` rather than caching this. */
  number: number;
  /** Sport-specific role tag, e.g. "GK", "ST", "PG", "QB". Free-form. */
  position: string;
  /** Optional GLB asset URL — full 3D character. Renderer falls back to
   *  procedural avatar if missing. */
  avatar_uri?: string;
  /** Optional 2D face image URL — used for billboard-faced procedural
   *  avatars. PNG with transparent background recommended. */
  face_uri?: string;
  /** Optional Ready Player Me avatar ID, e.g. "65f1...glb". */
  rpm_avatar_id?: string;
  /** Free-form metadata pass-through (height, age, club, etc). */
  meta?: Record<string, string | number>;
}

export interface Team {
  id: string;
  name: string;
  short_name?: string;
  kit: Kit;
  players: Player[];
}

export interface MatchInit {
  type: "match.init";
  spec_version: string;
  match_id: string;
  sport: Sport;
  field: FieldSpec;
  /** Always two teams; index 0 defends the −x goal, index 1 defends +x. */
  teams: [Team, Team];
  /** ISO 8601 wall-clock start time. Renderer uses this only for HUD. */
  start_time: string;
  venue?: string;
  competition?: string;
  /** Origin/producer identity, e.g. "mock-v1", "video-ingest-v0.3". */
  producer?: string;
}

// ---------- continuous (StateFrame) ----------

export interface PlayerState {
  id: string;
  pos: Vec2;
  /** Yaw in radians, 0 = +x, π/2 = +y. */
  facing: number;
  anim: AnimTag;
  /** True if this player currently has the ball. At most one per frame. */
  has_ball?: boolean;
  /** Optional, for renderers that want to skin a "tired" effect. 0..1 */
  fatigue?: number;
}

export interface BallState {
  pos: Vec3;
  /** Velocity in units/second. Optional but recommended for nicer
   *  client-side interpolation between frames. */
  vel?: Vec3;
  /** Player ID currently carrying the ball, if any. Mirrors PlayerState
   *  `has_ball` for convenience. */
  carrier?: string;
}

export interface StateFrame {
  type: "state";
  /** ms since match.init. */
  t: number;
  ball: BallState;
  players: PlayerState[];
  /** Optional. Period number — 1, 2 (HT), 3 (ET1), etc. */
  period?: number;
  /** Optional. Game clock display (sport-specific format). */
  clock_display?: string;
}

// ---------- discrete (events) ----------

interface EventBase {
  /** ms since match.init. */
  t: number;
}

export type EventMessage =
  | (EventBase & { type: "event.kickoff"; team: string })
  | (EventBase & { type: "event.pass"; from: string; to?: string; target: Vec2; success?: boolean })
  | (EventBase & { type: "event.shot"; player: string; target: Vec3; on_target: boolean; saved?: boolean })
  | (EventBase & { type: "event.goal"; player: string; team: string; assist?: string })
  | (EventBase & { type: "event.tackle"; player: string; victim: string; success: boolean })
  | (EventBase & { type: "event.foul"; player: string; victim?: string; severity: "soft" | "yellow" | "red" })
  | (EventBase & { type: "event.save"; keeper: string })
  | (EventBase & { type: "event.out_of_bounds"; touched_by?: string; restart: "throw_in" | "corner" | "goal_kick" | "free_kick" | "penalty" })
  | (EventBase & { type: "event.substitution"; team: string; player_in: string; player_out: string })
  | (EventBase & { type: "event.score_change"; home: number; away: number })
  | (EventBase & { type: "event.period_start"; period: number })
  | (EventBase & { type: "event.period_end"; period: number })
  | (EventBase & { type: "event.match_end" })
  /** Penalty shoot-out (knockout cup matches). Added in v0.1.1 for AR-FR demo. */
  | (EventBase & { type: "event.penalty_shootout_start" })
  | (EventBase & {
      type: "event.penalty_attempt";
      player: string;
      team: string;
      outcome: "scored" | "missed" | "saved";
      keeper?: string;
      target?: Vec3;
    })
  | (EventBase & {
      type: "event.penalty_shootout_end";
      winner: string;                                   // team id
      score: { home: number; away: number };
    })
  /** Free-form commentary anchor for HUD ticker / TTS. */
  | (EventBase & { type: "event.commentary"; text: string; speaker?: string; voice_id?: string });

// ---------- envelope ----------

export type Message = MatchInit | StateFrame | EventMessage;

/**
 * Type guard helpers — exported for renderer convenience.
 */
export const isMatchInit = (m: Message): m is MatchInit => m.type === "match.init";
export const isStateFrame = (m: Message): m is StateFrame => m.type === "state";
export const isEvent = (m: Message): m is EventMessage => m.type.startsWith("event.");
