/**
 * TikTok adapter (stub).
 *
 * Real integration TODO:
 *   - Endpoint: https://open.tiktokapis.com/v2/post/publish/inbox/video/init/
 *     (Content Posting API — Direct Post or Inbox flow)
 *   - Auth: Bearer access token. Refresh via OAuth 2.0 client_credentials.
 *   - Required env vars:
 *       TIKTOK_CLIENT_KEY
 *       TIKTOK_CLIENT_SECRET
 *       TIKTOK_ACCESS_TOKEN     (refreshed)
 *       TIKTOK_OPEN_ID          (creator account)
 *   - Variant: clip.paths.v9x16 (must be 9:16, < 60s for Direct Post v0).
 *   - Caption: pickCaption(clip, ctx.locale) + ' ' + clip.hashtags joined.
 *   - Rate limits: ~50 posts / creator / day; back off on HTTP 429.
 *   - Error model: map non-2xx + non-2xx body.error.code → throw with code.
 */

import type { Adapter, ClipReady, PostMetrics, PostRecord, PublishContext, PublishResult } from '../../types.js';
import { mockExternalId, mockMetrics, mockUrl } from '../stub.js';

export const tiktokAdapter: Adapter = {
  platform: 'tiktok',
  async publish(clip: ClipReady, _ctx: PublishContext): Promise<PublishResult> {
    const externalId = mockExternalId('tiktok', clip);
    return { externalId, url: mockUrl('tiktok', externalId) };
  },
  async pullMetrics(post: PostRecord): Promise<PostMetrics> {
    return mockMetrics(post);
  },
};
