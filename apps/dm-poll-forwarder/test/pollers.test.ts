import { describe, expect, it, vi } from 'vitest';

import { MockPoller } from '../src/pollers/mock.js';
import { RedditPoller } from '../src/pollers/reddit-poller.js';
import { MastodonPoller, _internal as mastoInternal } from '../src/pollers/mastodon-poller.js';
import { SignalPoller } from '../src/pollers/signal-poller.js';

describe('MockPoller', () => {
  it('returns nothing when fixture queue is empty', async () => {
    const p = new MockPoller('reddit');
    const r = await p.poll(undefined);
    expect(r.messages).toHaveLength(0);
    expect(r.cursor).toBeUndefined();
  });

  it('returns only items newer than the cursor', async () => {
    const p = new MockPoller('reddit');
    p.enqueue({ id: 1, externalId: 'a', text: 'x' });
    p.enqueue({ id: 2, externalId: 'b', text: 'y' });
    const r = await p.poll('1');
    expect(r.messages).toHaveLength(1);
    expect(r.messages[0]!.externalId).toBe('b');
    expect(r.cursor).toBe('2');
  });

  it('emits messages oldest-first', async () => {
    const p = new MockPoller('signal');
    p.enqueue({ id: 5, externalId: 'a', text: 'x' });
    p.enqueue({ id: 1, externalId: 'b', text: 'y' });
    p.enqueue({ id: 3, externalId: 'c', text: 'z' });
    const r = await p.poll(undefined);
    expect(r.messages.map((m) => m.externalId)).toEqual(['b', 'c', 'a']);
    expect(r.cursor).toBe('5');
  });
});

describe('RedditPoller', () => {
  it('parses inbox listing and advances by `name`', async () => {
    const fakeFetch = vi
      .fn()
      // OAuth token request
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: 'abc', expires_in: 3600 }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
      // Inbox call (newest first)
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            kind: 'Listing',
            data: {
              children: [
                {
                  kind: 't4',
                  data: { name: 't4_002', author: 'bob', body: 'log in', was_comment: false, created_utc: 2 },
                },
                {
                  kind: 't4',
                  data: { name: 't4_001', author: 'alice', body: 'log in', was_comment: false, created_utc: 1 },
                },
              ],
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );
    const p = new RedditPoller({
      clientId: 'cid',
      clientSecret: 'csec',
      username: 'u',
      password: 'p',
      fetch: fakeFetch as unknown as typeof fetch,
    });
    const r = await p.poll(undefined);
    expect(r.messages.map((m) => m.externalId)).toEqual(['alice', 'bob']);
    expect(r.cursor).toBe('t4_002');
  });

  it('skips comments (only DMs forwarded)', async () => {
    const fakeFetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: 'abc', expires_in: 3600 }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            kind: 'Listing',
            data: {
              children: [
                { kind: 't1', data: { name: 't1_999', author: 'alice', body: 'a comment', was_comment: true } },
              ],
            },
          }),
          { status: 200 },
        ),
      );
    const p = new RedditPoller({
      clientId: 'c', clientSecret: 's', username: 'u', password: 'p',
      fetch: fakeFetch as unknown as typeof fetch,
    });
    const r = await p.poll(undefined);
    expect(r.messages).toHaveLength(0);
  });

  it('throws on non-OK inbox response', async () => {
    const fakeFetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: 'abc', expires_in: 3600 }), { status: 200 }),
      )
      .mockResolvedValueOnce(new Response('boom', { status: 500 }));
    const p = new RedditPoller({
      clientId: 'c', clientSecret: 's', username: 'u', password: 'p',
      fetch: fakeFetch as unknown as typeof fetch,
    });
    await expect(p.poll(undefined)).rejects.toThrow(/reddit-inbox-500/);
  });
});

describe('MastodonPoller', () => {
  it('forwards only direct + unread conversations', async () => {
    const fakeFetch = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          {
            id: '20',
            unread: true,
            accounts: [{ acct: 'alice' }],
            last_status: { visibility: 'direct', content: '<p>log in</p>' },
          },
          {
            id: '21',
            unread: false,
            accounts: [{ acct: 'bob' }],
            last_status: { visibility: 'direct', content: '<p>old</p>' },
          },
          {
            id: '22',
            unread: true,
            accounts: [{ acct: 'eve' }],
            last_status: { visibility: 'public', content: '<p>spam</p>' },
          },
        ]),
        { status: 200 },
      ),
    );
    const p = new MastodonPoller({
      instances: [{ host: 'mastodon.social', accessToken: 'tok' }],
      fetch: fakeFetch as unknown as typeof fetch,
    });
    const r = await p.poll(undefined);
    expect(r.messages).toHaveLength(1);
    expect(r.messages[0]!.externalId).toBe('alice@mastodon.social');
    expect(r.messages[0]!.text).toBe('log in');
    const cursor = JSON.parse(r.cursor!) as Record<string, string>;
    expect(cursor['mastodon.social']).toBe('20');
  });

  it('htmlToText strips tags and decodes entities', () => {
    expect(mastoInternal.htmlToText('<p>hello&nbsp;world</p>')).toBe('hello world');
    expect(mastoInternal.htmlToText('a<br/>b<br>c')).toBe('a\nb\nc');
    expect(mastoInternal.htmlToText('&amp;&lt;&gt;&quot;&#39;')).toBe('&<>"\'');
  });

  it('parseCursor returns {} on malformed input', () => {
    expect(mastoInternal.parseCursor('not json')).toEqual({});
    expect(mastoInternal.parseCursor('[1,2,3]')).toEqual({});
    expect(mastoInternal.parseCursor(undefined)).toEqual({});
  });

  it('handles multi-instance fan-out', async () => {
    const fakeFetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              id: '10',
              unread: true,
              accounts: [{ acct: 'alice' }],
              last_status: { visibility: 'direct', content: 'log in' },
            },
          ]),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              id: '99',
              unread: true,
              accounts: [{ acct: 'bob@mas.to' }],
              last_status: { visibility: 'direct', content: 'log in' },
            },
          ]),
          { status: 200 },
        ),
      );
    const p = new MastodonPoller({
      instances: [
        { host: 'mastodon.social', accessToken: 't1' },
        { host: 'mas.to', accessToken: 't2' },
      ],
      fetch: fakeFetch as unknown as typeof fetch,
    });
    const r = await p.poll(undefined);
    expect(r.messages.map((m) => m.externalId)).toEqual([
      'alice@mastodon.social',
      'bob@mas.to',
    ]);
    const cursor = JSON.parse(r.cursor!) as Record<string, string>;
    expect(cursor).toEqual({ 'mastodon.social': '10', 'mas.to': '99' });
  });
});

describe('SignalPoller', () => {
  it('forwards messages with composite (timestamp, source) cursor', async () => {
    const fakeFetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            envelope: {
              source: '+15551234567',
              sourceNumber: '+15551234567',
              timestamp: 1000,
              dataMessage: { message: 'log in' },
            },
          },
        ]),
        { status: 200 },
      ),
    );
    const p = new SignalPoller({
      apiBaseUrl: 'http://signal-cli',
      botNumber: '+15550001111',
      fetch: fakeFetch as unknown as typeof fetch,
    });
    const r = await p.poll(undefined);
    expect(r.messages).toHaveLength(1);
    expect(r.messages[0]!.externalId).toBe('+15551234567');
    expect(r.messages[0]!.text).toBe('log in');
    expect(r.cursor).toMatch(/:\+15551234567$/);
  });

  it('skips envelopes without dataMessage', async () => {
    const fakeFetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify([
          { envelope: { source: '+1', timestamp: 5, dataMessage: null } },
          { envelope: { source: '+1', timestamp: 6, receiptMessage: { type: 'READ' } } },
        ]),
        { status: 200 },
      ),
    );
    const p = new SignalPoller({
      apiBaseUrl: 'http://signal-cli',
      botNumber: '+15550001111',
      fetch: fakeFetch as unknown as typeof fetch,
    });
    const r = await p.poll(undefined);
    expect(r.messages).toHaveLength(0);
  });

  it('respects cursor (does not redeliver older items)', async () => {
    const mkResponse = () =>
      new Response(
        JSON.stringify([
          { envelope: { source: '+1', sourceNumber: '+1', timestamp: 5, dataMessage: { message: 'first' } } },
          { envelope: { source: '+1', sourceNumber: '+1', timestamp: 10, dataMessage: { message: 'second' } } },
        ]),
        { status: 200 },
      );
    const fakeFetch = vi.fn().mockImplementation(async () => mkResponse());
    const p = new SignalPoller({
      apiBaseUrl: 'http://signal-cli',
      botNumber: '+15550001111',
      fetch: fakeFetch as unknown as typeof fetch,
    });
    const first = await p.poll(undefined);
    expect(first.messages).toHaveLength(2);
    const second = await p.poll(first.cursor);
    expect(second.messages).toHaveLength(0);
  });
});
