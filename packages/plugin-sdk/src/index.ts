/**
 * @tournamental/plugin-sdk
 *
 * Types and helpers for authoring Tournamental plugins. A plugin is a
 * regular npm package that ships under the `@tournamental-plugin/*` scope
 * (or a local `plugins/` directory for dev), declares one or more
 * capabilities in its `plugin.json`, and exports a default factory that
 * the core's plugin loader picks up at app boot.
 *
 * Full architecture: `docs/28-plugin-architecture.md`.
 * Contributor revenue split: `docs/19-open-source-and-contributor-revenue.md`.
 *
 * Eight extension points, mirroring `manifest.ts`:
 *
 *   renderer            : replace `MatchScene` / scene-graph (docs/04)
 *   scorer              : supply an alternative scoring formula (docs/16)
 *   ingestSource        : emit spec-conformant event streams (docs/02, docs/11)
 *   identityProvider    : alternative auth (docs/20, docs/32)
 *   commentaryProvider  : alternative TTS / writer / language (docs/31)
 *   shareCardRenderer   : alternative OG card pipeline (`packages/social-cards`)
 *   oddsSource          : alternative odds feed (docs/12, docs/29)
 *   affiliateRouter     : alternative routing + revshare logic (docs/18)
 *
 * Every plugin interface here is small and pure-ish. The core does
 * NOT pass the plugin its DB connection, secrets, or session. If a
 * plugin needs side-effects (network, disk, audio) it asks for an
 * explicit capability via the `permissions` array in the manifest
 * and the core surfaces a sandboxed helper in the `PluginContext`.
 */

import type {
  AnimTag,
  BallState,
  EventMessage,
  MatchInit,
  Message,
  PlayerState,
  StateFrame,
  Team,
} from "@tournamental/spec";

// Re-export spec primitives so plugins only need this one dependency
// in their package.json. Keeps `pnpm create @tournamental/plugin` output
// minimal.
export type {
  AnimTag,
  BallState,
  EventMessage,
  MatchInit,
  Message,
  PlayerState,
  StateFrame,
  Team,
} from "@tournamental/spec";

// ---------- common ----------

/**
 * Carried through every plugin call. Loaded once at app boot and
 * passed to the factory the plugin's default export returns.
 *
 * The core wires concrete implementations of `log`, `cache`, and
 * `fetch` (sandboxed `fetch` honouring the manifest's
 * `permissions.network` allow-list).
 */
export interface PluginContext {
  /** Plugin's own logger; tagged with `pluginName` for filtering. */
  readonly log: {
    debug(msg: string, fields?: Record<string, unknown>): void;
    info(msg: string, fields?: Record<string, unknown>): void;
    warn(msg: string, fields?: Record<string, unknown>): void;
    error(msg: string, fields?: Record<string, unknown>): void;
  };
  /** Per-plugin namespaced cache. Backed by Redis in prod, in-memory in dev. */
  readonly cache: {
    get<T = unknown>(key: string): Promise<T | null>;
    set<T = unknown>(key: string, value: T, ttlSeconds?: number): Promise<void>;
    del(key: string): Promise<void>;
  };
  /**
   * Sandboxed fetch. Only resolves URLs matching the manifest's
   * `permissions.network` patterns; otherwise rejects with `PluginError`.
   */
  readonly fetch: typeof fetch;
  /** The plugin's name from its manifest. Useful for log lines. */
  readonly pluginName: string;
  /** The core's semantic version at boot, for capability gating. */
  readonly coreVersion: string;
}

/**
 * Errors thrown across the plugin boundary use this class so the
 * core's plugin loader can distinguish "plugin misbehaved" from
 * "core bug" in error reporting and Sentry breadcrumbs.
 */
export class PluginError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "PluginError";
    this.code = code;
  }
}

/**
 * Discriminator for capabilities a plugin can `provides`.
 */
export type PluginCapability =
  | "renderer"
  | "scorer"
  | "ingestSource"
  | "identityProvider"
  | "commentaryProvider"
  | "shareCardRenderer"
  | "oddsSource"
  | "affiliateRouter";

/**
 * The shape every plugin's default export must return. The factory
 * runs once at app boot. It MUST be cheap; heavy initialisation
 * goes inside an extension method (`renderer.mount`, `ingestSource.start`,
 * etc.) so a failing plugin can't slow boot.
 */
export interface Plugin {
  /** Mirrors the manifest's `name` for runtime identification. */
  readonly name: string;
  /** Mirrors the manifest's `version`. */
  readonly version: string;
  /** Which extension points this plugin fills. */
  readonly provides: readonly PluginCapability[];

  /** Optional per-capability implementations. Present iff `provides` lists it. */
  readonly renderer?: RendererPlugin;
  readonly scorer?: ScorerPlugin;
  readonly ingestSource?: IngestPlugin;
  readonly identityProvider?: IdentityPlugin;
  readonly commentaryProvider?: CommentaryPlugin;
  readonly shareCardRenderer?: ShareCardPlugin;
  readonly oddsSource?: OddsSourcePlugin;
  readonly affiliateRouter?: AffiliateRouterPlugin;
}

/** The default-export shape from a plugin's entry file. */
export type PluginFactory = (ctx: PluginContext) => Plugin | Promise<Plugin>;

// ---------- renderer ----------

/**
 * Renderer plugin. The core mounts ONE renderer per session; if more
 * than one is enabled, the user-selected one wins (URL `?renderer=` or
 * settings). Falls back to `@tournamental/renderer-default` (the R3F
 * renderer in `apps/web/components/MatchScene.tsx`) if the selected
 * plugin throws on mount.
 *
 * Plugged in at: `apps/web/components/MatchScene.tsx`. The core wraps
 * the plugin in a React error boundary and remounts the fallback on
 * error.
 *
 * Determinism: NOT required. Renderers are visual; same input may
 * yield different pixels. Renderers MUST be idempotent on remount
 * (no global side-effects, no DOM-outside-container writes).
 */
export interface RendererPlugin {
  /**
   * Human-readable label shown in the renderer-picker UI. e.g.
   * "Cel-shaded (toon)", "Photoreal", "Top-down 2D".
   */
  readonly label: string;

  /**
   * Optional capability flags the core consults to decide whether
   * this renderer can be offered for a given match. Defaults all
   * `true` if omitted.
   */
  readonly supports?: {
    sport?: ReadonlyArray<"soccer" | "rugby_union" | "rugby_league" | "basketball" | "american_football" | "australian_rules" | "field_hockey">;
    /** Web XR-ready (VR/AR). */
    xr?: boolean;
    /** Headless render (clip pipeline; see docs/14). */
    headless?: boolean;
  };

  /**
   * Mount the scene-graph into the given DOM container. The host
   * has already created and sized the container. Returns a handle
   * the host calls to update / unmount.
   */
  mount(container: HTMLElement, init: MatchInit, opts?: RendererMountOpts): RendererHandle;
}

export interface RendererMountOpts {
  /**
   * Tournamental "quality" tier. See `apps/web/lib/quality.ts` for the
   * source of truth. Renderers should honour this for LOD selection
   * and post-FX gating.
   */
  quality?: "low" | "med" | "high" | "ultra";
  /** Force a fixed pixel ratio. Useful for headless clip rendering. */
  pixelRatio?: number;
}

export interface RendererHandle {
  /** Feed a new state frame. Called at the stream's tick rate (10–30 Hz). */
  pushFrame(frame: StateFrame): void;
  /** Feed an event. Called whenever the producer emits an `event.*` message. */
  pushEvent(event: EventMessage): void;
  /** Tear the renderer down and free GPU resources. */
  dispose(): void;
}

// ---------- scorer ----------

/**
 * Scorer plugin. Replaces or augments the canonical scoring formula
 * defined in `docs/16-game-modes-and-scoring.md` and implemented in
 * `packages/bracket-engine/src/score.ts`.
 *
 * Plugged in at: `apps/game/src/scoring.ts`. The core selects ONE
 * scorer per `gameMode`; mismatching scorers don't run.
 *
 * Determinism: REQUIRED. Same `(bracket, results, opts)` MUST always
 * produce the same `PointsBreakdown`. Pure function; no clock reads,
 * no randomness. Replayable for any past prediction.
 *
 * Idempotency: REQUIRED. Calling `score()` repeatedly with the same
 * input has no side-effects and returns identical output.
 */
export interface ScorerPlugin {
  readonly label: string;

  /**
   * Which game mode(s) this scorer is responsible for. See `docs/16`
   * for the canonical list. A plugin scoping itself to e.g. `bracket`
   * only will not be considered for `match_minutes` or `pre_match`.
   */
  readonly modes: ReadonlyArray<
    | "full_tournament_prophet"
    | "bracket"
    | "pre_match"
    | "match_minutes"
    | "syndicate"
    | "campaign"
    | "free_kick"
    | "penalty"
    | "long_shot"
    | "custom"
  >;

  score: ScoreFn;
}

export type ScoreFn = (
  bracket: ScorerBracket,
  results: ScorerResults,
  opts: ScorerOpts
) => PointsBreakdown;

export interface ScorerBracket {
  readonly bracketId: string;
  readonly userId: string;
  readonly mode: ScorerPlugin["modes"][number];
  readonly predictions: ReadonlyArray<ScorerPrediction>;
}

export interface ScorerPrediction {
  readonly matchId: string;
  readonly outcome: "home_win" | "draw" | "away_win" | string;
  readonly confidence?: 1 | 2 | 3 | 4 | 5;
  /** Locked unix millis. */
  readonly lockedAtMs: number;
  /** Market-implied probability for the locked outcome at lock time. */
  readonly marketImpliedAtLock?: number;
  /** Stage of the tournament this fixture belongs to. */
  readonly stage?: "group" | "r32" | "r16" | "qf" | "sf" | "tp" | "f";
}

export interface ScorerResults {
  /** Actual outcome per matchId. Missing → match not yet settled. */
  readonly actual: Readonly<Record<string, string | undefined>>;
  /** Optional kick-off timestamp per matchId (for the time multiplier). */
  readonly kickoffMs?: Readonly<Record<string, number>>;
}

export interface ScorerOpts {
  /** User's current correct-pick streak at the time of this batch. */
  readonly streak?: number;
  /** Override the mode-multiplier table; rarely used. */
  readonly modeMultiplierOverride?: number;
}

/**
 * Output of a `ScoreFn`. The total is the sum across all predictions;
 * the `perPrediction` map is what the leaderboard and the user's
 * History view render line-by-line.
 */
export interface PointsBreakdown {
  readonly total: number;
  readonly perPrediction: Readonly<
    Record<
      string,
      {
        readonly points: number;
        readonly base: number;
        readonly multipliers: Readonly<Record<string, number>>;
      }
    >
  >;
}

// ---------- ingestSource ----------

/**
 * Ingest source plugin. A producer that emits a spec-conformant
 * stream from any data source: StatsBomb open data, a live tracking
 * feed, a video-CV pipeline (docs/06), a video game's telemetry, a
 * gym tournament's Google Sheet.
 *
 * Plugged in at: `apps/stream-server/src/sources/`. The stream server
 * lists installed ingest plugins on its admin endpoint, the operator
 * picks one per match.
 *
 * Determinism: NOT required (live feeds aren't replayable). Replay
 * sources (StatsBomb, recorded matches) SHOULD be deterministic given
 * the same `(matchId, timeScale, seed)`.
 *
 * Backpressure: the plugin MUST respect `subscriber.pause()` /
 * `subscriber.resume()`; the stream server will pause it when no
 * downstream subscribers are listening.
 */
export interface IngestPlugin {
  readonly label: string;

  /** Stable id for the URL the stream server exposes (e.g. `statsbomb-replay`). */
  readonly id: string;

  /**
   * Discover available matches. Optional; only populated for replay
   * sources (StatsBomb, recorded matches). Live feeds return `[]` and
   * the operator passes the match id via `start()` opts.
   */
  listAvailableMatches?(): Promise<IngestMatchDescriptor[]>;

  /**
   * Start emitting messages. The subscriber the core hands you is
   * the only output channel; do not write anywhere else.
   */
  start(opts: IngestStartOpts, subscriber: IngestSubscriber): Promise<IngestSession>;
}

export interface IngestMatchDescriptor {
  readonly matchId: string;
  readonly label: string;
  readonly startsAtMs?: number;
  readonly sport: MatchInit["sport"];
}

export interface IngestStartOpts {
  readonly matchId: string;
  /** Speed factor (1.0 = real-time; 10.0 = 10x for the AR-FR demo). */
  readonly timeScale?: number;
  /** Optional deterministic seed for synthetic data. */
  readonly seed?: number;
}

export interface IngestSubscriber {
  push(msg: Message): void;
  paused: boolean;
  /** Signal that no more messages will be emitted; closes the stream. */
  end(): void;
}

export interface IngestSession {
  /** Stop emitting and free resources. */
  dispose(): Promise<void>;
}

// ---------- identityProvider ----------

/**
 * Identity provider plugin. Alternative to Tournamental's default
 * Supabase + Telegram + WhatsApp DM-OTP stack (docs/20, docs/32).
 *
 * Use cases: Discord-OAuth for a discord-native syndicate; Farcaster
 * for a crypto-native one; Sign-in-with-Ethereum for an SIWE-only
 * fork; ATProto for a Bluesky-native variant.
 *
 * Plugged in at: `apps/auth-sms/src/providers/` and surfaced in the
 * web app's login picker at `apps/web/components/auth/`.
 *
 * Security: the plugin is responsible for crypto and signature
 * verification. The core ONLY accepts the plugin's `Identity`
 * response over the SDK boundary, NEVER an opaque token. Reviewer
 * agent verifies the plugin's signature path on every PR.
 */
export interface IdentityPlugin {
  readonly label: string;
  /** Stable id used in the OAuth callback URL (e.g. `discord`, `farcaster`). */
  readonly id: string;

  /**
   * Return the URL the core should redirect the user to. Called when
   * a user clicks "Sign in with X" in the login picker.
   */
  buildAuthRedirect(opts: IdentityRedirectOpts): Promise<string>;

  /**
   * Verify a callback from the provider. Throws `PluginError` if the
   * callback is forged or stale. Returns a verified `Identity`.
   */
  verifyCallback(callback: IdentityCallback): Promise<Identity>;
}

export interface IdentityRedirectOpts {
  /** Opaque state to round-trip; the core validates it on callback. */
  readonly state: string;
  /** Where the provider should send the user after auth. */
  readonly redirectUri: string;
}

export interface IdentityCallback {
  readonly query: Readonly<Record<string, string>>;
  /** State the core gave to `buildAuthRedirect`; the plugin must round-trip-validate it. */
  readonly expectedState: string;
}

/**
 * The verified identity. The plugin asserts these fields are real;
 * the core stamps them into the user record. `providerUserId` is the
 * primary key on the plugin's side.
 */
export interface Identity {
  readonly providerId: string;
  readonly providerUserId: string;
  readonly displayName?: string;
  readonly avatarUrl?: string;
  /** Verified email if the provider returns one. */
  readonly email?: string;
  /** Verified phone if the provider returns one (E.164). */
  readonly phoneE164?: string;
  /** Wallet address if the provider is wallet-based (SIWE, Farcaster). */
  readonly walletAddress?: string;
}

// ---------- commentaryProvider ----------

/**
 * Commentary provider plugin. Generates the play-by-play that the
 * renderer's `CommentaryAudio` reads (docs/31). The default ships
 * ElevenLabs-driven NZ English. Plugin authors might write a tabloid
 * voice, a Spanish-language voice, a kid-friendly voice, etc.
 *
 * Plugged in at: `apps/web/components/CommentaryAudio.tsx`.
 *
 * Determinism: NOT required (TTS varies between calls). Text
 * generation SHOULD be deterministic given the same event for cache
 * hits.
 */
export interface CommentaryPlugin {
  readonly label: string;
  /** BCP-47 language tag (`en-NZ`, `es-AR`, `ja-JP`). */
  readonly locale: string;

  /**
   * Produce a short line of text for the given event. Return `null`
   * for events the plugin doesn't want to comment on (e.g. a Spanish
   * plugin returning null for low-importance throw-ins).
   */
  scriptFor(event: EventMessage, context: CommentaryContext): Promise<string | null>;

  /**
   * Convert a line of text to playable audio. Return a URL the
   * browser can `Audio.src =` (data URL, blob URL, signed CDN URL).
   */
  synthesize(text: string, voice?: string): Promise<{ url: string; durationMs: number }>;
}

export interface CommentaryContext {
  readonly matchInit: MatchInit;
  readonly scoreHome: number;
  readonly scoreAway: number;
  readonly minute: number;
}

// ---------- shareCardRenderer ----------

/**
 * Share-card renderer plugin. Replaces `packages/social-cards`'s
 * canvas-based OG image pipeline. Each card variant (match summary,
 * bracket reveal, leaderboard rank, syndicate result) is a separate
 * call.
 *
 * Plugged in at: `apps/web/app/api/og/route.ts` and the clip pipeline
 * `apps/clip-pipeline/src/cards.ts`.
 *
 * Determinism: SHOULD be deterministic for cache hits. A share-card
 * URL is cached on Cloudflare for 24h; a non-deterministic plugin
 * gets weird "card changed after share" behaviour.
 *
 * Idempotency: REQUIRED. Same input → same PNG bytes.
 */
export interface ShareCardPlugin {
  readonly label: string;
  /** Default 1200x630; OG card aspect ratio. */
  readonly dimensions?: { width: number; height: number };

  /**
   * Render a card of the given kind. Returns PNG bytes; the core
   * handles HTTP caching headers.
   */
  render(kind: ShareCardKind, payload: ShareCardPayload): Promise<Uint8Array>;
}

export type ShareCardKind =
  | "match_summary"
  | "bracket_reveal"
  | "leaderboard_rank"
  | "syndicate_result"
  | "prediction_iq"
  | "vstamp_receipt";

export interface ShareCardPayload {
  readonly title: string;
  readonly subtitle?: string;
  readonly stats?: ReadonlyArray<{ label: string; value: string }>;
  readonly accent?: string;
  /** Free-form bag for plugin-specific extras. */
  readonly extra?: Readonly<Record<string, unknown>>;
}

// ---------- oddsSource ----------

/**
 * Odds source plugin. Alternative to the built-in Polymarket + Odds
 * API ingest (docs/29). A bookmaker that doesn't have an Odds API
 * listing can be added by writing a plugin that scrapes its public
 * markets page (with respect to its ToS).
 *
 * Plugged in at: `apps/odds-ingest/src/sources/`. Multiple odds
 * sources can run in parallel; the core blends them per the
 * configured weights (docs/12).
 *
 * Determinism: NOT required (live feed). Plugin MUST NOT return
 * cached / stale data without flagging it via `staleness_seconds`.
 */
export interface OddsSourcePlugin {
  readonly label: string;
  readonly id: string;

  /**
   * Return implied probabilities for the given match. Probabilities
   * sum to 1.0 ± 0.02 (for vig). The core rejects bad sums.
   */
  fetchProbabilities(matchId: string): Promise<OddsSample | null>;
}

export interface OddsSample {
  readonly matchId: string;
  readonly outcomes: Readonly<Record<string, number>>;
  readonly fetchedAtMs: number;
  readonly stalenessSeconds: number;
  /** Provider's URL for human verification. */
  readonly providerUrl?: string;
}

// ---------- affiliateRouter ----------

/**
 * Affiliate router plugin. Alternative routing logic + revshare
 * split for affiliate clicks (docs/18, docs/30). The plugin author
 * negotiates their own deals; the core enforces geo-gating and the
 * Drips revshare contract (docs/19, docs/40).
 *
 * Plugged in at: `apps/affiliate-router/src/routers/`. Each plugin
 * registers under a route prefix; the core picks the plugin via
 * settings, region, and the user's opt-in flags.
 *
 * Determinism: REQUIRED. Same `(userId, partnerId, geoIso2)` MUST
 * route to the same destination during a session. Routing is
 * audit-logged (doc 30).
 *
 * Revshare: routes that earn revenue MUST commit to the same Drips
 * list reference as the core (docs/19). Different revshare → a
 * separate plugin, not a fork of this one.
 */
export interface AffiliateRouterPlugin {
  readonly label: string;
  readonly id: string;
  /** ISO-3166-1 alpha-2 country codes this router serves. */
  readonly geos: ReadonlyArray<string>;

  /**
   * Resolve an affiliate destination URL. Returns `null` if the
   * router declines the user (geo-gate, opt-in missing, etc.); the
   * core falls back to the next plugin or to the "no destination"
   * landing page.
   */
  resolveClick(input: AffiliateClickInput): Promise<AffiliateClickResult | null>;
}

export interface AffiliateClickInput {
  readonly userId: string;
  readonly partnerId: string;
  readonly geoIso2: string;
  readonly campaignId?: string;
  readonly bracketId?: string;
}

export interface AffiliateClickResult {
  readonly url: string;
  /** Stable id used in the audit log. */
  readonly clickId: string;
  /** Drips revshare reference. MUST match `docs/19`'s treasury for in-core plugins. */
  readonly dripsListRef?: string;
}

// ---------- manifest re-exports ----------

export type { PluginManifest, ManifestLicense } from "./manifest.js";
export { pluginManifestSchema, validateManifest, ALLOWED_LICENSES } from "./manifest.js";
