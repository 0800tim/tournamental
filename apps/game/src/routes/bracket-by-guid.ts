/**
 * GET /v1/bracket/by-guid/:guid — public bracket lookup by share guid.
 *
 * Powers the `/s/<guid>` universal share-landing route in apps/web.
 * Anyone with the URL can resolve it — share links are public by
 * design (think Twitter / X public-tweet visibility).
 *
 * The default response is intentionally narrow: champion + podium +
 * path to gold + locked-at. Pass `?include=payload` to additionally
 * return the full persisted `Bracket` JSON — used by the share page's
 * embedded 3D molecule scene, which renders the saved picks in
 * read-only mode. Anyone with the share URL is already allowed to see
 * the full prediction (the molecule reveals every pick), so the
 * privacy surface of the opt-in payload field matches the rest of the
 * landing.
 *
 * Caching: `public, s-maxage=60, stale-while-revalidate=600`. The
 * bracket can change on every save, but a 60-second edge cache makes
 * re-shares (the common case — a single tweet that thousands of people
 * click) cheap. SWR=600 keeps the previous response warm for ten
 * minutes after a revalidation kicks off.
 *
 * Resolution of the champion / podium / path:
 *   - Primary: run the full `@tournamental/bracket-engine` cascade against
 *     the canonical FIFA WC 2026 fixture set. This works for every
 *     bracket saved by the live web client, whose `knockoutPredictions`
 *     keys are canonical fixture ids (`r32_01`, `qf_01`, `final`).
 *   - Fallback: legacy ISO-token regex (`qf_ARG_NED` -> ARG vs NED).
 *     Kept for unit tests and any hypothetical pre-cascade ids.
 */

import type { FastifyInstance } from "fastify";

import { loadFixtures2026, type Tournament } from "@tournamental/bracket-engine";

import type { GameStore } from "../store/db.js";
import type { Bracket } from "../types.js";
import type { MatchPrediction } from "@tournamental/bracket-engine";
import { resolveUserId as resolveCallerId } from "./identity.js";

import {
  resolveCascadeForSummary,
  summariseFromCascade,
  type KnockoutPathEntry,
} from "./bracket-cascade-summary.js";

export type { KnockoutPathEntry } from "./bracket-cascade-summary.js";

/**
 * SEC-BRK-05 / SEC-BRK-06: the public-by-design response shape does
 * NOT carry `user_id`. Exposing the raw auth-sms user id here would
 * (a) leak the canonical ID for every shared bracket and (b) feed
 * the `/v1/bracket/by-guid/<user_id>` enumeration chain that lets
 * any guid lookup pivot to "latest bracket by this user". An opaque
 * `user_handle` carries the UX-facing display name when one exists
 * (currently always null until the handles table lands).
 */
export interface BracketByGuidPayload {
  readonly share_guid: string;
  readonly user_handle: string | null;
  readonly tournament_id: string;
  readonly champion_code: string | null;
  readonly runner_up_code: string | null;
  readonly third_place_code: string | null;
  readonly knockout_path: ReadonlyArray<KnockoutPathEntry>;
  readonly locked_at: string | null;
  /**
   * Full persisted bracket payload — only included when the caller
   * passes `?include=payload` AND is authenticated as the bracket
   * owner (SEC-BRK-05). The share-landing page uses this to drive
   * the read-only 3D molecule embed underneath the podium card.
   */
  readonly payload?: Bracket;
}

// ---- Legacy ISO-token extractor (fallback for non-canonical ids) ----
//
// Some test fixtures use match ids like `final_ARG_FRA` whose tokens
// embed the combatants directly. Those ids aren't in the canonical
// tournament fixture set so the cascade can't resolve them. We keep
// the regex extractor as a fallback so the existing public-API tests
// (and any hypothetical hand-rolled bracket) still surface a champion.

const STAGE_PREFIXES: ReadonlyArray<{
  stage: KnockoutPathEntry["stage"];
  test: (id: string) => boolean;
}> = [
  { stage: "final", test: (id) => /^(?:f|final)(?:[_:\-]|$)/i.test(id) },
  { stage: "sf", test: (id) => /^(?:sf|semi)(?:[_:\-]|$)/i.test(id) },
  { stage: "qf", test: (id) => /^(?:qf|quart)(?:[_:\-]|$)/i.test(id) },
  { stage: "r16", test: (id) => /^(?:r16|round-?16)(?:[_:\-]|$)/i.test(id) },
  { stage: "r32", test: (id) => /^(?:r32|round-?32)(?:[_:\-]|$)/i.test(id) },
];

function legacyStageFor(matchId: string): KnockoutPathEntry["stage"] | null {
  for (const s of STAGE_PREFIXES) {
    if (s.test(matchId)) return s.stage;
  }
  return null;
}

function pickWinner(p: MatchPrediction): "home" | "away" | null {
  if (p.outcome === "home_win") return "home";
  if (p.outcome === "away_win") return "away";
  return null;
}

function teamsInMatchId(matchId: string): string[] {
  return matchId.split(/[_:\-]/).filter((t) => /^[A-Z]{3}$/.test(t));
}

function summariseLegacyIds(bracket: Bracket): {
  champion_code: string | null;
  runner_up_code: string | null;
  third_place_code: string | null;
  knockout_path: KnockoutPathEntry[];
} {
  const byStage: Record<string, MatchPrediction[]> = {
    final: [],
    sf: [],
    qf: [],
    r16: [],
    r32: [],
  };

  for (const pred of Object.values(bracket.knockoutPredictions ?? {})) {
    const stage = legacyStageFor(pred.matchId);
    if (!stage) continue;
    const arr = byStage[stage];
    if (arr) arr.push(pred);
  }

  for (const arr of Object.values(byStage)) {
    arr.sort((a, b) => {
      const al = Date.parse(a.lockedAt ?? "");
      const bl = Date.parse(b.lockedAt ?? "");
      return (Number.isNaN(bl) ? 0 : bl) - (Number.isNaN(al) ? 0 : al);
    });
  }

  const finalPick = byStage.final?.[0] ?? null;
  const sfPick = byStage.sf?.[0] ?? null;
  const qfPick = byStage.qf?.[0] ?? null;
  const r16Pick = byStage.r16?.[0] ?? null;
  const r32Pick = byStage.r32?.[0] ?? null;

  function winnerCode(p: MatchPrediction | null): string | null {
    if (!p) return null;
    const teams = teamsInMatchId(p.matchId);
    if (teams.length !== 2) return null;
    const side = pickWinner(p);
    if (side === "home") return teams[0] ?? null;
    if (side === "away") return teams[1] ?? null;
    return null;
  }

  function loserCode(p: MatchPrediction | null): string | null {
    if (!p) return null;
    const teams = teamsInMatchId(p.matchId);
    if (teams.length !== 2) return null;
    const side = pickWinner(p);
    if (side === "home") return teams[1] ?? null;
    if (side === "away") return teams[0] ?? null;
    return null;
  }

  const champion_code = winnerCode(finalPick);
  const runner_up_code = loserCode(finalPick);

  let third_place_code: string | null = null;
  for (const pred of Object.values(bracket.knockoutPredictions ?? {})) {
    if (/^(?:tp|third)/i.test(pred.matchId)) {
      third_place_code = winnerCode(pred);
      break;
    }
  }

  const knockout_path: KnockoutPathEntry[] = (
    [
      { stage: "r32" as const, pick: r32Pick },
      { stage: "r16" as const, pick: r16Pick },
      { stage: "qf" as const, pick: qfPick },
      { stage: "sf" as const, pick: sfPick },
      { stage: "final" as const, pick: finalPick },
    ]
  ).map(({ stage, pick }) => {
    if (!pick) {
      return { stage, opponent_code: null, result: "tbd" as const };
    }
    const opponent = loserCode(pick);
    if (!opponent) {
      return { stage, opponent_code: null, result: "tbd" as const };
    }
    return { stage, opponent_code: opponent, result: "win" as const };
  });

  return { champion_code, runner_up_code, third_place_code, knockout_path };
}

/**
 * Cascade-first summariser. Tries the canonical fixture set first
 * (handles every bracket saved by the live web client) and falls back
 * to the ISO-token regex for legacy / synthetic ids.
 */
function summariseBracket(
  bracket: Bracket,
  tournament: Tournament,
): {
  champion_code: string | null;
  runner_up_code: string | null;
  third_place_code: string | null;
  knockout_path: KnockoutPathEntry[];
} {
  // Try the cascade first. For real brackets saved by the web client
  // it resolves every slot. For test / synthetic brackets with
  // ISO-encoded matchIds (no canonical fixture match) the cascade
  // returns null and we fall through to the regex extractor.
  const cascaded = resolveCascadeForSummary(tournament, bracket);
  const cascadeSummary = summariseFromCascade(cascaded);
  if (cascadeSummary.champion_code) return cascadeSummary;
  return summariseLegacyIds(bracket);
}

export interface BracketByGuidRoutesDeps {
  readonly store: GameStore;
}

const CACHE_HEADER = "public, s-maxage=60, stale-while-revalidate=600";

// Loaded once at module scope: the canonical fixture set is read-only
// and ~100KB of JSON; we don't need to re-parse it per request.
const FIXTURES_2026: Tournament = loadFixtures2026();

export async function registerBracketByGuidRoutes(
  app: FastifyInstance,
  deps: BracketByGuidRoutesDeps,
): Promise<void> {
  app.get("/v1/bracket/by-guid/:guid", async (req, reply) => {
    const params = req.params as { guid?: string };
    const query = req.query as { include?: string };
    const guid = (params.guid ?? "").trim();
    const includePayload = (query.include ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .includes("payload");

    if (!guid || guid.length < 8 || guid.length > 64) {
      reply.header("Cache-Control", CACHE_HEADER);
      return reply.code(404).send({ ok: false, error: "not_found" });
    }

    // SEC-BRK-05: the legacy "guid looks like a user id → fall through
    // to that user's latest bracket" path enabled a public lookup by
    // raw auth-sms user_id (`/v1/bracket/by-guid/u_<hex>`), which was
    // the second half of the bracket-payload enumeration vector. Only
    // resolve by the explicit `share_guid` column. The web client now
    // mints + persists a stable share_guid for every signed-in user
    // (handled by the WEB side; the share-link UX is unchanged).
    const row = deps.store.getBracketByShareGuid(guid);
    if (!row) {
      reply.header("Cache-Control", CACHE_HEADER);
      return reply.code(404).send({ ok: false, error: "not_found" });
    }

    let payload: Bracket;
    try {
      payload = JSON.parse(row.payload_json) as Bracket;
    } catch {
      // Corrupt payload — surface as 404 to the public so we don't leak
      // an internal-server-error to a share recipient. The bracket
      // owner can re-save to repair their row.
      reply.header("Cache-Control", CACHE_HEADER);
      return reply.code(404).send({ ok: false, error: "not_found" });
    }

    // SEC-BRK-05: `include=payload` reveals every group + knockout
    // pick. That's "public" by design only for the bracket owner —
    // anyone else gets the metadata-only response (champion + podium
    // + knockout path). The owner check resolves the caller's
    // identity via the same path the bracket-submit handler uses
    // (tnm_session cookie / Bearer JWT / dev-fallback header).
    let payloadAllowed = false;
    if (includePayload) {
      const callerId = resolveCallerId(req, {
        devAuth: process.env.GAME_DEV_AUTH === "1",
        jwtSecret: process.env.SUPABASE_JWT_SECRET ?? null,
        authSmsJwtSecret: process.env.AUTH_JWT_SECRET ?? null,
      });
      if (callerId && callerId === row.user_id) {
        payloadAllowed = true;
      }
    }

    // Pick the right tournament fixture set. For 2026 we have one; if
    // the bracket was saved against an unknown id, fall back to the
    // canonical set so the regex path still gets a shot.
    const tournament =
      row.tournament_id === FIXTURES_2026.id ? FIXTURES_2026 : FIXTURES_2026;

    const summary = summariseBracket(payload, tournament);

    const body: { ok: true; bracket: BracketByGuidPayload } = {
      ok: true,
      bracket: {
        share_guid: row.share_guid ?? guid,
        // SEC-BRK-05 / SEC-BRK-06: never echo `user_id` to the public.
        // `user_handle` is reserved for a future display-name lookup
        // (handles table) — null until that ships.
        user_handle: null,
        tournament_id: row.tournament_id,
        champion_code: summary.champion_code,
        runner_up_code: summary.runner_up_code,
        third_place_code: summary.third_place_code,
        knockout_path: summary.knockout_path,
        locked_at: row.locked_at ? new Date(row.locked_at).toISOString() : null,
        ...(payloadAllowed ? { payload } : {}),
      },
    };

    // SEC-BRK-05: when payload is included we return a per-user view
    // and must NOT let it land on the public edge cache. Without the
    // payload the response is purely public-share metadata and the
    // 60s edge cache is fine.
    if (payloadAllowed) {
      reply.header("Cache-Control", "private, no-store");
    } else {
      reply.header("Cache-Control", CACHE_HEADER);
    }

    return reply.code(200).send(body);
  });
}
