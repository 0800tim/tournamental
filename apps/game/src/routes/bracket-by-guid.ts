/**
 * GET /v1/bracket/by-guid/:guid — public bracket lookup by share guid.
 *
 * Powers the `/s/<guid>` universal share-landing route in apps/web.
 * Anyone with the URL can resolve it — share links are public by
 * design (think Twitter / X public-tweet visibility).
 *
 * The endpoint is intentionally narrow: it exposes only the fields the
 * share-landing page renders (champion + podium + path to gold) plus
 * the locked-at timestamp for the saved-at footer. No raw bracket
 * payload, no scoring data, no per-match picks — keep the public
 * surface minimal so future privacy controls (private-by-default
 * brackets, opt-out, etc.) can plug in here.
 *
 * Caching: `public, s-maxage=60, stale-while-revalidate=600`. The
 * bracket can change on every save, but a 60-second edge cache makes
 * re-shares (the common case — a single tweet that thousands of people
 * click) cheap. SWR=600 keeps the previous response warm for ten
 * minutes after a revalidation kicks off.
 *
 * Resolution of the optional `user_handle` and `knockout_path`:
 * - `user_handle` is null until the Supabase profiles layer is wired
 *   through. The share landing renders "@Anonymous" in that case.
 *   Once PR #138's user_profiles table lands, we'll join on it here.
 * - `knockout_path` walks the bracket's `knockoutPredictions` looking
 *   for matchIds whose tokens embed ISO team codes (the cascade
 *   produces ids like `qf_ARG_NED` for resolved knockouts). Rounds
 *   that aren't picked or that haven't been resolved by the cascade
 *   surface as `opponent_code: null, result: "tbd"`.
 */

import type { FastifyInstance } from "fastify";

import type { GameStore } from "../store/db.js";
import type { Bracket } from "../types.js";
import type { MatchPrediction } from "@vtorn/bracket-engine";

export interface KnockoutPathEntry {
  /** Stage label as the web client expects ("r16", "qf", "sf", "final"). */
  readonly stage: string;
  /** Opponent team code. Null when the prior round hasn't been picked. */
  readonly opponent_code: string | null;
  readonly result: "win" | "loss" | "tbd";
}

export interface BracketByGuidPayload {
  readonly share_guid: string;
  readonly user_handle: string | null;
  readonly tournament_id: string;
  readonly champion_code: string | null;
  readonly runner_up_code: string | null;
  readonly third_place_code: string | null;
  readonly knockout_path: ReadonlyArray<KnockoutPathEntry>;
  readonly locked_at: string | null;
}

// Stages we surface on the public share page. Any matchId that begins
// with one of the listed prefixes is bucketed into that stage,
// regardless of separator (`_`, `:`, `-`) or trailing tokens.
const STAGE_PREFIXES: ReadonlyArray<{
  stage: KnockoutPathEntry["stage"];
  test: (id: string) => boolean;
}> = [
  { stage: "final", test: (id) => /^(?:f|final)(?:[_:\-]|$)/i.test(id) },
  { stage: "sf", test: (id) => /^(?:sf|semi)(?:[_:\-]|$)/i.test(id) },
  { stage: "qf", test: (id) => /^(?:qf|quart)(?:[_:\-]|$)/i.test(id) },
  { stage: "r16", test: (id) => /^(?:r16|round-?16)(?:[_:\-]|$)/i.test(id) },
];

function stageFor(matchId: string): KnockoutPathEntry["stage"] | null {
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

/**
 * Compute champion / runner-up / third-place codes + the path-to-gold
 * from the bracket's knockoutPredictions. Best-effort — picks whose
 * matchIds don't embed ISO codes (e.g. plain numeric ids before the
 * cascade resolves them) surface as null.
 */
function summariseBracket(bracket: Bracket): {
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
  };

  for (const pred of Object.values(bracket.knockoutPredictions ?? {})) {
    const stage = stageFor(pred.matchId);
    if (!stage) continue;
    const arr = byStage[stage];
    if (arr) arr.push(pred);
  }

  // Most-recent pick wins for each stage in case there are multiple.
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

  // Third-place: pick from a tp/third-place fixture if present.
  let third_place_code: string | null = null;
  for (const pred of Object.values(bracket.knockoutPredictions ?? {})) {
    if (/^(?:tp|third)/i.test(pred.matchId)) {
      third_place_code = winnerCode(pred);
      break;
    }
  }

  // Champion's path: opponent at each round. If a round wasn't picked
  // (or doesn't embed team codes), surface TBD.
  const knockout_path: KnockoutPathEntry[] = (
    [
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

export interface BracketByGuidRoutesDeps {
  readonly store: GameStore;
}

const CACHE_HEADER = "public, s-maxage=60, stale-while-revalidate=600";

export async function registerBracketByGuidRoutes(
  app: FastifyInstance,
  deps: BracketByGuidRoutesDeps,
): Promise<void> {
  app.get("/v1/bracket/by-guid/:guid", async (req, reply) => {
    const params = req.params as { guid?: string };
    const guid = (params.guid ?? "").trim();
    reply.header("Cache-Control", CACHE_HEADER);

    if (!guid || guid.length < 8 || guid.length > 64) {
      return reply.code(404).send({ ok: false, error: "not_found" });
    }

    const row = deps.store.getBracketByShareGuid(guid);
    if (!row) {
      return reply.code(404).send({ ok: false, error: "not_found" });
    }

    let payload: Bracket;
    try {
      payload = JSON.parse(row.payload_json) as Bracket;
    } catch {
      // Corrupt payload — surface as 404 to the public so we don't leak
      // an internal-server-error to a share recipient. The bracket
      // owner can re-save to repair their row.
      return reply.code(404).send({ ok: false, error: "not_found" });
    }

    const summary = summariseBracket(payload);

    const body: { ok: true; bracket: BracketByGuidPayload } = {
      ok: true,
      bracket: {
        share_guid: row.share_guid ?? guid,
        user_handle: null,
        tournament_id: row.tournament_id,
        champion_code: summary.champion_code,
        runner_up_code: summary.runner_up_code,
        third_place_code: summary.third_place_code,
        knockout_path: summary.knockout_path,
        locked_at: row.locked_at ? new Date(row.locked_at).toISOString() : null,
      },
    };

    return reply.code(200).send(body);
  });
}
