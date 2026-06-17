/*
 * Copyright 2026 Tournamental
 * Apache 2.0 (see LICENSE).
 */

/**
 * GET /api/v1/syndicates/[slug]/picks-grid
 *
 * Owner-only. Returns a per-member, per-resulted-match correctness grid
 * for the pool-admin "Picks Grid" surface (Tim 2026-06-18, weekly
 * winning-streak prize tool). One row per pool member, one column per
 * resulted match. Each cell is `correct` (member's pick matched the
 * recorded outcome), `wrong` (pick did not match), `no_pick` (member
 * had no prediction for this match), or `skipped` (rare — bracket
 * payload missing). Sorted server-side by current-streak DESC, then
 * by total-correct DESC, then by join order ASC so the admin can spot
 * the prize winner without paging.
 *
 * Response shape:
 *
 *   {
 *     slug: string,
 *     fetched_at: number,
 *     tournament_id: string,
 *     matches: Array<{
 *       match_no: string,
 *       kickoff_utc: string,
 *       home_code: string | null,
 *       away_code: string | null,
 *       outcome: "home_win" | "draw" | "away_win",
 *     }>,
 *     members: Array<{
 *       user_id: string | null,
 *       handle: string,
 *       display_name: string | null,
 *       flag_emoji: string,
 *       picks: Array<"correct" | "wrong" | "no_pick">, // same order as matches[]
 *       correct_total: number,
 *       current_streak: number,    // streak of consecutive correct picks ending
 *                                    on the most recent resulted match
 *       best_streak: number,       // longest consecutive run of correct picks
 *                                    anywhere in the resulted set
 *     }>,
 *   }
 *
 * Auth: requires a valid tnm_session cookie AND ownership of the
 * syndicate (or super-admin). Mirrors the /owner gate exactly so the
 * same dashboard session that loads the manage view authorises this.
 *
 * Cache: private, no-store. Per-owner, mutable on every result.
 */

import type { NextRequest } from "next/server";

import { getSessionFromRequest } from "@/lib/auth/session";
import { isSuperAdmin } from "@/lib/auth/super-admin";
import { enrichSyndicateMembers } from "@/lib/syndicate/enrich-members";
import { getPersistence } from "@/lib/syndicate/persistence";
import { loadSyndicateBySlug } from "@/lib/syndicate/store";
import { loadFixtures2026 } from "@tournamental/bracket-engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface MatchRow {
  match_no: string;
  kickoff_utc: string;
  home_code: string | null;
  away_code: string | null;
  outcome: "home_win" | "draw" | "away_win";
}

interface MemberRow {
  user_id: string | null;
  handle: string;
  display_name: string | null;
  flag_emoji: string;
  picks: Array<"correct" | "wrong" | "no_pick">;
  correct_total: number;
  current_streak: number;
  best_streak: number;
}

function jsonResponse(body: unknown, status: number): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

export async function GET(
  req: NextRequest,
  props: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const params = await props.params;
  const slug = (params.slug ?? "").toLowerCase().trim();
  if (!slug) return jsonResponse({ error: "bad_slug" }, 400);

  const session = await getSessionFromRequest(req);
  if (!session) return jsonResponse({ error: "unauthorised" }, 401);

  const persistence = getPersistence();
  const synRow = persistence.getBySlug(slug);
  if (!synRow) return jsonResponse({ error: "not_found" }, 404);
  if (synRow.owner_user_id !== session.userId && !isSuperAdmin(session)) {
    return jsonResponse({ error: "forbidden" }, 403);
  }

  // Full syndicate (with members, enriched display_name / flag_emoji).
  const syndicate = await loadSyndicateBySlug(slug);
  if (!syndicate) return jsonResponse({ error: "not_found" }, 404);

  const tournamentId = syndicate.tournament_id;

  // Resulted matches, sorted by match_no ascending (chronological for
  // group stage; close enough for the knockout stage where the bracket
  // engine numbers in playing order). Also pulls kickoff + team codes
  // from the fixtures file so the client can render
  // "M19 · 17 Jun" column headers without a second fetch.
  const results = persistence.listRecordedMatchResultsForTournament(tournamentId);
  // Build a fixtures lookup the lazy way: for the only currently
  // supported tournament (fifa-wc-2026), load it inline. Any future
  // tournament needs a registry; for now keep the existing convention
  // since /s/<slug>/leaderboard does the same thing implicitly.
  const fixtures =
    tournamentId === "fifa-wc-2026" ? loadFixtures2026() : null;

  const fixtureByNo = new Map<
    string,
    {
      kickoff_utc: string;
      home_code: string | null;
      away_code: string | null;
    }
  >();
  if (fixtures) {
    // Map group fixtures: home_idx/away_idx → team codes via the group.
    // Group entities in the bracket-engine use `id` (not `group_id`) as
    // the GroupId key; group_fixtures separately carry `group_id` to
    // reference it. Names mismatch is historical (Tim 2026-05-22 spec).
    const groupTeams = new Map<string, readonly string[]>();
    for (const g of fixtures.groups) {
      groupTeams.set(g.id, g.team_ids ?? []);
    }
    for (const fx of fixtures.group_fixtures) {
      const teams = groupTeams.get(fx.group_id) ?? [];
      fixtureByNo.set(String(fx.match_no), {
        kickoff_utc: fx.kickoff_utc,
        home_code: teams[fx.home_idx] ?? null,
        away_code: teams[fx.away_idx] ?? null,
      });
    }
    for (const ko of fixtures.knockouts) {
      // Knockout slots ("W49") aren't resolved until cascade; we don't
      // need to resolve them here because the row's home/away codes are
      // optional in the grid. Still record the kickoff so the column
      // header has a date.
      fixtureByNo.set(String(ko.match_no), {
        kickoff_utc: ko.kickoff_utc,
        home_code: null,
        away_code: null,
      });
    }
  }

  const matches: MatchRow[] = results
    .map((r) => {
      const fx = fixtureByNo.get(r.match_id);
      return {
        match_no: r.match_id,
        kickoff_utc: fx?.kickoff_utc ?? "",
        home_code: fx?.home_code ?? null,
        away_code: fx?.away_code ?? null,
        outcome: r.outcome,
      };
    })
    .sort((a, b) => Number(a.match_no) - Number(b.match_no));

  // Pull predictions for every member with a user_id (anonymous late-
  // entry rows have no bracket, those members render no_pick across).
  const userIds = syndicate.members
    .map((m) => m.user_id)
    .filter((u): u is string => typeof u === "string" && u.length > 0);
  const predictions = persistence.getPredictionsByUsers(tournamentId, userIds);

  // Enrich the visible projection (display_name + flag_emoji).
  const enriched = enrichSyndicateMembers({
    members: syndicate.members,
    tournamentId,
  });

  const memberRows: MemberRow[] = enriched.map((m) => {
    const picksByMatch = m.user_id ? predictions.get(m.user_id) : null;
    const picks: Array<"correct" | "wrong" | "no_pick"> = [];
    let correctTotal = 0;
    let bestStreak = 0;
    let runStreak = 0;
    let currentStreak = 0;
    for (const match of matches) {
      const pick = picksByMatch?.get(match.match_no) ?? null;
      if (!pick) {
        picks.push("no_pick");
        runStreak = 0;
        continue;
      }
      if (pick === match.outcome) {
        picks.push("correct");
        correctTotal += 1;
        runStreak += 1;
        if (runStreak > bestStreak) bestStreak = runStreak;
      } else {
        picks.push("wrong");
        runStreak = 0;
      }
    }
    // Current streak is the run as of the LAST resulted match. If the
    // last match was a miss or no_pick, current_streak is 0; otherwise
    // it equals the trailing run.
    currentStreak = runStreak;
    return {
      user_id: m.user_id ?? null,
      handle: m.handle,
      display_name: m.display_name ?? null,
      flag_emoji: m.flag_emoji,
      picks,
      correct_total: correctTotal,
      current_streak: currentStreak,
      best_streak: bestStreak,
    };
  });

  // Sort by current streak DESC (the prize winner), then best streak
  // DESC, then total correct DESC, then handle ASC (stable).
  memberRows.sort((a, b) => {
    if (b.current_streak !== a.current_streak) {
      return b.current_streak - a.current_streak;
    }
    if (b.best_streak !== a.best_streak) {
      return b.best_streak - a.best_streak;
    }
    if (b.correct_total !== a.correct_total) {
      return b.correct_total - a.correct_total;
    }
    return a.handle.localeCompare(b.handle);
  });

  return jsonResponse(
    {
      slug,
      fetched_at: Date.now(),
      tournament_id: tournamentId,
      matches,
      members: memberRows,
    },
    200,
  );
}
