/**
 * Tiny per-key file cache for the stats scraper.
 *
 * Layout: `data/stats-cache/<kind>/<key>.json`
 *
 * Where `<kind>` is `form` | `h2h` | `stats`, and `<key>` is the team
 * code (`arg`), the alpha-sorted pair (`arg-fra`), or the team-code
 * again for season aggregates. Keys are lowercased on disk for OS
 * portability.
 *
 * Default TTL is 24h; pass `--force-refresh` from the CLI to ignore it
 * (handled at the runner level — this module just exposes `invalidate()`).
 *
 * Pure-ish: file I/O is the only side effect. No network.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { CacheEntry } from "./types.js";

const HERE = dirname(fileURLToPath(import.meta.url));
// HERE = .../apps/wc2026-data/src/stats → up two = apps/wc2026-data
const DEFAULT_CACHE_ROOT = resolve(HERE, "..", "..", "data", "stats-cache");
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24h

export type CacheKind = "form" | "h2h" | "stats";

export interface StatsCacheOptions {
  readonly root?: string;
  readonly ttlMs?: number;
  readonly nowMs?: () => number;
}

export class StatsCache {
  private readonly root: string;
  private readonly ttlMs: number;
  private readonly nowMs: () => number;

  constructor(opts: StatsCacheOptions = {}) {
    this.root = opts.root ?? DEFAULT_CACHE_ROOT;
    this.ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
    this.nowMs = opts.nowMs ?? Date.now;
  }

  /**
   * Fetch a cached payload if it's fresh. Returns `null` on a cache
   * miss, an unparseable file, or an expired entry.
   */
  read<T>(kind: CacheKind, key: string): T | null {
    const path = this.pathFor(kind, key);
    if (!existsSync(path)) return null;
    let raw: string;
    try {
      raw = readFileSync(path, "utf8");
    } catch {
      return null;
    }
    let parsed: CacheEntry<T>;
    try {
      parsed = JSON.parse(raw) as CacheEntry<T>;
    } catch {
      return null;
    }
    if (!parsed?.fetchedAt) return null;
    const fetched = Date.parse(parsed.fetchedAt);
    if (!Number.isFinite(fetched)) return null;
    if (this.nowMs() - fetched > this.ttlMs) return null;
    return parsed.payload;
  }

  write<T>(kind: CacheKind, key: string, payload: T): void {
    const entry: CacheEntry<T> = {
      fetchedAt: new Date(this.nowMs()).toISOString(),
      payload,
    };
    const path = this.pathFor(kind, key);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(entry, null, 2) + "\n", "utf8");
  }

  /** Drop one cached entry. Idempotent. */
  invalidate(kind: CacheKind, key: string): void {
    const path = this.pathFor(kind, key);
    if (existsSync(path)) rmSync(path);
  }

  /** Drop all entries of a kind (e.g. when the upstream shape changes). */
  invalidateKind(kind: CacheKind): void {
    const dir = resolve(this.root, kind);
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  }

  private pathFor(kind: CacheKind, key: string): string {
    return resolve(this.root, kind, `${normaliseKey(key)}.json`);
  }
}

export function normaliseKey(key: string): string {
  // Lowercase + replace anything outside [a-z0-9-] with `-` so we can't
  // collide on filesystem rules. Pair keys come in as `ARG-FRA`; team
  // keys are 3-letter codes.
  return key.toLowerCase().replace(/[^a-z0-9-]/g, "-");
}
