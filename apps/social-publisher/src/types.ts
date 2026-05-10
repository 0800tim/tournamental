/**
 * Shared types for the social-publisher service.
 *
 * The `ClipReady` event is the single contract between this service and the
 * clip-pipeline. Adapters consume `ClipReady` and produce `PublishResult`.
 */

import { z } from 'zod';

/** Supported social platforms. Keep in sync with `src/lib/adapters/`. */
export const PlatformEnum = z.enum([
  'tiktok',
  'instagram-reels',
  'youtube-shorts',
  'x',
  'threads',
  'telegram',
  'discord',
  'reddit',
]);
export type Platform = z.infer<typeof PlatformEnum>;

/** Match-event categories that drive policy fan-out. */
export const EventTypeEnum = z.enum([
  'goal',
  'red-card',
  'penalty',
  'match-end',
  'bracket-card',
  'tournament-recap',
  'highlight',
]);
export type EventType = z.infer<typeof EventTypeEnum>;

/**
 * The four rendered video / image variants the clip-pipeline produces.
 * - v9x16  vertical for TikTok / Reels / Shorts / Threads
 * - v16x9  landscape for X, YouTube wide, Discord embed
 * - v1x1   square for legacy IG feed and X cards
 * - og     a static OpenGraph card (PNG/JPG) for link unfurls
 */
export const ClipPathsSchema = z.object({
  v9x16: z.string().min(1),
  v16x9: z.string().min(1),
  v1x1: z.string().min(1),
  og: z.string().min(1),
});
export type ClipPaths = z.infer<typeof ClipPathsSchema>;

/** Per-locale captions. Keys are BCP-47 language tags (e.g. en, es, fr, ja). */
export const CaptionsSchema = z.record(z.string().min(1), z.string());
export type Captions = z.infer<typeof CaptionsSchema>;

/**
 * Inbound `ClipReady` event from the clip-pipeline.
 *
 * In v0.1 we accept these via HTTP POST /v1/publish. A Redis-stream listener
 * is the next step (TODO: see src/index.ts).
 */
export const ClipReadySchema = z.object({
  clipId: z.string().min(1),
  paths: ClipPathsSchema,
  captions: CaptionsSchema,
  hashtags: z.array(z.string()).default([]),
  tournamentId: z.string().min(1),
  matchId: z.string().min(1),
  eventType: EventTypeEnum,
});
export type ClipReady = z.infer<typeof ClipReadySchema>;

/** Result of an adapter's `publish` call — the canonical "I posted X" record. */
export interface PublishResult {
  externalId: string;
  url: string;
}

/** Engagement metrics returned by an adapter's `pullMetrics` call. */
export interface PostMetrics {
  views: number;
  likes: number;
  comments: number;
  shares: number;
}

/** Persisted shape of one post in `data/posts.jsonl` (append-only). */
export interface PostRecord {
  ts: number;
  platform: Platform;
  externalId: string;
  url: string;
  clipId: string;
  eventType: EventType;
  status: 'published' | 'failed';
  tournamentId: string;
  matchId: string;
  /** Optional error message if status === 'failed'. */
  error?: string;
}

/**
 * Context passed into every adapter call. Lets adapters pick the right
 * caption / variant / locale without re-deriving policy logic.
 */
export interface PublishContext {
  /** Locale to prefer when picking a caption. Falls back to 'en'. */
  locale?: string;
  /** Per-platform overrides set by the policy router. */
  hint?: 'short-caption' | 'long-caption';
  /** Wall-clock for deterministic stub IDs in tests. */
  now?: () => number;
}

/** Uniform adapter contract. Real implementations call platform APIs. */
export interface Adapter {
  readonly platform: Platform;
  publish(clip: ClipReady, ctx: PublishContext): Promise<PublishResult>;
  pullMetrics(post: PostRecord): Promise<PostMetrics>;
}
