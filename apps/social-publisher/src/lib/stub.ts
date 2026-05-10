/**
 * Deterministic stub helpers used by every adapter until real API calls land.
 *
 * The mock external ID is a stable hash of `(platform, clipId, eventType)`,
 * so the same clip + platform always produces the same fake post ID. Tests
 * rely on this. When an adapter wires its real API call, it should drop the
 * call to `mockExternalId` and return the platform-issued ID instead.
 */

import { createHash } from 'node:crypto';

import type { ClipReady, PostMetrics, PostRecord, Platform } from '../types.js';

/** Short, URL-safe deterministic ID for a stub publish. */
export function mockExternalId(platform: Platform, clip: ClipReady): string {
  const h = createHash('sha256')
    .update(`${platform}:${clip.clipId}:${clip.eventType}`)
    .digest('hex');
  // 12-char base, kept short so it looks like a real social media ID.
  return h.slice(0, 12);
}

/** Build a stub URL that mimics each platform's permalink shape. */
export function mockUrl(platform: Platform, externalId: string): string {
  switch (platform) {
    case 'tiktok':
      return `https://www.tiktok.com/@vtorn/video/${externalId}`;
    case 'instagram-reels':
      return `https://www.instagram.com/reel/${externalId}/`;
    case 'youtube-shorts':
      return `https://www.youtube.com/shorts/${externalId}`;
    case 'x':
      return `https://x.com/vtorn/status/${externalId}`;
    case 'threads':
      return `https://www.threads.net/@vtorn/post/${externalId}`;
    case 'telegram':
      return `https://t.me/vtorn/${externalId}`;
    case 'discord':
      return `https://discord.com/channels/vtorn/${externalId}`;
    case 'reddit':
      return `https://www.reddit.com/r/vtorn/comments/${externalId}`;
    case 'whatsapp':
      // WhatsApp group messages have no public permalink. Stub callers
      // that don't configure the gateway still want a stable URL string,
      // so we surface a fragment-only marker keyed by the message id.
      return `https://wa.me/#message-${externalId}`;
  }
}

/**
 * Deterministic mock metrics. We hash the post key to get a stable but
 * varied number per (platform, externalId). When the real metrics-pull
 * lands, drop this and call the platform's analytics endpoint.
 */
export function mockMetrics(post: PostRecord): PostMetrics {
  const seed = createHash('sha256')
    .update(`${post.platform}:${post.externalId}`)
    .digest();
  // Cheap deterministic ints — no need for a PRNG.
  const views = 100 + (seed.readUInt32BE(0) % 9_900);
  const likes = Math.floor(views * 0.04);
  const comments = Math.floor(views * 0.005);
  const shares = Math.floor(views * 0.01);
  return { views, likes, comments, shares };
}

/** Pick the caption for the requested locale, falling back to en, then any. */
export function pickCaption(clip: ClipReady, locale: string | undefined): string {
  const want = locale ?? 'en';
  if (clip.captions[want]) return clip.captions[want]!;
  if (clip.captions.en) return clip.captions.en;
  const first = Object.values(clip.captions)[0];
  return first ?? '';
}
