/**
 * YouTube Shorts adapter (stub).
 *
 * STATUS: stub-only. YouTube Data API requires Google OAuth verification
 * (sensitive scopes) before a non-test app can upload on behalf of a
 * channel. The verification queue runs 2-4 weeks. Real integration ships
 * once the app is verified.
 *
 * Real integration TODO:
 *   - Endpoint: https://www.googleapis.com/upload/youtube/v3/videos?part=snippet,status
 *     with `?notifySubscribers=false` and snippet.tags including '#Shorts'.
 *   - Auth: OAuth 2.0 (offline access). Persist refresh token; access token
 *     auto-refreshes via google-auth-library.
 *   - Required env vars:
 *       YT_CLIENT_ID
 *       YT_CLIENT_SECRET
 *       YT_OAUTH_REFRESH        (refresh token for the channel)
 *       YT_CHANNEL_ID
 *   - Variant: clip.paths.v9x16 (vertical, < 60s qualifies as a Short).
 *   - Caption: title from pickCaption(clip, 'en'); description gets the
 *     localised caption + hashtags joined (max 3 in description, always
 *     append '#Shorts').
 *   - Quota: 10,000 units / day; an upload costs 1,600 units → ~6 / day.
 *     Hard-cap publishes per channel per day in the policy router.
 */

import type { Adapter, ClipReady, PostMetrics, PostRecord, PublishContext, PublishResult } from '../../types.js';
import { mockExternalId, mockMetrics, mockUrl } from '../stub.js';

export const youtubeShortsAdapter: Adapter = {
  platform: 'youtube-shorts',
  async publish(clip: ClipReady, _ctx: PublishContext): Promise<PublishResult> {
    const externalId = mockExternalId('youtube-shorts', clip);
    return { externalId, url: mockUrl('youtube-shorts', externalId) };
  },
  async pullMetrics(post: PostRecord): Promise<PostMetrics> {
    return mockMetrics(post);
  },
};
