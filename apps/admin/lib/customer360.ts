/**
 * Customer-360 aggregator.
 *
 * Pulls together everything the operator wants to see for one user, across
 * the VTourn microservice mesh. Each upstream call is independent — if one
 * fails (or hasn't shipped yet), that section becomes `null` and the page
 * still renders.
 *
 * Upstream services (each may or may not be running locally):
 *   - apps/crm-bridge          GET  http://localhost:3395/v1/customer/:userId
 *   - apps/game                GET  /v1/users/:userId/bracket
 *   - apps/game                GET  /v1/users/:userId/history
 *   - apps/game                GET  /v1/users/:userId/syndicates
 *   - apps/affiliate-router    GET  /v1/admin/audit/by-user/:userId
 *   - apps/social-publisher    GET  /v1/posts?userId=...
 *
 * NOTE: `apps/crm-bridge` and `apps/social-publisher` live on separate
 * branches at the time this lands. The wrapper swallows their absence.
 * The "Predictions" section is the most likely to be wired first because
 * the game-service is already shipped and the per-match-predictions worktree
 * is adding the history ledger right now.
 */

import { upstreamGet } from "./upstream-fetch";

const CRM_BRIDGE_BASE = process.env.CRM_BRIDGE_BASE ?? "http://localhost:3395";
const GAME_SERVICE_BASE = process.env.GAME_SERVICE_BASE ?? "http://localhost:3315";
const AFFILIATE_ROUTER_BASE = process.env.AFFILIATE_ROUTER_BASE ?? "http://localhost:3325";
const SOCIAL_PUBLISHER_BASE = process.env.SOCIAL_PUBLISHER_BASE ?? "http://localhost:3360";

// ---------------- types -------------------------------------------------

export interface CrmContact {
  userId: string;
  email?: string;
  phone?: string;
  marketingOptIn?: boolean;
  notes?: string;
  /** Free-form key/value attributes the CRM exposes — kept opaque. */
  attributes?: Record<string, unknown>;
  lastSyncedAt?: string;
}

/** Subset of @vtorn/spec MatchPrediction used by the admin UI. We don't
 * import the spec package directly to keep the admin app's dependency
 * surface small and avoid pulling tournament data through the bundle. */
export interface AdminMatchPrediction {
  matchId: string;
  outcome: "home_win" | "draw" | "away_win";
  homeScore?: number;
  awayScore?: number;
  lockedAt: string;
  /** Polymarket / partner odds at the time the pick was locked. Optional —
   * `oddsAtLock` is being added to the spec on a separate branch. */
  oddsAtLock?: {
    home: number;
    draw: number;
    away: number;
    source: string;
  };
}

export interface UserBracketDraft {
  bracketId: string;
  matchPredictions: Record<string, AdminMatchPrediction>;
  knockoutPredictions: Record<string, AdminMatchPrediction>;
  lockedAt?: string;
  version: number;
}

export interface BracketHistoryEntry {
  id: string;
  matchId: string;
  ts: string;
  prevOutcome?: AdminMatchPrediction["outcome"];
  newOutcome: AdminMatchPrediction["outcome"];
  prevScore?: { home: number; away: number };
  newScore?: { home: number; away: number };
  oddsAtLock?: AdminMatchPrediction["oddsAtLock"];
  source?: string;
}

export interface SyndicateMembership {
  slug: string;
  name: string;
  role: "owner" | "captain" | "member";
  joinedAt: string;
  rank?: number;
}

export interface AffiliateRevenueEntry {
  id: string;
  ts: string;
  affiliateId: string;
  partnerLabel?: string;
  geoCountry?: string;
  converted: boolean;
  revenueUnits: number;
}

export interface AffiliateRevenueSummary {
  totalClicks: number;
  totalConversions: number;
  totalRevenueUnits: number;
  recent: AffiliateRevenueEntry[];
}

export interface PunditStatus {
  verified: boolean;
  levels: number;
  sinceDate: string | null;
  tournaments: string[];
}

export interface SocialPost {
  id: string;
  platform: string;
  url?: string;
  publishedAt: string;
  caption?: string;
  views?: number;
  shares?: number;
  /** "appeared_in" if the user is featured in the clip; "shared_by" if they
   * shared it; "authored" if they created it. */
  relation: "appeared_in" | "shared_by" | "authored";
}

export interface Customer360 {
  userId: string;
  crmContact: CrmContact | null;
  bracketDraft: UserBracketDraft | null;
  bracketHistory: BracketHistoryEntry[] | null;
  syndicates: SyndicateMembership[] | null;
  affiliateRevenue: AffiliateRevenueSummary | null;
  socialPosts: SocialPost[] | null;
  /** Verified-Pundit badge status. `null` means the upstream call failed. */
  pundit: PunditStatus | null;
  /** When each sub-fetch happened. Useful for debugging stale data. */
  fetchedAt: string;
}

// ---------------- public API --------------------------------------------

export async function fetchCrmContact(userId: string): Promise<CrmContact | null> {
  return upstreamGet<CrmContact>(
    `${CRM_BRIDGE_BASE}/v1/customer/${encodeURIComponent(userId)}`,
    { tag: "crm-bridge" },
  );
}

export async function fetchUserBracketDraft(
  userId: string,
): Promise<UserBracketDraft | null> {
  return upstreamGet<UserBracketDraft>(
    `${GAME_SERVICE_BASE}/v1/users/${encodeURIComponent(userId)}/bracket`,
    { tag: "game-service:bracket" },
  );
}

export async function fetchBracketHistory(
  userId: string,
): Promise<BracketHistoryEntry[] | null> {
  const r = await upstreamGet<{ entries: BracketHistoryEntry[] } | BracketHistoryEntry[]>(
    `${GAME_SERVICE_BASE}/v1/users/${encodeURIComponent(userId)}/history`,
    { tag: "game-service:history" },
  );
  if (!r) return null;
  // Tolerate either `{ entries: [...] }` or a bare array — endpoint shape is
  // still being negotiated upstream.
  return Array.isArray(r) ? r : r.entries;
}

export async function fetchUserSyndicates(
  userId: string,
): Promise<SyndicateMembership[] | null> {
  const r = await upstreamGet<{ syndicates: SyndicateMembership[] } | SyndicateMembership[]>(
    `${GAME_SERVICE_BASE}/v1/users/${encodeURIComponent(userId)}/syndicates`,
    { tag: "game-service:syndicates" },
  );
  if (!r) return null;
  return Array.isArray(r) ? r : r.syndicates;
}

export async function fetchAffiliateRevenue(
  userId: string,
): Promise<AffiliateRevenueSummary | null> {
  return upstreamGet<AffiliateRevenueSummary>(
    `${AFFILIATE_ROUTER_BASE}/v1/admin/audit/by-user/${encodeURIComponent(userId)}`,
    { tag: "affiliate-router" },
  );
}

export async function fetchPunditStatus(
  userId: string,
): Promise<PunditStatus | null> {
  return upstreamGet<PunditStatus>(
    `${GAME_SERVICE_BASE}/v1/users/${encodeURIComponent(userId)}/pundit`,
    { tag: "game-service:pundit" },
  );
}

export async function fetchSocialPosts(
  userId: string,
): Promise<SocialPost[] | null> {
  const r = await upstreamGet<{ posts: SocialPost[] } | SocialPost[]>(
    `${SOCIAL_PUBLISHER_BASE}/v1/posts?userId=${encodeURIComponent(userId)}`,
    { tag: "social-publisher" },
  );
  if (!r) return null;
  return Array.isArray(r) ? r : r.posts;
}

/**
 * Aggregate all six upstream calls in parallel. Each one independently
 * resolves to its data or null. Total wall-time is bounded by the slowest
 * upstream (each upstream has its own 4s timeout — see upstreamGet).
 */
export async function fetchCustomer360(userId: string): Promise<Customer360> {
  const [
    crmContact,
    bracketDraft,
    bracketHistory,
    syndicates,
    affiliateRevenue,
    socialPosts,
    pundit,
  ] = await Promise.all([
    fetchCrmContact(userId),
    fetchUserBracketDraft(userId),
    fetchBracketHistory(userId),
    fetchUserSyndicates(userId),
    fetchAffiliateRevenue(userId),
    fetchSocialPosts(userId),
    fetchPunditStatus(userId),
  ]);

  return {
    userId,
    crmContact,
    bracketDraft,
    bracketHistory,
    syndicates,
    affiliateRevenue,
    socialPosts,
    pundit,
    fetchedAt: new Date().toISOString(),
  };
}
