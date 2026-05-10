/**
 * Discord adapter (stub).
 *
 * Real integration TODO:
 *   - Endpoint: configured webhook URL (multipart for file upload):
 *       POST {DISCORD_WEBHOOK_URL}
 *     with body parts `payload_json` (content/embeds) and `file[0]`.
 *   - Auth: webhook URL itself is the secret. No OAuth.
 *   - Required env vars:
 *       DISCORD_BRAND_WEBHOOK_URL    (the #goals channel webhook in the
 *                                    VTourn Discord guild)
 *   - Variant: clip.paths.v16x9 (Discord embeds render landscape best);
 *     v9x16 acceptable but desktop client letterboxes.
 *   - Caption: pickCaption(clip, ctx.locale); hashtags omitted (Discord
 *     ignores them and they read like spam).
 *   - Rate limits: 5 requests / 2 sec / webhook; 30 / 60 sec global. The
 *     adapter must respect the `X-RateLimit-Reset-After` header on 429s.
 */

import type { Adapter, ClipReady, PostMetrics, PostRecord, PublishContext, PublishResult } from '../../types.js';
import { mockExternalId, mockMetrics, mockUrl } from '../stub.js';

export const discordAdapter: Adapter = {
  platform: 'discord',
  async publish(clip: ClipReady, _ctx: PublishContext): Promise<PublishResult> {
    const externalId = mockExternalId('discord', clip);
    return { externalId, url: mockUrl('discord', externalId) };
  },
  async pullMetrics(post: PostRecord): Promise<PostMetrics> {
    // Discord webhooks expose no metrics. Reactions / views require a real
    // bot token + channels.messages.get with a Gateway connection. Stub
    // returns zeros so callers don't get misleading numbers.
    return { views: 0, likes: 0, comments: 0, shares: 0 };
  },
};
