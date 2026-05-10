/**
 * Deterministic mock data used when the upstream apps/api is not yet
 * wired (or in tests). Same shape as the real responses.
 */

import type {
  AffiliateClick,
  ApiKeyRow,
  AuditEntry,
  FeatureFlag,
  OverviewStats,
  SyndicateRow,
  UserRow,
} from "./api";

const COUNTRIES = ["NZ", "AU", "AR", "FR", "BR", "GB", "US", "MX", "ES", "DE"];
const NAMES = [
  "Aroha Walker",
  "Diego Fernandez",
  "Hina Tanaka",
  "Kavi Sharma",
  "Maeve O'Connor",
  "Nikolai Volkov",
  "Olu Adebayo",
  "Pia Costa",
  "Ronan Ma'afu",
  "Sophie Chen",
  "Tama Ngata",
  "Yara Hassan",
];

function seeded(n: number, salt = 0): number {
  // Tiny LCG so values stay stable across renders.
  let s = (n * 9301 + 49297 + salt) % 233280;
  return s / 233280;
}

function isoDaysAgo(d: number): string {
  return new Date(Date.now() - d * 86400_000).toISOString();
}

export function mockOverview(): OverviewStats {
  return {
    dau: 18432,
    signups_today: 1284,
    predictions_today: 8730,
    active_tournaments: 4,
    concurrent_viewers: 612,
    share_clicks_today: 1907,
    affiliate_clickouts_today: 348,
    revenue_units_today: 2430,
    by_country: COUNTRIES.map((c, i) => ({
      country: c,
      users: Math.round(2000 * (1 - i / COUNTRIES.length) + seeded(i, 1) * 1000),
    })),
    signups_7d: Array.from({ length: 7 }, (_, i) => ({
      day: isoDaysAgo(6 - i).slice(0, 10),
      count: Math.round(800 + seeded(i, 2) * 700),
    })),
  };
}

export function mockUsers(q: string, page: number): { rows: UserRow[]; total: number } {
  const total = 12_478;
  const pageSize = 25;
  const rows: UserRow[] = Array.from({ length: pageSize }, (_, i) => {
    const idx = (page - 1) * pageSize + i;
    const name = NAMES[idx % NAMES.length] + ` ${idx}`;
    const country = COUNTRIES[idx % COUNTRIES.length];
    const human = Math.round(20 + seeded(idx, 3) * 80);
    const status: UserRow["status"] = idx % 53 === 0 ? "banned" : idx % 71 === 0 ? "shadow-banned" : "active";
    return {
      id: `u_${(idx + 1000).toString(36)}`,
      display_name: name,
      email: `user${idx}@example.test`,
      country,
      humanness: human,
      joined_at: isoDaysAgo(Math.floor(seeded(idx, 4) * 365)),
      last_seen: isoDaysAgo(Math.floor(seeded(idx, 5) * 30)),
      predictions_count: Math.floor(seeded(idx, 6) * 220),
      status,
    };
  });
  if (!q) return { rows, total };
  const ql = q.toLowerCase();
  return {
    rows: rows.filter(
      (r) =>
        r.display_name.toLowerCase().includes(ql) ||
        r.email.toLowerCase().includes(ql) ||
        r.id.toLowerCase().includes(ql),
    ),
    total,
  };
}

export function mockUser(id: string) {
  const base = mockUsers("", 1).rows[0];
  return {
    ...base,
    id,
    brackets: [
      { id: "b_wc2026", tournament: "FIFA World Cup 2026", rank: 47 },
      { id: "b_eu2028", tournament: "Euro 2028 (early-bird)", rank: 12 },
    ],
  };
}

export function mockSyndicates(q: string, status: string): { rows: SyndicateRow[] } {
  const all: SyndicateRow[] = [
    {
      slug: "creator-league-nz",
      name: "Creator League NZ",
      members: 312,
      status: "active",
      created_at: isoDaysAgo(28),
      total_stake_units: 18430,
    },
    {
      slug: "argentina-faithful",
      name: "Argentina Faithful",
      members: 1287,
      status: "active",
      created_at: isoDaysAgo(60),
      total_stake_units: 99201,
    },
    {
      slug: "office-pool-aiva",
      name: "Office Pool — Aiva",
      members: 22,
      status: "pending",
      created_at: isoDaysAgo(2),
      total_stake_units: 0,
    },
    {
      slug: "polymarket-sharps",
      name: "Polymarket Sharps",
      members: 78,
      status: "closed",
      created_at: isoDaysAgo(120),
      total_stake_units: 4400,
    },
  ];
  const filtered = all.filter((s) => {
    if (q && !`${s.name} ${s.slug}`.toLowerCase().includes(q.toLowerCase())) return false;
    if (status && s.status !== status) return false;
    return true;
  });
  return { rows: filtered };
}

export function mockSyndicate(slug: string) {
  const base = mockSyndicates("", "").rows.find((r) => r.slug === slug) ?? mockSyndicates("", "").rows[0];
  return {
    ...base,
    members_list: Array.from({ length: 8 }, (_, i) => ({
      id: `u_s${i}`,
      handle: NAMES[i].split(" ")[0].toLowerCase(),
      rank: i + 1,
    })),
  };
}

export function mockTournaments() {
  return {
    rows: [
      { id: "fifa-wc-2026", name: "FIFA World Cup 2026", status: "active", entries: 124083, lock_at: isoDaysAgo(-30) },
      { id: "euro-2028", name: "Euro 2028 (early-bird)", status: "active", entries: 18432, lock_at: isoDaysAgo(-220) },
      { id: "copa-2027", name: "Copa America 2027", status: "scheduled", entries: 0, lock_at: isoDaysAgo(-410) },
      { id: "fifa-wc-2022-final", name: "FIFA WC 2022 Final replay", status: "settled", entries: 4022, lock_at: isoDaysAgo(900) },
    ],
  };
}

export function mockFixtures() {
  return {
    rows: [
      { id: "wc26-grpA-1", tournament: "FIFA WC 2026", teams: "MEX vs CAN", kickoff: isoDaysAgo(-30), status: "scheduled" },
      { id: "wc26-grpA-2", tournament: "FIFA WC 2026", teams: "USA vs IRN", kickoff: isoDaysAgo(-29), status: "scheduled" },
      { id: "wc22-final", tournament: "FIFA WC 2022", teams: "ARG vs FRA", kickoff: isoDaysAgo(900), status: "settled" },
    ],
  };
}

export function mockContent() {
  return {
    rows: [
      { id: "c_1", kind: "display_name", user: "u_42", text: "<script>alert(1)</script>", flagged: true },
      { id: "c_2", kind: "bracket_description", user: "u_88", text: "Argentina forever, allez les bleus!", flagged: false },
      { id: "c_3", kind: "avatar", user: "u_99", text: "[image]", flagged: true },
    ],
  };
}

export function mockAffiliate(period: string): {
  rows: AffiliateClick[];
  total_revenue: number;
  total_clicks: number;
  conversions: number;
} {
  void period;
  const rows: AffiliateClick[] = Array.from({ length: 20 }, (_, i) => ({
    id: `aff_${i}`,
    affiliate_id: ["polymarket", "skynz", "betfair"][i % 3],
    user_id: `u_${i + 1000}`,
    geo_country: COUNTRIES[i % COUNTRIES.length],
    ts: isoDaysAgo(Math.floor(seeded(i, 7) * 7)),
    converted: i % 4 === 0,
    revenue_units: i % 4 === 0 ? Math.round(seeded(i, 8) * 200) : 0,
  }));
  const total_revenue = rows.reduce((a, r) => a + r.revenue_units, 0);
  return {
    rows,
    total_revenue,
    total_clicks: 1843,
    conversions: rows.filter((r) => r.converted).length,
  };
}

export function mockFunnel() {
  return {
    steps: [
      { step: "page_view", users: 100_000 },
      { step: "user_signup", users: 18_400 },
      { step: "match_view_started", users: 14_200 },
      { step: "prediction_submitted", users: 9_800 },
      { step: "share_clicked", users: 3_200 },
      { step: "affiliate_clickout", users: 740 },
    ],
    retention_d1: 0.42,
    retention_d7: 0.28,
    retention_d30: 0.16,
  };
}

export function mockFlags(): { rows: FeatureFlag[] } {
  return {
    rows: [
      { key: "polymarket_odds_chip", description: "Show Polymarket odds chip on bracket picks", enabled: true, geo_overrides: { NZ: false } },
      { key: "humanness_score_public", description: "Display humanness score on public profile", enabled: false, geo_overrides: {} },
      { key: "affiliate_pay_tv", description: "Pay-TV affiliate CTA on match-day pushes", enabled: true, geo_overrides: { US: false } },
      { key: "voice_commentary", description: "Live commentary overlay (beta)", enabled: false, geo_overrides: {} },
    ],
  };
}

export function mockApiKeys(): { rows: ApiKeyRow[] } {
  return {
    rows: [
      { id: "k_1", prefix: "vt_live_pk", label: "Marketing site", created_at: isoDaysAgo(45), last_used: isoDaysAgo(0), revoked: false },
      { id: "k_2", prefix: "vt_live_sk", label: "Telegram bot", created_at: isoDaysAgo(80), last_used: isoDaysAgo(0), revoked: false },
      { id: "k_3", prefix: "vt_test_sk", label: "QA bot", created_at: isoDaysAgo(180), last_used: isoDaysAgo(60), revoked: true },
    ],
  };
}

export function mockAuditLog(): { rows: AuditEntry[] } {
  return {
    rows: [
      { id: "a_1", ts: isoDaysAgo(0), actor: "tim@tournamental.com", action: "user.ban", target: "u_53", before: { status: "active" }, after: { status: "banned" } },
      { id: "a_2", ts: isoDaysAgo(0), actor: "tim@tournamental.com", action: "feature_flag.toggle", target: "polymarket_odds_chip", before: { enabled: false }, after: { enabled: true } },
      { id: "a_3", ts: isoDaysAgo(1), actor: "ops@tournamental.com", action: "syndicate.close", target: "polymarket-sharps" },
      { id: "a_4", ts: isoDaysAgo(2), actor: "tim@tournamental.com", action: "api_key.revoke", target: "k_3" },
      { id: "a_5", ts: isoDaysAgo(3), actor: "mod@tournamental.com", action: "content.remove", target: "c_1" },
    ],
  };
}
