/**
 * Operator + advertiser store for the v0.1 admin dashboard.
 *
 * v0.1 backing store is JSONL on disk (one record per line) under
 * `apps/admin/data/`. This keeps the surface diff-friendly, auditable in
 * git history during early ops, and trivial to migrate to Postgres later.
 *
 * Compliance: NZ TAB has a state-mandated monopoly on sports betting in
 * New Zealand. Any operator marked `kind: "sportsbook"` MUST list `NZ`
 * in `geo_deny`. The PATCH route enforces this server-side and returns
 * 422 when violated. We also enforce it on read-after-write here so the
 * UI cannot quietly mutate a sportsbook into a non-compliant state.
 *
 * The store keeps the on-disk file as the source of truth and avoids
 * caching across requests; admin write volume is tiny and read latency
 * is dominated by the network anyway.
 */

import { promises as fs } from "node:fs";
import path from "node:path";

// ---------------- types -------------------------------------------------

export type OperatorKind = "sportsbook" | "prediction-market" | "paytv-stream";
export type OperatorStatus = "active" | "paused";

export interface OperatorRecord {
  slug: string;
  name: string;
  kind: OperatorKind;
  /** URL pattern with `{code}`, `{surface}`, `{match_id}` placeholders. */
  affiliate_url_pattern: string;
  /** ISO-3166-1 alpha-2 (uppercase). */
  geo_allow: string[];
  /** ISO-3166-1 alpha-2 (uppercase). NZ MUST appear when kind=sportsbook. */
  geo_deny: string[];
  revenue_share_pct: number;
  status: OperatorStatus;
  clicks_7d: number;
  conversions_7d: number;
  revenue_units_7d: number;
  contact_email: string;
  notes: string;
  updated_at: string; // ISO
}

export type AdvertiserSurface = "bracket" | "leaderboard" | "match";
export type AdvertiserStatus = "active" | "paused";

export interface AdvertiserRecord {
  id: string;
  name: string;
  surface: AdvertiserSurface;
  tournament: string;
  geo_allow: string[];
  status: AdvertiserStatus;
  ecpm_units: number;
  fill_rate_pct: number;
  impressions_7d: number;
  clicks_7d: number;
  revenue_units_7d: number;
  flight_start: string; // YYYY-MM-DD
  flight_end: string; // YYYY-MM-DD
  contact_email: string;
  creative_url: string;
  notes: string;
  updated_at: string; // ISO
}

export interface RevenueRow {
  day: string; // YYYY-MM-DD
  operator_units: number;
  advertiser_units: number;
  drips_units: number;
}

// ---------------- compliance helpers ------------------------------------

/**
 * Hard-coded compliance rule: a sportsbook MUST deny NZ. Returns null when
 * the record is compliant, or a human-readable reason when not. The
 * matching server route returns 422 on any non-null reason.
 */
export function operatorComplianceError(op: OperatorRecord): string | null {
  if (op.kind === "sportsbook" && !op.geo_deny.map((c) => c.toUpperCase()).includes("NZ")) {
    return "Sportsbook operators must include NZ in geo_deny (TAB monopoly rule).";
  }
  // Defensive: a country cannot be both allowed and denied.
  const allowSet = new Set(op.geo_allow.map((c) => c.toUpperCase()));
  for (const d of op.geo_deny) {
    if (allowSet.has(d.toUpperCase())) {
      return `Country ${d.toUpperCase()} cannot appear in both geo_allow and geo_deny.`;
    }
  }
  return null;
}

// ---------------- JSONL plumbing ----------------------------------------

const ROOT = process.env.ADMIN_OPS_DATA_DIR
  ?? path.join(process.cwd(), "data");

function pathFor(name: "operators" | "advertisers" | "revenue"): string {
  return path.join(ROOT, `${name}.jsonl`);
}

async function readJsonl<T>(file: string): Promise<T[]> {
  let raw: string;
  try {
    raw = await fs.readFile(file, "utf-8");
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "ENOENT") return [];
    throw err;
  }
  return raw
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l) as T);
}

async function writeJsonl<T>(file: string, rows: T[]): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const body = rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : "");
  await fs.writeFile(file, body, { encoding: "utf-8" });
}

// ---------------- public store API --------------------------------------

export async function listOperators(): Promise<OperatorRecord[]> {
  return readJsonl<OperatorRecord>(pathFor("operators"));
}

export async function getOperator(slug: string): Promise<OperatorRecord | null> {
  const rows = await listOperators();
  return rows.find((r) => r.slug === slug) ?? null;
}

/**
 * Patch an operator. Returns the new record, or throws an Error whose
 * message is the compliance reason on rule violation.
 */
export async function patchOperator(
  slug: string,
  patch: Partial<OperatorRecord>,
): Promise<{ before: OperatorRecord; after: OperatorRecord }> {
  const rows = await listOperators();
  const idx = rows.findIndex((r) => r.slug === slug);
  if (idx === -1) throw new Error("not_found");
  const before = rows[idx]!;
  // Disallow slug rewrites — slug is the identity.
  const { slug: _ignoreSlug, ...safePatch } = patch;
  const after: OperatorRecord = {
    ...before,
    ...safePatch,
    geo_allow: (safePatch.geo_allow ?? before.geo_allow).map((c) => c.toUpperCase()),
    geo_deny: (safePatch.geo_deny ?? before.geo_deny).map((c) => c.toUpperCase()),
    updated_at: new Date().toISOString(),
  };
  const reason = operatorComplianceError(after);
  if (reason) {
    const err = new Error(reason);
    (err as Error & { compliance: true }).compliance = true;
    throw err;
  }
  rows[idx] = after;
  await writeJsonl(pathFor("operators"), rows);
  return { before, after };
}

export async function listAdvertisers(): Promise<AdvertiserRecord[]> {
  return readJsonl<AdvertiserRecord>(pathFor("advertisers"));
}

export async function getAdvertiser(id: string): Promise<AdvertiserRecord | null> {
  const rows = await listAdvertisers();
  return rows.find((r) => r.id === id) ?? null;
}

export async function patchAdvertiser(
  id: string,
  patch: Partial<AdvertiserRecord>,
): Promise<{ before: AdvertiserRecord; after: AdvertiserRecord }> {
  const rows = await listAdvertisers();
  const idx = rows.findIndex((r) => r.id === id);
  if (idx === -1) throw new Error("not_found");
  const before = rows[idx]!;
  const { id: _ignoreId, ...safePatch } = patch;
  const after: AdvertiserRecord = {
    ...before,
    ...safePatch,
    geo_allow: (safePatch.geo_allow ?? before.geo_allow).map((c) => c.toUpperCase()),
    updated_at: new Date().toISOString(),
  };
  rows[idx] = after;
  await writeJsonl(pathFor("advertisers"), rows);
  return { before, after };
}

export async function listRevenue(): Promise<RevenueRow[]> {
  return readJsonl<RevenueRow>(pathFor("revenue"));
}

export interface RevenueSummary {
  total_units_7d: number;
  operator_units_7d: number;
  advertiser_units_7d: number;
  drips_units_7d: number;
  rows: RevenueRow[];
}

export async function revenueSummary(): Promise<RevenueSummary> {
  const rows = await listRevenue();
  const op = rows.reduce((s, r) => s + r.operator_units, 0);
  const ad = rows.reduce((s, r) => s + r.advertiser_units, 0);
  const drips = rows.reduce((s, r) => s + r.drips_units, 0);
  return {
    total_units_7d: op + ad + drips,
    operator_units_7d: op,
    advertiser_units_7d: ad,
    drips_units_7d: drips,
    rows,
  };
}

// ---------------- diff helper for audit ---------------------------------

/**
 * Produce a small `{ before, after }` diff with only the keys that changed.
 * Used in audit-log entries so we don't dump entire records every edit.
 */
export function shallowDiff<T extends Record<string, unknown>>(
  before: T,
  after: T,
): { before: Partial<T>; after: Partial<T> } {
  const b: Partial<T> = {};
  const a: Partial<T> = {};
  const keys = new Set<keyof T>([...Object.keys(before), ...Object.keys(after)] as (keyof T)[]);
  for (const k of keys) {
    if (k === "updated_at") continue;
    const lhs = before[k];
    const rhs = after[k];
    if (JSON.stringify(lhs) !== JSON.stringify(rhs)) {
      b[k] = lhs;
      a[k] = rhs;
    }
  }
  return { before: b, after: a };
}
