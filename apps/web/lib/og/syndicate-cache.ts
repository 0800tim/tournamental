/**
 * Disk-cache helpers for the pool OG image.
 *
 * Lives outside the route file because Next.js App Router rejects
 * arbitrary named exports from a route module (only GET / POST / etc.
 * and a small allow-list of config exports are permitted). The OG
 * route reads + writes the cache; the syndicate save paths import
 * `invalidateSyndicateOgCache` from here to evict on change.
 */

import { promises as fs } from "node:fs";
import { join } from "node:path";

export type SyndicateOgSize = "landscape" | "portrait" | "square";

export const SYNDICATE_OG_SIZES: ReadonlyArray<SyndicateOgSize> = [
  "landscape",
  "portrait",
  "square",
];

const OG_CACHE_DIR = join(process.cwd(), "public", "og", "syndicate");

/**
 * Normalise a slug for use as part of the on-disk filename. Mirrors
 * the same rule the OG route uses internally so the cache key lines
 * up exactly across read / write / evict paths.
 */
export function safeSyndicateSlug(raw: string): string {
  return (
    raw
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, "_")
      .slice(0, 64) || "demo"
  );
}

export async function writeSyndicateOgCache(
  safeSlug: string,
  size: SyndicateOgSize,
  png: Buffer,
): Promise<string | null> {
  const file = join(OG_CACHE_DIR, `${safeSlug}-${size}.png`);
  try {
    await fs.mkdir(OG_CACHE_DIR, { recursive: true });
    await fs.writeFile(file, png);
    return file;
  } catch {
    return null;
  }
}

export async function readSyndicateOgCache(
  safeSlug: string,
  size: SyndicateOgSize,
): Promise<Buffer | null> {
  const file = join(OG_CACHE_DIR, `${safeSlug}-${size}.png`);
  try {
    return await fs.readFile(file);
  } catch {
    return null;
  }
}

/**
 * Delete every cached OG variant for a pool slug. Call from any
 * write path that changes the rendered output (pool create,
 * branding patch, branding image upload) so the next share-crawler
 * hit re-renders against the fresh data. Best-effort; failures are
 * silent because the cache is a perf optimisation, not a correctness
 * guarantee.
 */
export async function invalidateSyndicateOgCache(slug: string): Promise<void> {
  const safeSlug = safeSyndicateSlug(slug);
  await Promise.allSettled(
    SYNDICATE_OG_SIZES.map((size) =>
      fs.rm(join(OG_CACHE_DIR, `${safeSlug}-${size}.png`), { force: true }),
    ),
  );
}
