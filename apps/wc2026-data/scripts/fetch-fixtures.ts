/**
 * Fetch + normalise WC2026 fixtures from a configurable upstream API.
 *
 * Pulls a JSON document from `FIXTURE_SOURCE_URL`, normalises every match
 * into the bracket-engine's `GroupFixture` / `KnockoutFixture` shape, and
 * writes the merged output to
 * `packages/bracket-engine/data/fifa-wc-2026-fixtures.json` (deterministic:
 * sorted keys, 2-space indent, trailing newline).
 *
 * Why a Node script for a Python app?
 * The Python `regenerate_real_draw.py` builds the canonical fixtures from
 * a hand-curated snapshot. This TS script is the *online refresh path* —
 * it replaces just the kickoff times (and venues, when they change) from a
 * trusted upstream JSON feed without touching the team metadata. Run it
 * nightly via cron once we wire a real upstream feed (see TODO in PR).
 *
 * Run:
 *   FIXTURE_SOURCE_URL=https://... npx tsx scripts/fetch-fixtures.ts
 *   FIXTURE_SOURCE_URL=https://... npx tsx scripts/fetch-fixtures.ts --dry-run
 */

import { writeFileSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// ---------- types ----------

export interface UpstreamMatch {
  /** FIFA-canonical match number 1..104. */
  readonly match_no: number;
  /** Group letter ("A".."L") for group-stage matches; absent for knockouts. */
  readonly group_id?: string;
  /** Knockout fixture id ("r32_01" etc.) for knockouts; absent for groups. */
  readonly knockout_id?: string;
  /** ISO-8601 kickoff in UTC. */
  readonly kickoff_utc: string;
  readonly venue?: string;
  readonly host?: "US" | "CA" | "MX";
}

export interface UpstreamPayload {
  readonly matches: readonly UpstreamMatch[];
}

export interface NormalisedFixtureMap {
  /** match_no (string) → kickoff_utc + optional venue/host updates for groups. */
  readonly groups: Record<
    string,
    { kickoff_utc: string; venue?: string; host?: "US" | "CA" | "MX" }
  >;
  /** knockout id ("r32_01") → kickoff_utc + optional venue/host. */
  readonly knockouts: Record<
    string,
    { kickoff_utc: string; venue?: string; host?: "US" | "CA" | "MX" }
  >;
}

// ---------- pure helpers (covered by tests) ----------

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

export function isIsoUtc(s: unknown): s is string {
  return typeof s === "string" && ISO_RE.test(s) && !Number.isNaN(Date.parse(s));
}

/**
 * Normalise an upstream payload into the engine's shape. Throws on
 * malformed entries so a bad feed never silently corrupts the bundled
 * JSON.
 */
export function normalise(payload: UpstreamPayload): NormalisedFixtureMap {
  const groups: NormalisedFixtureMap["groups"] = {};
  const knockouts: NormalisedFixtureMap["knockouts"] = {};
  if (!payload || !Array.isArray(payload.matches)) {
    throw new Error("upstream payload missing `matches` array");
  }
  for (const m of payload.matches) {
    if (typeof m.match_no !== "number" || !Number.isFinite(m.match_no)) {
      throw new Error(`match missing match_no: ${JSON.stringify(m)}`);
    }
    if (!isIsoUtc(m.kickoff_utc)) {
      throw new Error(
        `match ${m.match_no} has invalid kickoff_utc: ${String(m.kickoff_utc)}`,
      );
    }
    const isGroup = m.match_no <= 72 && !m.knockout_id;
    if (isGroup) {
      groups[String(m.match_no)] = {
        kickoff_utc: m.kickoff_utc,
        ...(m.venue ? { venue: m.venue } : {}),
        ...(m.host ? { host: m.host } : {}),
      };
    } else if (m.knockout_id) {
      knockouts[m.knockout_id] = {
        kickoff_utc: m.kickoff_utc,
        ...(m.venue ? { venue: m.venue } : {}),
        ...(m.host ? { host: m.host } : {}),
      };
    } else {
      throw new Error(
        `match ${m.match_no} >72 must include knockout_id (got: ${JSON.stringify(m)})`,
      );
    }
  }
  return { groups, knockouts };
}

interface BracketFixturesDoc {
  _meta: Record<string, unknown>;
  group_fixtures: Array<Record<string, unknown> & { match_no: number }>;
  knockouts: Array<Record<string, unknown> & { id: string }>;
  [k: string]: unknown;
}

/**
 * Splice a normalised feed into an existing bracket-engine fixtures doc.
 * Returns a new doc; caller writes it to disk. Pure function so tests can
 * exercise it without the filesystem.
 */
export function spliceFixtures(
  existing: BracketFixturesDoc,
  feed: NormalisedFixtureMap,
  fetchedAtUtc: string,
): BracketFixturesDoc {
  const next: BracketFixturesDoc = {
    ...existing,
    _meta: {
      ...existing._meta,
      fetched_at_utc: fetchedAtUtc,
      schedule_status: "official",
    },
    group_fixtures: existing.group_fixtures.map((f) => {
      const key = String(f.match_no);
      const upd = feed.groups[key];
      if (!upd) return f;
      return {
        ...f,
        kickoff_utc: upd.kickoff_utc,
        ...(upd.venue ? { venue: upd.venue } : {}),
        ...(upd.host ? { host: upd.host } : {}),
      };
    }),
    knockouts: existing.knockouts.map((k) => {
      const upd = feed.knockouts[k.id];
      if (!upd) return k;
      return {
        ...k,
        kickoff_utc: upd.kickoff_utc,
        ...(upd.venue ? { venue: upd.venue } : {}),
        ...(upd.host ? { host: upd.host } : {}),
      };
    }),
  };
  return next;
}

/** Deterministic JSON: sorted keys, 2-space indent, trailing newline. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(value, sortedReplacer(), 2) + "\n";
}

function sortedReplacer() {
  // JSON.stringify replacer doesn't sort keys; we walk the object first.
  return (_key: string, val: unknown): unknown => {
    if (val && typeof val === "object" && !Array.isArray(val)) {
      const sorted: Record<string, unknown> = {};
      for (const k of Object.keys(val).sort()) {
        sorted[k] = (val as Record<string, unknown>)[k];
      }
      return sorted;
    }
    return val;
  };
}

// ---------- IO (only invoked by main()) ----------

export interface FetcherDeps {
  readonly fetch: typeof globalThis.fetch;
  readonly readFile: (path: string) => string;
  readonly writeFile: (path: string, body: string) => void;
  readonly now: () => Date;
}

export async function runFetch(args: {
  sourceUrl: string;
  outPath: string;
  dryRun?: boolean;
  deps: FetcherDeps;
}): Promise<{ writtenPath: string | null; doc: BracketFixturesDoc }> {
  const res = await args.deps.fetch(args.sourceUrl);
  if (!res.ok) {
    throw new Error(
      `upstream returned HTTP ${res.status} ${res.statusText} for ${args.sourceUrl}`,
    );
  }
  const payload = (await res.json()) as UpstreamPayload;
  const feed = normalise(payload);
  const existingRaw = args.deps.readFile(args.outPath);
  const existing = JSON.parse(existingRaw) as BracketFixturesDoc;
  const doc = spliceFixtures(existing, feed, args.deps.now().toISOString());
  if (args.dryRun) {
    return { writtenPath: null, doc };
  }
  args.deps.writeFile(args.outPath, stableStringify(doc));
  return { writtenPath: args.outPath, doc };
}

async function main(): Promise<void> {
  const sourceUrl = process.env.FIXTURE_SOURCE_URL;
  if (!sourceUrl) {
    console.error(
      "FIXTURE_SOURCE_URL is required. Example: " +
        "FIXTURE_SOURCE_URL=https://... npx tsx scripts/fetch-fixtures.ts",
    );
    process.exit(2);
  }
  const dryRun = process.argv.includes("--dry-run");
  const here = dirname(fileURLToPath(import.meta.url));
  // scripts/ → ../../../packages/bracket-engine/data/...
  const outPath = resolve(
    here,
    "..",
    "..",
    "..",
    "packages",
    "bracket-engine",
    "data",
    "fifa-wc-2026-fixtures.json",
  );
  const result = await runFetch({
    sourceUrl,
    outPath,
    dryRun,
    deps: {
      fetch: globalThis.fetch,
      readFile: (p) => readFileSync(p, "utf-8"),
      writeFile: (p, body) => writeFileSync(p, body, "utf-8"),
      now: () => new Date(),
    },
  });
  if (result.writtenPath) {
    console.log(`wrote ${result.writtenPath}`);
  } else {
    console.log("dry-run: doc generated, not written");
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
