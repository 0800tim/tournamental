import { describe, it, expect } from 'vitest';

import { ALL_PLATFORMS, ADAPTERS } from '../src/lib/adapters/index.js';
import type { PostRecord } from '../src/types.js';
import { makeClip } from './fixtures.js';

describe('adapters', () => {
  it('registers exactly the 8 platforms we ship', () => {
    expect(ALL_PLATFORMS.sort()).toEqual(
      [
        'discord',
        'instagram-reels',
        'reddit',
        'telegram',
        'threads',
        'tiktok',
        'x',
        'youtube-shorts',
      ].sort(),
    );
  });

  for (const platform of ALL_PLATFORMS) {
    describe(`${platform} adapter`, () => {
      const adapter = ADAPTERS[platform];

      it('returns a deterministic mock externalId for the same clip', async () => {
        const clip = makeClip();
        const a = await adapter.publish(clip, {});
        const b = await adapter.publish(clip, {});
        expect(a.externalId).toBe(b.externalId);
        expect(a.url).toBe(b.url);
        expect(a.externalId).toMatch(/^[a-f0-9]{12}$/);
        expect(a.url.startsWith('https://')).toBe(true);
      });

      it('returns different externalIds for different clips', async () => {
        const a = await adapter.publish(makeClip({ clipId: 'clip_a' }), {});
        const b = await adapter.publish(makeClip({ clipId: 'clip_b' }), {});
        expect(a.externalId).not.toBe(b.externalId);
      });

      it('exposes the matching platform tag', () => {
        expect(adapter.platform).toBe(platform);
      });

      it('pullMetrics returns numeric counters', async () => {
        const post: PostRecord = {
          ts: 1_715_000_000_000,
          platform,
          externalId: 'abc123def456',
          url: 'https://example.com/x',
          clipId: 'clip_test_001',
          eventType: 'goal',
          status: 'published',
          tournamentId: 'fifa-wc-2022',
          matchId: 'fifa-wc-2022-final-arg-fra',
        };
        const m = await adapter.pullMetrics(post);
        expect(m.views).toBeGreaterThanOrEqual(0);
        expect(m.likes).toBeGreaterThanOrEqual(0);
        expect(m.comments).toBeGreaterThanOrEqual(0);
        expect(m.shares).toBeGreaterThanOrEqual(0);
      });
    });
  }
});
