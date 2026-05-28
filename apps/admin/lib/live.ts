/**
 * Live readers for admin data, backed by direct sqlite open against
 * auth-sms/data/auth.db and game/data/game.db. Each function returns
 * null when its source DB isn't reachable so callers can transparently
 * fall back to mock data.
 *
 * Read-only by contract. The admin app never writes through these
 * handles; mutating actions go through the owning service's HTTP API.
 */

import { authDb, gameDb, nDaysAgoMs, startOfTodayMs } from "./db";
import type {
  ApiKeyRow,
  OverviewStats,
  SyndicateRow,
  UserRow,
} from "./api";

// ---------------- overview ---------------------------------------------

interface SyndicateCounts {
  total: number;
  public_count: number;
  private_count: number;
  total_entry_units: number;
  total_prize_text_set: number;
}

export function liveOverview(): OverviewStats | null {
  const adb = authDb();
  const gdb = gameDb();
  if (!adb || !gdb) return null;

  const todayMs = startOfTodayMs();
  const sevenDaysAgoMs = nDaysAgoMs(7);
  const oneDayAgoMs = nDaysAgoMs(1);

  const signupsToday = (
    adb
      .prepare("SELECT COUNT(*) AS c FROM user WHERE created_at >= ?")
      .get(todayMs) as { c: number }
  ).c;

  const dau = (
    adb
      .prepare("SELECT COUNT(*) AS c FROM user WHERE last_seen_at >= ?")
      .get(oneDayAgoMs) as { c: number }
  ).c;

  const totalUsers = (
    adb.prepare("SELECT COUNT(*) AS c FROM user").get() as { c: number }
  ).c;

  const signupsByCountry = adb
    .prepare(
      `SELECT COALESCE(NULLIF(country, ''), 'XX') AS country, COUNT(*) AS c
       FROM user
       GROUP BY country
       ORDER BY c DESC
       LIMIT 12`,
    )
    .all() as { country: string; c: number }[];

  const signups7d = adb
    .prepare(
      `SELECT date(created_at/1000, 'unixepoch') AS day, COUNT(*) AS c
       FROM user
       WHERE created_at >= ?
       GROUP BY day
       ORDER BY day ASC`,
    )
    .all(sevenDaysAgoMs) as { day: string; c: number }[];

  const synCounts = gdb
    .prepare(
      `SELECT
         COUNT(*)                                          AS total,
         SUM(CASE WHEN is_public = 1 THEN 1 ELSE 0 END)    AS public_count,
         SUM(CASE WHEN is_public = 0 THEN 1 ELSE 0 END)    AS private_count,
         COALESCE(SUM(CASE WHEN entry_fee_cents IS NOT NULL THEN entry_fee_cents * member_count ELSE 0 END), 0)
                                                           AS total_entry_units,
         SUM(CASE WHEN prize_text IS NOT NULL AND prize_text <> '' THEN 1 ELSE 0 END)
                                                           AS total_prize_text_set
       FROM syndicates`,
    )
    .get() as SyndicateCounts;

  const activeTournaments = (
    gdb
      .prepare("SELECT COUNT(*) AS c FROM tournaments WHERE settled_at IS NULL")
      .get() as { c: number }
  ).c;

  const predictionsToday = (
    gdb
      .prepare("SELECT COUNT(*) AS c FROM brackets WHERE locked_at >= ?")
      .get(todayMs) as { c: number }
  ).c;

  // Fill in zero rows for missing days in the 7-day window so the chart
  // doesn't skip days where signups were zero.
  const days7 = fill7DayWindow(signups7d, sevenDaysAgoMs);

  return {
    dau,
    signups_today: signupsToday,
    predictions_today: predictionsToday,
    active_tournaments: activeTournaments,
    concurrent_viewers: 0,
    share_clicks_today: 0,
    affiliate_clickouts_today: 0,
    // Entry units are in cents; convert to integer "units" for the
    // existing StatCard format (label says "units").
    revenue_units_today: Math.round((synCounts.total_entry_units ?? 0) / 100),
    by_country: signupsByCountry.map((r) => ({
      country: r.country || "XX",
      users: r.c,
    })),
    signups_7d: days7,
    // Extra fields used by the new overview cards. The base
    // OverviewStats type tolerates extras since pages destructure
    // explicitly.
    ...({
      total_users: totalUsers,
      total_pools: synCounts.total,
      public_pools: synCounts.public_count ?? 0,
      private_pools: synCounts.private_count ?? 0,
      pools_with_prizes: synCounts.total_prize_text_set ?? 0,
    } as Record<string, number>),
  };
}

function fill7DayWindow(
  rows: { day: string; c: number }[],
  fromMs: number,
): { day: string; count: number }[] {
  const out: { day: string; count: number }[] = [];
  const byDay = new Map(rows.map((r) => [r.day, r.c]));
  for (let i = 0; i < 7; i += 1) {
    const t = fromMs + i * 24 * 60 * 60 * 1000;
    const day = new Date(t).toISOString().slice(0, 10);
    out.push({ day, count: byDay.get(day) ?? 0 });
  }
  return out;
}

// ---------------- users ------------------------------------------------

interface AuthUserRow {
  id: string;
  phone: string | null;
  display_name: string | null;
  country: string | null;
  email: string | null;
  created_at: number;
  last_seen_at: number;
}

function mapUserRow(r: AuthUserRow, predictionsCount: number): UserRow {
  const display = r.display_name ?? r.email ?? r.phone ?? r.id.slice(0, 8);
  return {
    id: r.id,
    display_name: display,
    email: r.email ?? r.phone ?? "—",
    country: r.country ?? "XX",
    joined_at: new Date(r.created_at).toISOString(),
    humanness: 80,
    status: "active",
    predictions_count: predictionsCount,
    last_seen: new Date(r.last_seen_at).toISOString(),
  };
}

export function liveUsers(
  q: string,
  page: number,
  perPage = 25,
): { rows: UserRow[]; total: number } | null {
  const adb = authDb();
  const gdb = gameDb();
  if (!adb) return null;

  const term = q.trim();
  const where = term
    ? `WHERE
         display_name LIKE @like OR
         phone LIKE @like OR
         email LIKE @like OR
         id LIKE @like`
    : "";

  const total = (
    adb
      .prepare(`SELECT COUNT(*) AS c FROM user ${where}`)
      .get({ like: `%${term}%` }) as { c: number }
  ).c;

  const offset = Math.max(0, (page - 1) * perPage);
  const rows = adb
    .prepare(
      `SELECT id, phone, display_name, country, email, created_at, last_seen_at
       FROM user
       ${where}
       ORDER BY created_at DESC
       LIMIT @perPage OFFSET @offset`,
    )
    .all({ like: `%${term}%`, perPage, offset }) as AuthUserRow[];

  // Bracket counts per user; small set so a per-id query is fine.
  const counts = new Map<string, number>();
  if (gdb && rows.length > 0) {
    const stmt = gdb.prepare(
      "SELECT COUNT(*) AS c FROM brackets WHERE user_id = ?",
    );
    for (const r of rows) {
      counts.set(r.id, (stmt.get(r.id) as { c: number }).c);
    }
  }

  return {
    rows: rows.map((r) => mapUserRow(r, counts.get(r.id) ?? 0)),
    total,
  };
}

export function liveUser(
  id: string,
): (UserRow & { brackets: { id: string; tournament: string; rank: number }[] }) | null {
  const adb = authDb();
  const gdb = gameDb();
  if (!adb) return null;

  const r = adb
    .prepare(
      `SELECT id, phone, display_name, country, email, created_at, last_seen_at
       FROM user WHERE id = ?`,
    )
    .get(id) as AuthUserRow | undefined;
  if (!r) return null;

  const brackets = gdb
    ? (gdb
        .prepare(
          `SELECT id, tournament_id, score_total
           FROM brackets WHERE user_id = ?
           ORDER BY locked_at DESC LIMIT 20`,
        )
        .all(id) as { id: string; tournament_id: string; score_total: number }[])
    : [];

  const predictionsCount = brackets.length;

  return {
    ...mapUserRow(r, predictionsCount),
    brackets: brackets.map((b) => ({
      id: b.id,
      tournament: b.tournament_id,
      rank: b.score_total,
    })),
  };
}

// ---------------- syndicates -------------------------------------------

export interface SyndicateLiveRow extends SyndicateRow {
  /** Public vs private status — extra column the live data carries that
   *  the mock typedef doesn't. Pages can opt into this via a type widen. */
  is_public: boolean;
  owner_handle: string | null;
  owner_user_id: string | null;
  prize_text: string | null;
  entry_fee_cents: number | null;
  entry_fee_currency: string | null;
  tier: string;
  tournament_id: string;
}

interface SyndicateDbRow {
  id: string;
  slug: string;
  name: string;
  tournament_id: string;
  owner_user_id: string | null;
  owner_handle: string | null;
  owner_email: string;
  owner_phone: string;
  member_count: number;
  created_at: number;
  is_public: number;
  tier: string;
  prize_text: string | null;
  entry_fee_cents: number | null;
  entry_fee_currency: string | null;
}

function mapSyndicateRow(r: SyndicateDbRow): SyndicateLiveRow {
  const totalStakeCents =
    typeof r.entry_fee_cents === "number" ? r.entry_fee_cents * r.member_count : 0;
  return {
    slug: r.slug,
    name: r.name,
    members: r.member_count,
    status: "active",
    created_at: new Date(r.created_at).toISOString(),
    total_stake_units: Math.round(totalStakeCents / 100),
    is_public: r.is_public === 1,
    owner_handle: r.owner_handle,
    owner_user_id: r.owner_user_id,
    prize_text: r.prize_text,
    entry_fee_cents: r.entry_fee_cents,
    entry_fee_currency: r.entry_fee_currency,
    tier: r.tier,
    tournament_id: r.tournament_id,
  };
}

export function liveSyndicates(
  q: string,
  status: string,
): { rows: SyndicateLiveRow[] } | null {
  const gdb = gameDb();
  if (!gdb) return null;

  const term = q.trim();
  const filters: string[] = [];
  const params: Record<string, unknown> = {};
  if (term) {
    filters.push(
      "(slug LIKE @like OR name LIKE @like OR owner_email LIKE @like OR owner_handle LIKE @like)",
    );
    params.like = `%${term}%`;
  }
  if (status === "public") {
    filters.push("is_public = 1");
  } else if (status === "private") {
    filters.push("is_public = 0");
  }
  const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";

  // Use the authoritative count from syndicate_owners_membership rather
  // than syndicates.member_count, which drifts from anonymous joins.
  const rows = gdb
    .prepare(
      `SELECT s.id, s.slug, s.name, s.tournament_id, s.owner_user_id, s.owner_handle,
              s.owner_email, s.owner_phone,
              COALESCE((SELECT COUNT(*) FROM syndicate_owners_membership som
                        WHERE som.syndicate_id = s.id), s.member_count) AS member_count,
              s.created_at, s.is_public,
              s.tier, s.prize_text, s.entry_fee_cents, s.entry_fee_currency
       FROM syndicates s
       ${where.replace(/\b(?=slug|name|owner_|is_public)/g, "s.")}
       ORDER BY s.created_at DESC
       LIMIT 200`,
    )
    .all(params) as SyndicateDbRow[];

  return { rows: rows.map(mapSyndicateRow) };
}

export function liveSyndicate(slug: string):
  | (SyndicateLiveRow & {
      members_list: { id: string; handle: string; rank: number }[];
      owner_email: string;
      owner_phone: string;
    })
  | null {
  const gdb = gameDb();
  if (!gdb) return null;

  const r = gdb
    .prepare(
      `SELECT id, slug, name, tournament_id, owner_user_id, owner_handle,
              owner_email, owner_phone, member_count, created_at, is_public,
              tier, prize_text, entry_fee_cents, entry_fee_currency
       FROM syndicates WHERE slug = ?`,
    )
    .get(slug) as SyndicateDbRow | undefined;
  if (!r) return null;

  // The canonical members table is `syndicate_owners_membership`, NOT
  // `syndicate_members`. The latter is a vestigial table the early join
  // flow wrote to and nothing writes to it now; the live join flow
  // (owners + members) writes to `syndicate_owners_membership` with a
  // role column distinguishing them. We surface owner + member rows
  // alike — the dashboard reader doesn't care, the operator can see
  // role per row. (Tim 2026-05-29: the-crate showed 10 members on the
  // card but 0 in the list because we were reading the wrong table.)
  const rawMembers = gdb
    .prepare(
      `SELECT som.user_id AS id,
              som.role,
              som.handle,
              som.display_name,
              som.joined_at,
              b.score_total AS rank
       FROM syndicate_owners_membership som
       LEFT JOIN brackets b ON b.user_id = som.user_id AND b.tournament_id = ?
       WHERE som.syndicate_id = ?
       ORDER BY som.role = 'owner' DESC, som.joined_at ASC
       LIMIT 100`,
    )
    .all(r.tournament_id, r.id) as {
    id: string;
    role: string;
    handle: string | null;
    display_name: string | null;
    joined_at: number;
    rank: number | null;
  }[];

  // Augment display names from auth.db for any signed-in users whose
  // owners_membership row didn't capture a handle yet. The
  // `anon:<uuid>` ids are legacy guest joins; we leave those as-is.
  const adb = authDb();
  const handles = new Map<string, string>();
  const realIds = rawMembers
    .map((m) => m.id)
    .filter((id) => id.startsWith("u_") || /^[0-9a-f-]{36}$/.test(id));
  if (adb && realIds.length > 0) {
    const placeholders = realIds.map(() => "?").join(",");
    const rows = adb
      .prepare(
        `SELECT id, display_name FROM user WHERE id IN (${placeholders})`,
      )
      .all(...realIds) as { id: string; display_name: string | null }[];
    for (const row of rows) {
      if (row.display_name) handles.set(row.id, row.display_name);
    }
  }

  function labelFor(m: (typeof rawMembers)[number]): string {
    if (m.display_name && m.display_name.trim()) return m.display_name;
    if (m.handle && m.handle.trim()) return m.handle;
    const h = handles.get(m.id);
    if (h) return h;
    if (m.id.startsWith("anon:")) return `Guest ${m.id.slice(5, 13)}`;
    return m.id.slice(0, 12);
  }

  return {
    ...mapSyndicateRow(r),
    owner_email: r.owner_email,
    owner_phone: r.owner_phone,
    // Override the cached `member_count` with the authoritative count
    // from the membership table. The cached column drifts because the
    // public-page join counter increments without writing the row when
    // a user bails before signup.
    members: rawMembers.length,
    members_cached: r.member_count,
    members_list: rawMembers.map((m) => ({
      id: m.id,
      handle: m.role === "owner" ? `${labelFor(m)} (owner)` : labelFor(m),
      rank: m.rank ?? 0,
    })),
  } as SyndicateLiveRow & {
    members_list: { id: string; handle: string; rank: number }[];
    owner_email: string;
    owner_phone: string;
    members_cached: number;
  };
}

// ---------------- API keys ---------------------------------------------

interface ApiKeyDbRow {
  id: string;
  user_id: string;
  label: string;
  key_prefix: string;
  created_at: number;
  last_used_at: number | null;
  revoked_at: number | null;
}

export function liveApiKeys(): { rows: ApiKeyRow[] } | null {
  const gdb = gameDb();
  if (!gdb) return null;
  const rows = gdb
    .prepare(
      `SELECT id, user_id, label, key_prefix, created_at, last_used_at, revoked_at
       FROM user_api_keys
       ORDER BY created_at DESC
       LIMIT 200`,
    )
    .all() as ApiKeyDbRow[];
  return {
    rows: rows.map((r) => ({
      id: r.id,
      prefix: r.key_prefix,
      label: `${r.label} (${r.user_id.slice(0, 12)})`,
      created_at: new Date(r.created_at).toISOString(),
      last_used: r.last_used_at ? new Date(r.last_used_at).toISOString() : null,
      revoked: r.revoked_at !== null,
    })),
  };
}

// ---------------- recent activity --------------------------------------

export interface RecentSignup {
  readonly id: string;
  readonly display_name: string;
  readonly country: string;
  readonly joined_at: string;
}

export interface RecentPool {
  readonly slug: string;
  readonly name: string;
  readonly owner_handle: string | null;
  readonly is_public: boolean;
  readonly created_at: string;
}

export function liveRecentSignups(limit = 10): RecentSignup[] | null {
  const adb = authDb();
  if (!adb) return null;
  const rows = adb
    .prepare(
      `SELECT id, display_name, country, email, phone, created_at
       FROM user
       ORDER BY created_at DESC
       LIMIT ?`,
    )
    .all(limit) as {
    id: string;
    display_name: string | null;
    country: string | null;
    email: string | null;
    phone: string | null;
    created_at: number;
  }[];
  return rows.map((r) => ({
    id: r.id,
    display_name:
      r.display_name?.trim() || r.email || r.phone || r.id.slice(0, 8),
    country: r.country ?? "XX",
    joined_at: new Date(r.created_at).toISOString(),
  }));
}

export function liveRecentPools(limit = 10): RecentPool[] | null {
  const gdb = gameDb();
  if (!gdb) return null;
  const rows = gdb
    .prepare(
      `SELECT slug, name, owner_handle, is_public, created_at
       FROM syndicates
       ORDER BY created_at DESC
       LIMIT ?`,
    )
    .all(limit) as {
    slug: string;
    name: string;
    owner_handle: string | null;
    is_public: number;
    created_at: number;
  }[];
  return rows.map((r) => ({
    slug: r.slug,
    name: r.name,
    owner_handle: r.owner_handle,
    is_public: r.is_public === 1,
    created_at: new Date(r.created_at).toISOString(),
  }));
}

// ---------------- audit log --------------------------------------------

import { existsSync as _existsSync, readFileSync as _readFileSync } from "node:fs";
import { resolve as _resolve } from "node:path";

interface AuditEntryLive {
  id: string;
  ts: string;
  actor: string;
  action: string;
  target: string;
  before?: unknown;
  after?: unknown;
}

export function liveAuditLog(): { rows: AuditEntryLive[] } | null {
  const p =
    process.env.ADMIN_AUDIT_LOG_PATH ??
    _resolve(process.cwd(), ".admin-audit.jsonl");
  if (!_existsSync(p)) return { rows: [] };
  const raw = _readFileSync(p, "utf-8");
  const rows: AuditEntryLive[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      rows.push(JSON.parse(trimmed) as AuditEntryLive);
    } catch {
      // Skip malformed line — the rest of the file is still useful.
    }
  }
  // Newest first; cap to last 500.
  rows.reverse();
  return { rows: rows.slice(0, 500) };
}

// ---------------- tournaments ------------------------------------------

export function liveTournaments(): {
  rows: { id: string; name: string; status: string; entries: number; lock_at: string }[];
} | null {
  const gdb = gameDb();
  if (!gdb) return null;
  const rows = gdb
    .prepare(
      `SELECT t.id, t.name, t.settled_at, t.created_at,
              (SELECT COUNT(*) FROM brackets b WHERE b.tournament_id = t.id) AS entries
       FROM tournaments t
       ORDER BY t.created_at DESC`,
    )
    .all() as {
    id: string;
    name: string | null;
    settled_at: number | null;
    created_at: number;
    entries: number;
  }[];
  return {
    rows: rows.map((r) => ({
      id: r.id,
      name: r.name ?? r.id,
      status: r.settled_at ? "settled" : "active",
      entries: r.entries,
      lock_at: new Date(r.settled_at ?? r.created_at).toISOString(),
    })),
  };
}
