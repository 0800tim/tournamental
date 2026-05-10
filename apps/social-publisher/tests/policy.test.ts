import { describe, it, expect } from 'vitest';

import { loadPolicy, platformsFor, type SocialPolicy } from '../src/lib/policy.js';

describe('policy router', () => {
  const policy: SocialPolicy = {
    default: {
      goal: ['x', 'tiktok'],
      'red-card': ['x'],
    },
    tournaments: {
      wc26: {
        goal: ['tiktok', 'instagram-reels', 'reddit'],
      },
    },
  };

  it('falls back to default when no tournament override', () => {
    expect(platformsFor(policy, 'fifa-wc-2022', 'goal')).toEqual(['x', 'tiktok']);
  });

  it('uses tournament override when present', () => {
    expect(platformsFor(policy, 'wc26', 'goal')).toEqual([
      'tiktok',
      'instagram-reels',
      'reddit',
    ]);
  });

  it('returns [] for an event type with no policy', () => {
    expect(platformsFor(policy, 'wc26', 'penalty')).toEqual([]);
  });

  it('falls back to default for an unknown tournament', () => {
    expect(platformsFor(policy, 'unknown-cup', 'red-card')).toEqual(['x']);
  });

  it('drops platforms not in the adapter registry', () => {
    const dirty: SocialPolicy = {
      default: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        goal: ['x', 'mastodon' as any, 'tiktok'],
      },
    };
    expect(platformsFor(dirty, 'wc26', 'goal')).toEqual(['x', 'tiktok']);
  });

  it('loads and parses the bundled config/social-policy.json', () => {
    const loaded = loadPolicy();
    expect(loaded.default.goal).toBeDefined();
    expect(Array.isArray(loaded.default.goal)).toBe(true);
    // $comment is stripped from the loaded shape
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((loaded as any).$comment).toBeUndefined();
    expect(loaded.tournaments?.wc26).toBeDefined();
  });
});
