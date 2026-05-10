/**
 * Instagram Reels adapter (stub).
 *
 * STATUS: stub-only. The Graph API requires Meta App Review with
 * `instagram_content_publish` advanced access — typically a 4-6 week
 * back-and-forth for a creator account. Real integration ships once the
 * app is approved.
 *
 * Real integration TODO:
 *   - Endpoints (Graph API v19+):
 *       POST /{ig-user-id}/media          (upload container, media_type=REELS)
 *       POST /{ig-user-id}/media_publish  (publish container_id)
 *   - Auth: long-lived Page access token; refresh every 60 days.
 *   - Required env vars:
 *       IG_GRAPH_TOKEN          (page access token)
 *       IG_USER_ID              (Instagram business / creator account ID)
 *       IG_APP_ID, IG_APP_SECRET (for token refresh)
 *   - Variant: clip.paths.v9x16 (Reels are 9:16, 3–90s).
 *   - Caption: pickCaption(clip, ctx.locale); first 5 hashtags in caption,
 *     remainder posted as the first comment via /{media-id}/comments.
 *   - Rate limits: 25 publishes / IG account / 24h; expect HTTP 4 with
 *     OAuthException code 4 on quota exhaustion.
 */

import type { Adapter, ClipReady, PostMetrics, PostRecord, PublishContext, PublishResult } from '../../types.js';
import { mockExternalId, mockMetrics, mockUrl } from '../stub.js';

export const instagramReelsAdapter: Adapter = {
  platform: 'instagram-reels',
  async publish(clip: ClipReady, _ctx: PublishContext): Promise<PublishResult> {
    const externalId = mockExternalId('instagram-reels', clip);
    return { externalId, url: mockUrl('instagram-reels', externalId) };
  },
  async pullMetrics(post: PostRecord): Promise<PostMetrics> {
    return mockMetrics(post);
  },
};
