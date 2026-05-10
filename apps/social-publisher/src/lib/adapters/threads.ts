/**
 * Threads adapter (stub).
 *
 * Real integration TODO:
 *   - Endpoints (Threads Graph API):
 *       POST /{threads-user-id}/threads          (create container, media_type=VIDEO)
 *       POST /{threads-user-id}/threads_publish  (publish creation_id)
 *   - Auth: same Meta OAuth pipeline as Instagram, but a separate app
 *     scope (`threads_basic`, `threads_content_publish`).
 *   - Required env vars:
 *       THREADS_GRAPH_TOKEN
 *       THREADS_USER_ID
 *       THREADS_APP_ID, THREADS_APP_SECRET
 *   - Variant: clip.paths.v9x16 preferred (Threads renders vertical native).
 *   - Caption: pickCaption(clip, ctx.locale); hashtags inline, no comment trick.
 *   - Rate limits: ~250 posts / user / 24h (shared with Instagram in the same
 *     business account).
 */

import type { Adapter, ClipReady, PostMetrics, PostRecord, PublishContext, PublishResult } from '../../types.js';
import { mockExternalId, mockMetrics, mockUrl } from '../stub.js';

export const threadsAdapter: Adapter = {
  platform: 'threads',
  async publish(clip: ClipReady, _ctx: PublishContext): Promise<PublishResult> {
    const externalId = mockExternalId('threads', clip);
    return { externalId, url: mockUrl('threads', externalId) };
  },
  async pullMetrics(post: PostRecord): Promise<PostMetrics> {
    return mockMetrics(post);
  },
};
