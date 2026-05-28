/**
 * Thin client for the upstream `/v1/admin/*` API on apps/api.
 *
 * The admin dashboard is a BFF: server components fetch from this client
 * and pass already-shaped data to the client components. We *do not*
 * proxy raw JWT cookies to the upstream API; instead the admin app signs
 * each upstream request with `ADMIN_JWT_SECRET` so apps/api can verify
 * "this came from a legitimate admin server-component render".
 *
 * In development the upstream API likely doesn't exist yet; the client
 * will then fall back to deterministic mock data so the UI is still
 * useful for design / RTL tests.
 */

import { SignJWT } from "jose";
import type { AdminSession } from "./auth";

const API_BASE = process.env.VTORN_API_BASE ?? "http://localhost:3310";
const USE_MOCKS = process.env.ADMIN_USE_MOCKS === "1" || !process.env.VTORN_API_BASE;

async function adminToken(session: AdminSession): Promise<string> {
  const secret = process.env.ADMIN_JWT_SECRET;
  if (!secret) throw new Error("ADMIN_JWT_SECRET missing");
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ email: session.email, role: session.role })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(now)
    .setSubject(session.email)
    .setExpirationTime(now + 60)
    .setAudience("vtorn-api-admin")
    .sign(
      typeof Buffer !== "undefined"
        ? new Uint8Array(Buffer.from(secret, "utf-8"))
        : new TextEncoder().encode(secret),
    );
}

async function get<T>(session: AdminSession, path: string, fallback: T): Promise<T> {
  if (USE_MOCKS) return fallback;
  const token = await adminToken(session);
  const r = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!r.ok) {
    // Failing soft on missing upstream endpoints keeps the dashboard
    // useful while apps/api is being implemented in parallel.
    return fallback;
  }
  return (await r.json()) as T;
}

async function post<T>(
  session: AdminSession,
  path: string,
  body: unknown,
  fallback: T,
): Promise<T> {
  if (USE_MOCKS) return fallback;
  const token = await adminToken(session);
  const r = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify(body),
  });
  if (!r.ok) return fallback;
  return (await r.json()) as T;
}

// ---------------- types -------------------------------------------------

export interface UserRow {
  id: string;
  display_name: string;
  email: string;
  country: string;
  joined_at: string; // ISO
  humanness: number; // 0-100
  status: "active" | "banned" | "shadow-banned";
  predictions_count: number;
  last_seen: string; // ISO
}

export interface SyndicateRow {
  slug: string;
  name: string;
  members: number;
  status: "active" | "pending" | "closed";
  created_at: string;
  total_stake_units: number;
}

export interface AffiliateClick {
  id: string;
  affiliate_id: string;
  user_id: string;
  geo_country: string;
  ts: string;
  converted: boolean;
  revenue_units: number;
}

export interface FunnelStep {
  step: string;
  users: number;
}

export interface AuditEntry {
  id: string;
  ts: string;
  actor: string;
  action: string;
  target: string;
  before?: unknown;
  after?: unknown;
}

export interface FeatureFlag {
  key: string;
  description: string;
  enabled: boolean;
  geo_overrides: Record<string, boolean>;
}

export interface ApiKeyRow {
  id: string;
  prefix: string;
  label: string;
  created_at: string;
  last_used: string | null;
  revoked: boolean;
}

export interface OverviewStats {
  dau: number;
  signups_today: number;
  predictions_today: number;
  active_tournaments: number;
  concurrent_viewers: number;
  share_clicks_today: number;
  affiliate_clickouts_today: number;
  revenue_units_today: number;
  by_country: { country: string; users: number }[];
  signups_7d: { day: string; count: number }[];
}

// ---------------- mock fallbacks ----------------------------------------

import * as M from "./mocks";
import * as L from "./live";

// ---------------- public functions --------------------------------------
//
// Each entry tries the live readers first (direct sqlite reads against
// auth.db + game.db, see lib/live.ts). When live returns null the
// data file isn't present on this host and we fall back to mocks so
// the UI stays useful in dev environments without seed data.

export const Api = {
  overview: async (s: AdminSession): Promise<OverviewStats> =>
    L.liveOverview() ?? (await get<OverviewStats>(s, "/v1/admin/overview", M.mockOverview())),

  users: async (s: AdminSession, q = "", page = 1) =>
    L.liveUsers(q, page) ??
    (await get<{ rows: UserRow[]; total: number }>(
      s,
      `/v1/admin/users?q=${encodeURIComponent(q)}&page=${page}`,
      M.mockUsers(q, page),
    )),

  user: async (s: AdminSession, id: string) =>
    L.liveUser(id) ??
    (await get<UserRow & { brackets: { id: string; tournament: string; rank: number }[] }>(
      s,
      `/v1/admin/users/${encodeURIComponent(id)}`,
      M.mockUser(id),
    )),

  banUser: (s: AdminSession, id: string, reason: string) =>
    post<{ ok: boolean }>(s, `/v1/admin/users/${encodeURIComponent(id)}/ban`, { reason }, { ok: true }),

  unbanUser: (s: AdminSession, id: string) =>
    post<{ ok: boolean }>(s, `/v1/admin/users/${encodeURIComponent(id)}/unban`, {}, { ok: true }),

  syndicates: async (s: AdminSession, q = "", status = "") =>
    L.liveSyndicates(q, status) ??
    (await get<{ rows: SyndicateRow[] }>(
      s,
      `/v1/admin/syndicates?q=${encodeURIComponent(q)}&status=${encodeURIComponent(status)}`,
      M.mockSyndicates(q, status),
    )),

  syndicate: async (s: AdminSession, slug: string) =>
    L.liveSyndicate(slug) ??
    (await get<SyndicateRow & { members_list: { id: string; handle: string; rank: number }[] }>(
      s,
      `/v1/admin/syndicates/${encodeURIComponent(slug)}`,
      M.mockSyndicate(slug),
    )),

  tournaments: async (s: AdminSession) =>
    L.liveTournaments() ??
    (await get<{ rows: { id: string; name: string; status: string; entries: number; lock_at: string }[] }>(
      s,
      "/v1/admin/tournaments",
      M.mockTournaments(),
    )),

  fixtures: (s: AdminSession) =>
    get<{ rows: { id: string; tournament: string; teams: string; kickoff: string; status: string }[] }>(
      s,
      "/v1/admin/fixtures",
      M.mockFixtures(),
    ),

  content: (s: AdminSession) =>
    get<{ rows: { id: string; kind: string; user: string; text: string; flagged: boolean }[] }>(
      s,
      "/v1/admin/content",
      M.mockContent(),
    ),

  affiliateClicks: (s: AdminSession, period = "7d") =>
    get<{ rows: AffiliateClick[]; total_revenue: number; total_clicks: number; conversions: number }>(
      s,
      `/v1/admin/affiliate/clicks?period=${period}`,
      M.mockAffiliate(period),
    ),

  funnel: (s: AdminSession, from: string, to: string) =>
    get<{ steps: FunnelStep[]; retention_d1: number; retention_d7: number; retention_d30: number }>(
      s,
      `/v1/admin/analytics/funnel?from=${from}&to=${to}`,
      M.mockFunnel(),
    ),

  featureFlags: (s: AdminSession) =>
    get<{ rows: FeatureFlag[] }>(s, "/v1/admin/feature-flags", M.mockFlags()),

  toggleFlag: (s: AdminSession, key: string, enabled: boolean) =>
    post<{ ok: boolean }>(
      s,
      `/v1/admin/feature-flags/${encodeURIComponent(key)}`,
      { enabled },
      { ok: true },
    ),

  apiKeys: async (s: AdminSession) =>
    L.liveApiKeys() ??
    (await get<{ rows: ApiKeyRow[] }>(s, "/v1/admin/api-keys", M.mockApiKeys())),

  auditLog: async (s: AdminSession, from = "", to = "") =>
    L.liveAuditLog() ??
    (await get<{ rows: AuditEntry[] }>(
      s,
      `/v1/admin/audit-log?from=${from}&to=${to}`,
      M.mockAuditLog(),
    )),
};
