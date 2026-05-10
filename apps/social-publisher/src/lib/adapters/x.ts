/**
 * X (Twitter) adapter (stub).
 *
 * STATUS: stub-only. X's posting endpoints require the Basic ($200/mo) or
 * Pro ($5,000/mo) tier of the v2 API; media upload still uses the
 * v1.1 endpoint, also gated by paid access. Real integration is gated on
 * Tim signing off on the Basic tier subscription.
 *
 * Real integration TODO:
 *   - Endpoints (X API v2):
 *       POST https://upload.twitter.com/1.1/media/upload.json   (chunked)
 *       POST https://api.twitter.com/2/tweets                   (with media_ids)
 *   - Auth: OAuth 2.0 (PKCE) for posting on behalf of the @vtorn account, OR
 *     OAuth 1.0a user context for the legacy upload endpoint.
 *   - Required env vars:
 *       X_CLIENT_ID
 *       X_CLIENT_SECRET
 *       X_ACCESS_TOKEN          (refreshed via OAuth 2.0)
 *       X_OAUTH1_KEY            (still needed for media/upload.json)
 *       X_OAUTH1_SECRET
 *   - Variant: clip.paths.v16x9 preferred; v1x1 fallback for low-bandwidth
 *     audiences. v9x16 not used on X — vertical video gets letterboxed.
 *   - Caption: pickCaption(clip, ctx.locale); ONE hashtag only (multi-tag
 *     posts get deboosted per docs/27).
 *   - Rate limits: 50 tweets / 15 min for the user context; 300 / 3h app-wide.
 */

import type { Adapter, ClipReady, PostMetrics, PostRecord, PublishContext, PublishResult } from '../../types.js';
import { mockExternalId, mockMetrics, mockUrl } from '../stub.js';

export const xAdapter: Adapter = {
  platform: 'x',
  async publish(clip: ClipReady, _ctx: PublishContext): Promise<PublishResult> {
    const externalId = mockExternalId('x', clip);
    return { externalId, url: mockUrl('x', externalId) };
  },
  async pullMetrics(post: PostRecord): Promise<PostMetrics> {
    return mockMetrics(post);
  },
};
