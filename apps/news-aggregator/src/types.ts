/**
 * Common shape every source normalises to. We deliberately keep this
 * narrow — the goal is "title + link out" rather than rehosting full
 * articles, so we never store article bodies.
 *
 * `id` is a stable hash of (source, link). Sources occasionally rotate
 * GUIDs without changing the article, so we derive ids ourselves rather
 * than trusting upstream `<guid>` values.
 */
import { z } from 'zod';

export const NewsItemSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  summary: z.string().default(''),
  url: z.string().url(),
  source: z.string().min(1),
  sourceLogo: z.string().url().optional(),
  publishedAt: z.string().datetime(),
  language: z.string().min(2).max(8).default('en'),
  tags: z.array(z.string()).default([]),
  imageUrl: z.string().url().optional(),
  imageCredit: z.string().optional(),
});

export type NewsItem = z.infer<typeof NewsItemSchema>;

/**
 * Source health snapshot, surfaced via /v1/sources for ops.
 */
export interface SourceHealth {
  readonly id: string;
  readonly displayName: string;
  readonly enabled: boolean;
  readonly language: string;
  readonly lastFetch: string | null;
  readonly lastSuccess: string | null;
  readonly errorCount: number;
  readonly lastError: string | null;
  readonly itemCount: number;
}

/**
 * Per-source contract. Each source file in src/sources/ exports a
 * `descriptor` that the fetcher uses to drive the polling loop.
 */
export interface SourceDescriptor {
  readonly id: string;
  readonly displayName: string;
  readonly homepage: string;
  readonly feedUrl: string;
  readonly language: string;
  /** Default tags applied to every item from this source. */
  readonly defaultTags: readonly string[];
  /**
   * If false, the fetcher skips the source (used when the source's
   * RSS terms are ambiguous and we want to ship behind a flag).
   */
  readonly enabled: boolean;
  /** A logo URL for cards. Optional — the UI falls back to initials. */
  readonly logoUrl?: string;
  /**
   * Light-touch tag inference. Lets each source classify its own items
   * (e.g. BBC injects "world-cup" if the title mentions WC2026).
   */
  readonly classify?: (title: string, summary: string) => readonly string[];
}
