/**
 * Reddit adapter (stub).
 *
 * Real integration TODO:
 *   - Endpoints (OAuth API):
 *       POST https://oauth.reddit.com/api/submit  (kind=video, sr=<subreddit>)
 *       POST https://oauth.reddit.com/api/v1/access_token  (refresh)
 *   - Auth: OAuth 2.0 script-app or installed-app. For posting on behalf
 *     of /u/vtorn we use a script app with refresh_token=permanent.
 *   - Required env vars:
 *       REDDIT_CLIENT_ID
 *       REDDIT_CLIENT_SECRET
 *       REDDIT_USERNAME
 *       REDDIT_PASSWORD             (script app — script flow only)
 *       REDDIT_USER_AGENT           (e.g. "vtorn-social-publisher/0.1")
 *   - Variant: clip.paths.v16x9 (Reddit inline video plays at native
 *     aspect; landscape works best for sports subs).
 *   - Caption: title from pickCaption(clip, 'en'); body left empty (link
 *     posts; hashtags ignored by Reddit).
 *   - Rate limits: 60 requests / minute / OAuth-token (per the docs);
 *     subreddit-specific posting cooldowns must be respected separately.
 *   - Subreddit selection driven by the policy router (e.g. r/soccer for
 *     wc26 goals). Per-tournament map lives in config/social-policy.json.
 */

import type { Adapter, ClipReady, PostMetrics, PostRecord, PublishContext, PublishResult } from '../../types.js';
import { mockExternalId, mockMetrics, mockUrl } from '../stub.js';

export const redditAdapter: Adapter = {
  platform: 'reddit',
  async publish(clip: ClipReady, _ctx: PublishContext): Promise<PublishResult> {
    const externalId = mockExternalId('reddit', clip);
    return { externalId, url: mockUrl('reddit', externalId) };
  },
  async pullMetrics(post: PostRecord): Promise<PostMetrics> {
    return mockMetrics(post);
  },
};
