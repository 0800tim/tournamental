import { describe, it, expect, vi } from 'vitest';
import { sendDiscordOtp, createDmChannel } from '../src/lib/replies/discord.js';
import { sendXOtp } from '../src/lib/replies/x.js';
import { sendThreadsOtp } from '../src/lib/replies/threads.js';
import { sendSlackOtp } from '../src/lib/replies/slack.js';
import { sendMastodonOtp } from '../src/lib/replies/mastodon.js';
import { sendLineOtp } from '../src/lib/replies/line.js';
import { sendViberOtp } from '../src/lib/replies/viber.js';
import { sendLinkedInOtp } from '../src/lib/replies/linkedin.js';
import { sendSignalOtp } from '../src/lib/replies/signal.js';
import { _resetTeamsTokenCacheForTests, sendTeamsOtp } from '../src/lib/replies/teams.js';
import { _resetRedditTokenCacheForTests, sendRedditOtp, pollRedditInbox } from '../src/lib/replies/reddit.js';
import { sendEmailMagicLink, buildRfc822 } from '../src/lib/replies/email.js';

function mockFetch(impl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
  return vi.fn(impl);
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('Discord adapter', () => {
  it('posts to the channel messages endpoint with Bot auth', async () => {
    const fetch = mockFetch(async () => jsonResponse(200, { id: 'm1' }));
    const r = await sendDiscordOtp(
      { botToken: 'tok' },
      'channel-1',
      '123456',
      { fetch: fetch as unknown as typeof globalThis.fetch },
    );
    expect(r.ok).toBe(true);
    expect(r.messageId).toBe('m1');
    const [url, init] = fetch.mock.calls[0];
    expect(String(url)).toContain('/channels/channel-1/messages');
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bot tok');
  });

  it('opens a DM channel via /users/@me/channels', async () => {
    const fetch = mockFetch(async () => jsonResponse(200, { id: 'dm-1' }));
    const r = await createDmChannel(
      { botToken: 'tok' },
      'user-7',
      { fetch: fetch as unknown as typeof globalThis.fetch },
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.channelId).toBe('dm-1');
  });
});

describe('X adapter', () => {
  it('posts to v2 dm_conversations', async () => {
    const fetch = mockFetch(async () => jsonResponse(200, { data: { dm_event_id: 'e1' } }));
    const r = await sendXOtp(
      { bearerToken: 'b' },
      'user-1',
      '123456',
      { fetch: fetch as unknown as typeof globalThis.fetch },
    );
    expect(r.ok).toBe(true);
    expect(r.messageId).toBe('e1');
    const [url] = fetch.mock.calls[0];
    expect(String(url)).toContain('dm_conversations/with/user-1/messages');
  });
});

describe('Threads adapter', () => {
  it('posts to graph.threads.net send API', async () => {
    const fetch = mockFetch(async () => jsonResponse(200, { message_id: 't1' }));
    const r = await sendThreadsOtp(
      { pageAccessToken: 'tok' },
      'rid',
      '111111',
      { fetch: fetch as unknown as typeof globalThis.fetch },
    );
    expect(r.ok).toBe(true);
    const [url] = fetch.mock.calls[0];
    expect(String(url)).toContain('graph.threads.net');
  });
});

describe('Slack adapter', () => {
  it('treats data.ok=false as failure even with HTTP 200', async () => {
    const fetch = mockFetch(async () => jsonResponse(200, { ok: false, error: 'channel_not_found' }));
    const r = await sendSlackOtp(
      { botToken: 't' },
      'U1',
      '222222',
      { fetch: fetch as unknown as typeof globalThis.fetch },
    );
    expect(r.ok).toBe(false);
    expect(r.detail).toBe('channel_not_found');
  });
  it('reports ok with ts on success', async () => {
    const fetch = mockFetch(async () => jsonResponse(200, { ok: true, ts: '12345.6' }));
    const r = await sendSlackOtp(
      { botToken: 't' },
      'U1',
      '222222',
      { fetch: fetch as unknown as typeof globalThis.fetch },
    );
    expect(r.ok).toBe(true);
    expect(r.messageId).toBe('12345.6');
  });
});

describe('Mastodon adapter', () => {
  it('posts a direct status', async () => {
    const fetch = mockFetch(async () => jsonResponse(200, { id: '1' }));
    const r = await sendMastodonOtp(
      { instance: 'mastodon.social', accessToken: 'tok' },
      'alice',
      '333333',
      { fetch: fetch as unknown as typeof globalThis.fetch },
    );
    expect(r.ok).toBe(true);
    const [url, init] = fetch.mock.calls[0];
    expect(String(url)).toContain('mastodon.social/api/v1/statuses');
    const body = JSON.parse(String(init?.body));
    expect(body.visibility).toBe('direct');
    expect(body.status.startsWith('@alice')).toBe(true);
  });
});

describe('LINE adapter', () => {
  it('pushes to v2 push endpoint', async () => {
    const fetch = mockFetch(async () => new Response(null, { status: 200 }));
    const r = await sendLineOtp(
      { channelAccessToken: 'tok' },
      'U1',
      '444444',
      { fetch: fetch as unknown as typeof globalThis.fetch },
    );
    expect(r.ok).toBe(true);
    const [url] = fetch.mock.calls[0];
    expect(String(url)).toContain('api.line.me/v2/bot/message/push');
  });
});

describe('Viber adapter', () => {
  it('treats data.status=0 as success', async () => {
    const fetch = mockFetch(async () => jsonResponse(200, { status: 0, message_token: 99 }));
    const r = await sendViberOtp(
      { authToken: 't', senderName: 'VTourn' },
      'r1',
      '555555',
      { fetch: fetch as unknown as typeof globalThis.fetch },
    );
    expect(r.ok).toBe(true);
    expect(r.messageId).toBe('99');
  });
  it('treats data.status!=0 as failure', async () => {
    const fetch = mockFetch(async () => jsonResponse(200, { status: 5, status_message: 'bad' }));
    const r = await sendViberOtp(
      { authToken: 't', senderName: 'VTourn' },
      'r1',
      '555555',
      { fetch: fetch as unknown as typeof globalThis.fetch },
    );
    expect(r.ok).toBe(false);
    expect(r.detail).toBe('bad');
  });
});

describe('LinkedIn adapter', () => {
  it('posts to /rest/messages with the right headers', async () => {
    const fetch = mockFetch(async () => new Response(null, { status: 201 }));
    const r = await sendLinkedInOtp(
      { accessToken: 't', fromUrn: 'urn:li:person:bot' },
      'urn:li:person:user',
      '666666',
      { fetch: fetch as unknown as typeof globalThis.fetch },
    );
    expect(r.ok).toBe(true);
    const [, init] = fetch.mock.calls[0];
    const headers = init?.headers as Record<string, string>;
    expect(headers['LinkedIn-Version']).toBe('202404');
  });
});

describe('Signal adapter', () => {
  it('POSTs to /v2/send with the bot number', async () => {
    const fetch = mockFetch(async () => new Response(null, { status: 201 }));
    const r = await sendSignalOtp(
      { apiBaseUrl: 'http://signal-api', botNumber: '+6421000' },
      '+12025550100',
      '777777',
      { fetch: fetch as unknown as typeof globalThis.fetch },
    );
    expect(r.ok).toBe(true);
    const [url, init] = fetch.mock.calls[0];
    expect(String(url)).toBe('http://signal-api/v2/send');
    const body = JSON.parse(String(init?.body));
    expect(body.recipients).toEqual(['+12025550100']);
  });
});

describe('Teams adapter', () => {
  it('fetches a token and POSTs an activity', async () => {
    _resetTeamsTokenCacheForTests();
    let nthCall = 0;
    const fetch = mockFetch(async (url) => {
      nthCall += 1;
      if (String(url).includes('login.microsoftonline.com')) {
        return jsonResponse(200, { access_token: 'A', expires_in: 3600 });
      }
      return jsonResponse(201, { id: 'a1' });
    });
    const r = await sendTeamsOtp(
      { appId: 'app', appPassword: 'pw' },
      { serviceUrl: 'https://smba.trafficmanager.net/au/', conversationId: 'conv' },
      '888888',
      { fetch: fetch as unknown as typeof globalThis.fetch },
    );
    expect(r.ok).toBe(true);
    expect(nthCall).toBe(2);
  });
});

describe('Reddit adapter', () => {
  it('caches the OAuth token across sends', async () => {
    _resetRedditTokenCacheForTests();
    let tokenCalls = 0;
    const fetch = mockFetch(async (url) => {
      if (String(url).includes('access_token')) {
        tokenCalls += 1;
        return jsonResponse(200, { access_token: 't', expires_in: 3600 });
      }
      return jsonResponse(200, {});
    });
    const cfg = {
      clientId: 'c',
      clientSecret: 's',
      username: 'u',
      password: 'p',
      userAgent: 'ua',
    };
    await sendRedditOtp(cfg, 'someone', '999999', {
      fetch: fetch as unknown as typeof globalThis.fetch,
    });
    await sendRedditOtp(cfg, 'someone', '888888', {
      fetch: fetch as unknown as typeof globalThis.fetch,
    });
    expect(tokenCalls).toBe(1);
  });

  it('parses the inbox poll into messages', async () => {
    _resetRedditTokenCacheForTests();
    const fetch = mockFetch(async (url) => {
      if (String(url).includes('access_token')) {
        return jsonResponse(200, { access_token: 't', expires_in: 3600 });
      }
      if (String(url).includes('message/unread')) {
        return jsonResponse(200, {
          data: {
            children: [
              {
                data: {
                  name: 't4_abc',
                  author: 'alice',
                  body: 'log in',
                  created_utc: 1700000000,
                },
              },
            ],
          },
        });
      }
      return jsonResponse(200, {}); // read_message
    });
    const items = await pollRedditInbox(
      {
        clientId: 'c',
        clientSecret: 's',
        username: 'u',
        password: 'p',
        userAgent: 'ua',
      },
      { fetch: fetch as unknown as typeof globalThis.fetch },
    );
    expect(items).toHaveLength(1);
    expect(items[0].fromUsername).toBe('alice');
    expect(items[0].body).toBe('log in');
  });
});

describe('Email adapter', () => {
  it('builds an RFC822 message with the magic link in body', () => {
    const raw = buildRfc822({
      from: 'login@vtourn.com',
      to: 'a@b.com',
      subject: 's',
      text: 'https://vtourn.com/auth?code=x',
    });
    expect(raw).toContain('From: login@vtourn.com');
    expect(raw).toContain('To: a@b.com');
    expect(raw).toContain('https://vtourn.com/auth?code=x');
  });
  it('uses an injected SMTP client and includes the link', async () => {
    let captured: { to: string; raw: string; from: string } | null = null;
    const r = await sendEmailMagicLink(
      {
        smtpHost: 'smtp.example.com',
        smtpPort: 465,
        smtpUser: 'u',
        smtpPass: 'p',
        fromAddress: 'login@vtourn.com',
        appBaseUrl: 'https://vtourn.com',
      },
      { to: 'alice@example.com', token: 'TOKEN' },
      {
        smtpClient: {
          async sendRaw(opts) {
            captured = { to: opts.to, raw: opts.raw, from: opts.from };
          },
        },
      },
    );
    expect(r.ok).toBe(true);
    expect(captured).toBeTruthy();
    expect(captured!.to).toBe('alice@example.com');
    expect(captured!.raw).toContain('https://vtourn.com/auth/dm-otp/verify?code=TOKEN');
  });
});
