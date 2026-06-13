/**
 * GET /api/v1/live-status/[tournament_id]
 *
 * Returns every match currently in progress for the tournament,
 * with the live score and the current match-clock string. Polled
 * from the client every ~60s; absorbed by a short edge cache so
 * ESPN doesn't see one call per viewer per minute.
 *
 *   {
 *     tournament_id: string,
 *     fetched_at: number,
 *     live: Array<{
 *       match_no: number,
 *       match_id: string,    // stringified match_no, matches bracket keys
 *       state: "in",
 *       statusName: string,  // e.g. "STATUS_FIRST_HALF", "STATUS_HALFTIME"
 *       homeScore: number,
 *       awayScore: number,
 *       clock: string,       // ESPN displayClock, e.g. "77'", "45+1'", "0'"
 *       period: number | null,
 *       homeCode: string,
 *       awayCode: string,
 *     }>,
 *   }
 *
 * Source: ESPN's public FIFA World Cup scoreboard endpoint (no API
 * key required). Same provider as the results poller.
 *
 * Tim 2026-06-13: feature spec, replace the calendar's static
 * "LOCKED" chip on currently-playing matches with a live
 * "IN PROGRESS - 3-1 - 77'" treatment and mirror it on the bracket
 * page. ESPN gives us state + score + clock in one shot.
 */

import { NextResponse } from "next/server";

import { loadFixtures2026 } from "@tournamental/bracket-engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface LiveEntry {
  readonly match_no: number;
  readonly match_id: string;
  readonly state: "in";
  readonly statusName: string;
  readonly homeScore: number;
  readonly awayScore: number;
  readonly clock: string;
  readonly period: number | null;
  readonly homeCode: string;
  readonly awayCode: string;
}

function fmtYYYYMMDD(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

export async function GET(
  _req: Request,
  { params }: { params: { tournament_id?: string } },
): Promise<Response> {
  const tid = (params.tournament_id ?? "").trim();
  if (!tid) {
    return NextResponse.json({ error: "invalid_tournament_id" }, { status: 400 });
  }

  // Build (home_code, away_code) -> match_no from canonical fixtures
  // so we can map ESPN events back to our bracket keys.
  const fixtures = loadFixtures2026();
  const groups = new Map<string, ReadonlyArray<string>>();
  for (const g of fixtures.groups) groups.set(g.id, g.team_ids);
  const lookup = new Map<string, number>();
  for (const fx of fixtures.group_fixtures) {
    const teams = groups.get(fx.group_id);
    if (!teams) continue;
    const h = teams[fx.home_idx];
    const a = teams[fx.away_idx];
    if (h && a) lookup.set(`${h}_${a}`, fx.match_no);
  }

  // Pull both yesterday + today + tomorrow (UTC dates) to catch
  // matches that straddle the UTC midnight boundary; ESPN buckets
  // by event date in the league's broadcast TZ which isn't UTC.
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setUTCDate(now.getUTCDate() - 1);
  const tomorrow = new Date(now);
  tomorrow.setUTCDate(now.getUTCDate() + 1);
  const dates = [fmtYYYYMMDD(yesterday), fmtYYYYMMDD(now), fmtYYYYMMDD(tomorrow)];

  const live: LiveEntry[] = [];
  const seen = new Set<number>(); // dedupe in case the same event appears in two date buckets
  for (const date of dates) {
    try {
      const res = await fetch(
        `https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard?dates=${date}`,
        {
          // Short server-side fetch cache so concurrent route handlers
          // share a single ESPN call within ~30s.
          next: { revalidate: 30 },
          headers: { "User-Agent": "vtorn-live-status/0.1" },
        },
      );
      if (!res.ok) continue;
      const body = (await res.json()) as {
        events?: Array<{
          competitions?: Array<{
            competitors?: Array<{
              homeAway?: "home" | "away";
              score?: string | number;
              team?: { abbreviation?: string };
            }>;
            status?: {
              displayClock?: string;
              period?: number;
              type?: {
                state?: string;
                name?: string;
                completed?: boolean;
              };
            };
          }>;
        }>;
      };
      for (const e of body.events ?? []) {
        const comp = (e.competitions ?? [])[0];
        if (!comp) continue;
        const status = comp.status;
        const state = status?.type?.state;
        if (state !== "in") continue;
        const cs = comp.competitors ?? [];
        const homeRow = cs.find((c) => c.homeAway === "home");
        const awayRow = cs.find((c) => c.homeAway === "away");
        const homeCode = (homeRow?.team?.abbreviation ?? "").toUpperCase();
        const awayCode = (awayRow?.team?.abbreviation ?? "").toUpperCase();
        const matchNo = lookup.get(`${homeCode}_${awayCode}`);
        if (!matchNo || seen.has(matchNo)) continue;
        seen.add(matchNo);
        const hs = Number(homeRow?.score ?? 0);
        const as = Number(awayRow?.score ?? 0);
        live.push({
          match_no: matchNo,
          match_id: String(matchNo),
          state: "in",
          statusName: status?.type?.name ?? "",
          homeScore: Number.isFinite(hs) ? hs : 0,
          awayScore: Number.isFinite(as) ? as : 0,
          clock: status?.displayClock ?? "",
          period: status?.period ?? null,
          homeCode,
          awayCode,
        });
      }
    } catch {
      // Silent — if ESPN burps we just return whatever we got. Next
      // poll picks up the rest.
    }
  }

  const resp = NextResponse.json({
    tournament_id: tid,
    fetched_at: Date.now(),
    live,
  });
  // 20s edge cache + SWR. Clients poll every 60s; the edge cache
  // means at most 3 ESPN calls per minute regardless of viewer count.
  resp.headers.set(
    "Cache-Control",
    "public, max-age=20, s-maxage=20, stale-while-revalidate=60",
  );
  return resp;
}
