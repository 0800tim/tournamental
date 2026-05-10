/**
 * Reddit adapter behaviour tests.
 *
 * Covers: OAuth password-grant token exchange + cache, /api/submit form
 * shape, subreddit allowlist, 24h crosspost dedup, 10-min per-sub
 * cooldown, partial vs total failure, title prefix + truncation, and stub
 * fallback when env / config is missing.
 *
 * No real HTTP — RedditOAuthClient gets a mocked fetch.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  buildTitle,
  createRedditAdapter,
  CROSSPOST_WINDOW_MS,
  loadTargetsConfig,
  RedditOAuthClient,
  subredditsFor,
  SUBREDDIT_COOLDOWN_MS,
  type RedditClient,
  type RedditSubmitRequest,
  type RedditSubmitResult,
} from '../src/lib/adapters/reddit.js';
import type { PostMetrics } from '../src/types.js';
import { makeClip } from './fixtures.js';

class StubRedditClient implements RedditClient {
  public readonly calls: RedditSubmitRequest[] = [];
  public fetchMetrics?: (fullname: string) => Promise<PostMetrics>;
  constructor(
    private readonly responder: (req: RedditSubmitRequest, idx: number) => RedditSubmitResult,
  ) {}
  async submit(req: RedditSubmitRequest): Promise<RedditSubmitResult> {
    const idx = this.calls.length;
    this.calls.push(req);
    return this.responder(req, idx);
  }
}

const okResponder =
  () =>
  (req: RedditSubmitRequest, idx: number): RedditSubmitResult => ({
    ok: true,
    fullname: `t3_abc${idx}`,
    url: `https://www.reddit.com/r/${req.subreddit}/comments/abc${idx}/`,
  });

describe('buildTitle', () => {
  it('prepends the tournament hashtag when missing', () => {
    const t = buildTitle(
      makeClip({
        captions: { en: 'Messi makes it 3-2.' },
        tournamentId: 'wc26',
      }),
      'en',
    );
    expect(t.startsWith('#WC26 ')).toBe(true);
    expect(t).toContain('Messi makes it 3-2.');
  });
  it('does not duplicate the tag if already in caption', () => {
    const t = buildTitle(
      makeClip({
        captions: { en: 'wc26: Messi 3-2.' },
        tournamentId: 'wc26',
      }),
      'en',
    );
    expect(t).toBe('wc26: Messi 3-2.');
  });
  it('truncates at 300 chars', () => {
    const t = buildTitle(
      makeClip({ captions: { en: 'x'.repeat(400) }, tournamentId: 'wc26' }),
      'en',
    );
    expect(t.length).toBe(300);
    expect(t.endsWith('…')).toBe(true);
  });
});

describe('subredditsFor / loadTargetsConfig', () => {
  it('prefers tournament list, falls back to default', () => {
    const cfg = {
      enabled: true,
      tournaments: { foo: { subreddits: [{ name: 'foo' }] } },
      default: { subreddits: [{ name: 'default' }] },
    };
    expect(subredditsFor(cfg, 'foo')).toEqual([{ name: 'foo' }]);
    expect(subredditsFor(cfg, 'bar')).toEqual([{ name: 'default' }]);
  });
  it('returns [] when disabled', () => {
    expect(
      subredditsFor(
        {
          enabled: false,
          tournaments: { foo: { subreddits: [{ name: 'foo' }] } },
          default: { subreddits: [] },
        },
        'foo',
      ),
    ).toEqual([]);
  });
  it('loads bundled config without throwing', () => {
    const cfg = loadTargetsConfig();
    expect(typeof cfg.enabled).toBe('boolean');
  });
});

describe('createRedditAdapter', () => {
  it('falls back to stub when disabled', async () => {
    const adapter = createRedditAdapter({
      client: () => new StubRedditClient(okResponder()),
      subreddits: () => [{ name: 'soccer' }],
      enabled: () => false,
      publicClipUrl: () => 'https://clips.test/x.mp4',
    });
    const a = await adapter.publish(makeClip(), {});
    const b = await adapter.publish(makeClip(), {});
    expect(a.externalId).toBe(b.externalId);
    expect(a.externalId).toMatch(/^[a-f0-9]{12}$/);
    expect(a.url.startsWith('https://')).toBe(true);
  });

  it('falls back to stub when no subreddits configured for the tournament', async () => {
    const stub = new StubRedditClient(okResponder());
    const adapter = createRedditAdapter({
      client: () => stub,
      subreddits: () => [],
      enabled: () => true,
      publicClipUrl: () => 'https://clips.test/x.mp4',
    });
    const r = await adapter.publish(makeClip(), {});
    expect(stub.calls).toHaveLength(0);
    expect(r.externalId).toMatch(/^[a-f0-9]{12}$/);
  });

  it('submits to every allowlisted subreddit with the public URL', async () => {
    const stub = new StubRedditClient(okResponder());
    const adapter = createRedditAdapter({
      client: () => stub,
      subreddits: () => [{ name: 'soccer' }, { name: 'worldcup', flair_id: 'flair-1' }],
      enabled: () => true,
      publicClipUrl: () => 'https://clips.test/x.mp4',
    });
    const r = await adapter.publish(makeClip({ tournamentId: 'wc26' }), {});
    expect(stub.calls).toHaveLength(2);
    expect(stub.calls[0]).toMatchObject({
      subreddit: 'soccer',
      url: 'https://clips.test/x.mp4',
    });
    expect(stub.calls[1]).toMatchObject({
      subreddit: 'worldcup',
      flairId: 'flair-1',
    });
    expect(stub.calls[0]?.title.startsWith('#WC26 ')).toBe(true);
    expect(r.externalId).toMatch(/^[a-f0-9]{12}$/);
    expect(r.url.startsWith('https://www.reddit.com/r/soccer/comments/')).toBe(
      true,
    );
  });

  it('skips a subreddit when the same clipId was posted in the last 24h', async () => {
    const stub = new StubRedditClient(okResponder());
    const now = vi.fn(() => 10_000_000);
    const recentPostMs = vi.fn(async (_clipId: string, sub: string) =>
      sub === 'soccer' ? 10_000_000 - (CROSSPOST_WINDOW_MS - 1000) : null,
    );
    const adapter = createRedditAdapter({
      client: () => stub,
      subreddits: () => [{ name: 'soccer' }, { name: 'worldcup' }],
      enabled: () => true,
      publicClipUrl: () => 'https://clips.test/x.mp4',
      recentPostMs,
      now,
    });
    const r = await adapter.publish(makeClip(), {});
    expect(stub.calls.map((c) => c.subreddit)).toEqual(['worldcup']);
    expect(r.externalId).toBe('t3_abc0');
  });

  it('skips when the per-subreddit 10-min cooldown is active', async () => {
    const stub = new StubRedditClient(okResponder());
    const now = vi.fn(() => 10_000_000);
    const recentSubredditPostMs = vi.fn(async (sub: string) =>
      sub === 'soccer' ? 10_000_000 - (SUBREDDIT_COOLDOWN_MS - 60_000) : null,
    );
    const adapter = createRedditAdapter({
      client: () => stub,
      subreddits: () => [{ name: 'soccer' }, { name: 'worldcup' }],
      enabled: () => true,
      publicClipUrl: () => 'https://clips.test/x.mp4',
      recentSubredditPostMs,
      now,
    });
    const r = await adapter.publish(makeClip(), {});
    expect(stub.calls.map((c) => c.subreddit)).toEqual(['worldcup']);
    expect(r.externalId).toBe('t3_abc0');
  });

  it('throws when every subreddit is skipped or fails', async () => {
    const stub = new StubRedditClient(() => ({
      ok: false,
      errorCode: 'reddit-rate_limit',
      errorMessage: 'too fast',
    }));
    const adapter = createRedditAdapter({
      client: () => stub,
      subreddits: () => [{ name: 'soccer' }, { name: 'worldcup' }],
      enabled: () => true,
      publicClipUrl: () => 'https://clips.test/x.mp4',
    });
    await expect(adapter.publish(makeClip(), {})).rejects.toThrow(
      /reddit-rate_limit/,
    );
  });

  it('throws with a clear "all skipped" message when crosspost dedup eats every sub', async () => {
    const stub = new StubRedditClient(okResponder());
    const adapter = createRedditAdapter({
      client: () => stub,
      subreddits: () => [{ name: 'soccer' }, { name: 'worldcup' }],
      enabled: () => true,
      publicClipUrl: () => 'https://clips.test/x.mp4',
      recentPostMs: async () => 1, // always recent
      now: () => CROSSPOST_WINDOW_MS / 2, // less than the window has passed
    });
    await expect(adapter.publish(makeClip(), {})).rejects.toThrow(/all subs skipped/);
  });

  it('pullMetrics: returns zeros when externalId is not a fullname', async () => {
    const stub = new StubRedditClient(okResponder());
    stub.fetchMetrics = async () => ({ views: 100, likes: 10, comments: 1, shares: 0 });
    const adapter = createRedditAdapter({
      client: () => stub,
      subreddits: () => [{ name: 'soccer' }],
      enabled: () => true,
      publicClipUrl: () => 'https://clips.test/x.mp4',
    });
    const m = await adapter.pullMetrics({
      ts: 0,
      platform: 'reddit',
      externalId: 'aggregate-hex',
      url: '',
      clipId: 'c',
      eventType: 'goal',
      status: 'published',
      tournamentId: 't',
      matchId: 'm',
    });
    expect(m).toEqual({ views: 0, likes: 0, comments: 0, shares: 0 });
  });

  it('pullMetrics: forwards to client.fetchMetrics for a t3_ fullname', async () => {
    const stub = new StubRedditClient(okResponder());
    stub.fetchMetrics = async (id) => ({
      views: id === 't3_abc' ? 1000 : 0,
      likes: 100,
      comments: 5,
      shares: 0,
    });
    const adapter = createRedditAdapter({
      client: () => stub,
      subreddits: () => [{ name: 'soccer' }],
      enabled: () => true,
      publicClipUrl: () => 'https://clips.test/x.mp4',
    });
    const m = await adapter.pullMetrics({
      ts: 0,
      platform: 'reddit',
      externalId: 't3_abc',
      url: '',
      clipId: 'c',
      eventType: 'goal',
      status: 'published',
      tournamentId: 't',
      matchId: 'm',
    });
    expect(m.views).toBe(1000);
    expect(m.likes).toBe(100);
    expect(m.comments).toBe(5);
  });
});

describe('RedditOAuthClient', () => {
  function mockSequence(responses: Response[]): typeof fetch {
    const queue = [...responses];
    return (async (..._args: unknown[]) => queue.shift()!) as unknown as typeof fetch;
  }

  it('exchanges username+password for an access token, then submits', async () => {
    const fetchMock = vi.fn(
      mockSequence([
        new Response(
          JSON.stringify({ access_token: 'TOK-1', expires_in: 3600 }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
        new Response(
          JSON.stringify({
            json: { errors: [], data: { name: 't3_xyz', url: 'https://www.reddit.com/r/x/comments/xyz/' } },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      ]),
    );
    const client = new RedditOAuthClient({
      clientId: 'cid',
      clientSecret: 'csec',
      username: 'u',
      password: 'p',
      userAgent: 'vtorn-test/0.1',
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    const r = await client.submit({
      subreddit: 'soccer',
      title: 't',
      url: 'https://clips.test/x.mp4',
    });
    expect(r.ok).toBe(true);
    expect(r.fullname).toBe('t3_xyz');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [tokenUrl, tokenInit] = fetchMock.mock.calls[0]!;
    expect(String(tokenUrl)).toBe('https://www.reddit.com/api/v1/access_token');
    const tokenHeaders = (tokenInit as RequestInit).headers as Record<string, string>;
    expect(tokenHeaders.Authorization).toBe(
      `Basic ${Buffer.from('cid:csec').toString('base64')}`,
    );
    expect(tokenHeaders['User-Agent']).toBe('vtorn-test/0.1');

    const [submitUrl, submitInit] = fetchMock.mock.calls[1]!;
    expect(String(submitUrl)).toBe('https://oauth.reddit.com/api/submit');
    const submitHeaders = (submitInit as RequestInit).headers as Record<string, string>;
    expect(submitHeaders.Authorization).toBe('Bearer TOK-1');
    const body = String((submitInit as RequestInit).body);
    expect(body).toContain('kind=link');
    expect(body).toContain('sr=soccer');
    expect(body).toContain('title=t');
    expect(body).toContain('api_type=json');
  });

  it('caches the token across submits within its TTL', async () => {
    const calls: Response[] = [
      new Response(
        JSON.stringify({ access_token: 'TOK-1', expires_in: 3600 }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
      new Response(
        JSON.stringify({ json: { errors: [], data: { name: 't3_a' } } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
      new Response(
        JSON.stringify({ json: { errors: [], data: { name: 't3_b' } } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    ];
    const fetchMock = vi.fn(async () => calls.shift()!);
    const client = new RedditOAuthClient({
      clientId: 'cid',
      clientSecret: 'csec',
      username: 'u',
      password: 'p',
      userAgent: 'vtorn-test/0.1',
      fetchImpl: fetchMock as unknown as typeof fetch,
      now: () => 0,
    });
    const r1 = await client.submit({
      subreddit: 'soccer',
      title: 't1',
      url: 'https://x',
    });
    const r2 = await client.submit({
      subreddit: 'soccer',
      title: 't2',
      url: 'https://x',
    });
    expect(r1.fullname).toBe('t3_a');
    expect(r2.fullname).toBe('t3_b');
    // Only one token-exchange call.
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('returns a structured Reddit error when /api/submit reports one', async () => {
    const fetchMock = vi.fn(
      mockSequence([
        new Response(
          JSON.stringify({ access_token: 'TOK-X', expires_in: 3600 }),
          { status: 200 },
        ),
        new Response(
          JSON.stringify({
            json: {
              errors: [['RATELIMIT', 'you are doing that too much', 'ratelimit']],
              data: {},
            },
          }),
          { status: 200 },
        ),
      ]),
    );
    const client = new RedditOAuthClient({
      clientId: 'c',
      clientSecret: 'c',
      username: 'u',
      password: 'p',
      userAgent: 'v',
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    const r = await client.submit({
      subreddit: 'soccer',
      title: 't',
      url: 'https://x',
    });
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe('reddit-ratelimit');
    expect(r.errorMessage).toContain('too much');
  });

  it('surfaces a network-level error when token exchange fails', async () => {
    const fetchMock = vi.fn(async () => new Response('nope', { status: 401 }));
    const client = new RedditOAuthClient({
      clientId: 'c',
      clientSecret: 'c',
      username: 'u',
      password: 'p',
      userAgent: 'v',
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    const r = await client.submit({
      subreddit: 'soccer',
      title: 't',
      url: 'https://x',
    });
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe('oauth');
  });

  it('fetchMetrics maps score and num_comments', async () => {
    const fetchMock = vi.fn(
      mockSequence([
        new Response(
          JSON.stringify({ access_token: 'TOK-M', expires_in: 3600 }),
          { status: 200 },
        ),
        new Response(
          JSON.stringify({
            data: { children: [{ data: { score: 250, num_comments: 12 } }] },
          }),
          { status: 200 },
        ),
      ]),
    );
    const client = new RedditOAuthClient({
      clientId: 'c',
      clientSecret: 'c',
      username: 'u',
      password: 'p',
      userAgent: 'v',
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    const m = await client.fetchMetrics('t3_xyz');
    expect(m.likes).toBe(250);
    expect(m.comments).toBe(12);
    expect(m.views).toBe(2500); // proxy 10x score
  });
});
