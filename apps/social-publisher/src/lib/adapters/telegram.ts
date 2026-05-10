/**
 * Telegram adapter (stub).
 *
 * Real integration TODO:
 *   - Endpoint: https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendVideo
 *     (multipart upload with `chat_id`, `video`, `caption`, `parse_mode=HTML`)
 *   - Auth: Bot token (no OAuth refresh needed).
 *   - Required env vars:
 *       TELEGRAM_BOT_TOKEN          (from @BotFather)
 *       TELEGRAM_BRAND_CHANNEL_ID   (e.g. @vtorn or -100xxxxxxxxxx)
 *   - Reuse: prefer importing the existing tournament-bot push helper if
 *     it's exported as a workspace package (it isn't yet — see
 *     apps/tournament-bot). For v0.1 we shell out to the bot HTTP API.
 *   - Variant: clip.paths.v16x9 (Telegram inline video plays best at 16:9
 *     in clients; vertical gets cropped on desktop).
 *   - Caption: pickCaption(clip, ctx.locale) + hashtags joined.
 *   - Rate limits: 30 messages / sec global, 20 / min to the same chat.
 */

import type { Adapter, ClipReady, PostMetrics, PostRecord, PublishContext, PublishResult } from '../../types.js';
import { mockExternalId, mockMetrics, mockUrl } from '../stub.js';

export const telegramAdapter: Adapter = {
  platform: 'telegram',
  async publish(clip: ClipReady, _ctx: PublishContext): Promise<PublishResult> {
    const externalId = mockExternalId('telegram', clip);
    return { externalId, url: mockUrl('telegram', externalId) };
  },
  async pullMetrics(post: PostRecord): Promise<PostMetrics> {
    return mockMetrics(post);
  },
};
