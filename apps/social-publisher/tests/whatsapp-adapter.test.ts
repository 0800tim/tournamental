/**
 * WhatsApp adapter behaviour tests.
 *
 * Covers the bits the generic `adapters.test.ts` loop can't: fan-out across
 * multiple group jids, per-group rate-limiting via the injected sleep,
 * retry-once on failure, caption truncation, and env-var parsing.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  AivaWhatsAppMediaClient,
  RATE_LIMIT_MS,
  type AivaSendMediaRequest,
  type AivaSendMediaResult,
  type AivaWhatsAppMediaSender,
  createWhatsAppAdapter,
  parseGroupIds,
  truncateCaption,
} from '../src/lib/adapters/whatsapp.js';
import { makeClip } from './fixtures.js';

class StubAivaClient implements AivaWhatsAppMediaSender {
  public readonly calls: AivaSendMediaRequest[] = [];

  constructor(private readonly responder: (req: AivaSendMediaRequest, callIndex: number) => AivaSendMediaResult) {}

  async sendMedia(req: AivaSendMediaRequest): Promise<AivaSendMediaResult> {
    const idx = this.calls.length;
    this.calls.push(req);
    return this.responder(req, idx);
  }
}

function alwaysOk(suffix = ''): (req: AivaSendMediaRequest) => AivaSendMediaResult {
  return (req) => ({
    ok: true,
    messageId: `wamid.${req.to.replace('@g.us', '')}${suffix}`,
  });
}

describe('truncateCaption', () => {
  it('returns the input when within the limit', () => {
    expect(truncateCaption('hello')).toBe('hello');
  });

  it('truncates with U+2026 when over the limit', () => {
    const long = 'a'.repeat(2000);
    const out = truncateCaption(long, 1024);
    expect(out.length).toBe(1024);
    expect(out.endsWith('…')).toBe(true);
    expect(out.slice(0, -1)).toBe('a'.repeat(1023));
  });
});

describe('parseGroupIds', () => {
  it('returns [] for undefined or empty', () => {
    expect(parseGroupIds(undefined)).toEqual([]);
    expect(parseGroupIds('')).toEqual([]);
    expect(parseGroupIds('   ')).toEqual([]);
  });

  it('splits CSV and trims whitespace', () => {
    expect(parseGroupIds(' 111@g.us , 222@g.us ,333@g.us')).toEqual([
      '111@g.us',
      '222@g.us',
      '333@g.us',
    ]);
  });

  it('deduplicates jids while preserving first-seen order', () => {
    expect(parseGroupIds('111@g.us,222@g.us,111@g.us,333@g.us')).toEqual([
      '111@g.us',
      '222@g.us',
      '333@g.us',
    ]);
  });
});

describe('whatsappAdapter (factory)', () => {
  it('falls back to deterministic stub when no client/groups configured', async () => {
    const adapter = createWhatsAppAdapter({
      client: () => null,
      groupIds: () => [],
    });
    const a = await adapter.publish(makeClip(), {});
    const b = await adapter.publish(makeClip(), {});
    expect(a.externalId).toBe(b.externalId);
    expect(a.externalId).toMatch(/^[a-f0-9]{12}$/);
    expect(a.url.startsWith('https://')).toBe(true);
  });

  it('fans out to every configured group jid in order', async () => {
    const stub = new StubAivaClient(alwaysOk());
    const adapter = createWhatsAppAdapter({
      client: () => stub,
      groupIds: () => ['111@g.us', '222@g.us', '333@g.us'],
      sleep: async () => undefined,
    });
    const result = await adapter.publish(makeClip(), {});
    expect(stub.calls).toHaveLength(3);
    expect(stub.calls.map((c) => c.to)).toEqual([
      '111@g.us',
      '222@g.us',
      '333@g.us',
    ]);
    expect(stub.calls[0]?.mimeType).toBe('video/mp4');
    expect(stub.calls[0]?.mediaUrl).toBe('/clips/clip_test_001_9x16.mp4');
    expect(stub.calls[0]?.caption).toBe('Goal! Test caption in English.');
    // Aggregate id is a stable 12-char hex when more than one message went out.
    expect(result.externalId).toMatch(/^[a-f0-9]{12}$/);
    expect(result.url).toBe('');
  });

  it('falls back to v1x1 when v9x16 is missing', async () => {
    const stub = new StubAivaClient(alwaysOk());
    const adapter = createWhatsAppAdapter({
      client: () => stub,
      groupIds: () => ['111@g.us'],
      sleep: async () => undefined,
    });
    await adapter.publish(
      makeClip({
        paths: {
          v9x16: '',
          v16x9: '/clips/c_16x9.mp4',
          v1x1: '/clips/c_1x1.mp4',
          og: '/clips/c.png',
        },
      }),
      {},
    );
    expect(stub.calls[0]?.mediaUrl).toBe('/clips/c_1x1.mp4');
  });

  it('truncates over-long captions with an ellipsis', async () => {
    const stub = new StubAivaClient(alwaysOk());
    const adapter = createWhatsAppAdapter({
      client: () => stub,
      groupIds: () => ['111@g.us'],
      sleep: async () => undefined,
    });
    const long = 'x'.repeat(2000);
    await adapter.publish(makeClip({ captions: { en: long } }), {});
    expect(stub.calls[0]?.caption.length).toBe(1024);
    expect(stub.calls[0]?.caption.endsWith('…')).toBe(true);
  });

  it('rate-limits subsequent sends to the same group with a sleep', async () => {
    const stub = new StubAivaClient(alwaysOk());
    const sleep = vi.fn(async () => undefined);
    let t = 1_000_000;
    const now = () => t;
    const adapter = createWhatsAppAdapter({
      client: () => stub,
      // Same group jid twice → second send should wait the full window.
      groupIds: () => ['111@g.us', '111@g.us'],
      sleep,
      now,
    });

    // The fan-out loop calls `now()` twice per group send (waitForSlot
    // reads "now" before the slot check and again to record the send).
    // Drive `t` deterministically so the second send observes 0 elapsed
    // and must sleep the full window.
    await adapter.publish(makeClip(), {});

    // First send: lastSentAt[group] = 0, elapsed huge, no sleep.
    // Second send: elapsed = 0, must sleep RATE_LIMIT_MS.
    expect(sleep).toHaveBeenCalledWith(RATE_LIMIT_MS);
    expect(stub.calls).toHaveLength(2);
  });

  it('does not rate-limit a different group', async () => {
    const stub = new StubAivaClient(alwaysOk());
    const sleep = vi.fn(async () => undefined);
    const adapter = createWhatsAppAdapter({
      client: () => stub,
      groupIds: () => ['aaa@g.us', 'bbb@g.us'],
      sleep,
      now: () => 1_000_000, // never advances
    });
    await adapter.publish(makeClip(), {});
    expect(sleep).not.toHaveBeenCalled();
    expect(stub.calls).toHaveLength(2);
  });

  it('retries once on failure and succeeds on the retry', async () => {
    let attempts = 0;
    const stub = new StubAivaClient(() => {
      attempts++;
      if (attempts === 1) {
        return { ok: false, errorCode: 'http-503', errorMessage: 'flaky' };
      }
      return { ok: true, messageId: 'wamid.RETRY-OK' };
    });
    const adapter = createWhatsAppAdapter({
      client: () => stub,
      groupIds: () => ['111@g.us'],
      sleep: async () => undefined,
    });
    const result = await adapter.publish(makeClip(), {});
    expect(stub.calls).toHaveLength(2);
    expect(result.externalId).toBe('wamid.RETRY-OK');
  });

  it('throws after two consecutive failures', async () => {
    const stub = new StubAivaClient(() => ({
      ok: false,
      errorCode: 'http-500',
      errorMessage: 'gateway down',
    }));
    const adapter = createWhatsAppAdapter({
      client: () => stub,
      groupIds: () => ['111@g.us'],
      sleep: async () => undefined,
    });
    await expect(adapter.publish(makeClip(), {})).rejects.toThrow(/gateway down/);
    expect(stub.calls).toHaveLength(2);
  });

  it('pullMetrics returns zeros (WA exposes no group analytics)', async () => {
    const adapter = createWhatsAppAdapter({
      client: () => null,
      groupIds: () => [],
    });
    const metrics = await adapter.pullMetrics({
      ts: 0,
      platform: 'whatsapp',
      externalId: 'x',
      url: '',
      clipId: 'c',
      eventType: 'goal',
      status: 'published',
      tournamentId: 't',
      matchId: 'm',
    });
    expect(metrics).toEqual({ views: 0, likes: 0, comments: 0, shares: 0 });
  });
});

describe('AivaWhatsAppMediaClient', () => {
  it('POSTs to /api/v1/whatsapp/sessions/{id}/send-media with bearer auth', async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => {
      return new Response(JSON.stringify({ messageId: 'wamid.OK' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    const client = new AivaWhatsAppMediaClient({
      baseUrl: 'http://gw.test/',
      apiKey: 'secret-key',
      sessionId: 'sess-1',
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    const result = await client.sendMedia({
      to: '111@g.us',
      mediaUrl: '/clips/x.mp4',
      mimeType: 'video/mp4',
      caption: 'cap',
    });
    expect(result.ok).toBe(true);
    expect(result.messageId).toBe('wamid.OK');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe('http://gw.test/api/v1/whatsapp/sessions/sess-1/send-media');
    expect((init as RequestInit).method).toBe('POST');
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer secret-key');
    expect(headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      to: '111@g.us',
      mediaUrl: '/clips/x.mp4',
      mimeType: 'video/mp4',
      caption: 'cap',
    });
  });

  it('returns an error result on non-2xx', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ error: 'nope' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const client = new AivaWhatsAppMediaClient({
      baseUrl: 'http://gw.test',
      apiKey: 'k',
      sessionId: 's',
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    const result = await client.sendMedia({
      to: '111@g.us',
      mediaUrl: '/x.mp4',
      mimeType: 'video/mp4',
      caption: 'c',
    });
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('http-503');
  });

  it('returns a network error result when fetch throws', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    const client = new AivaWhatsAppMediaClient({
      baseUrl: 'http://gw.test',
      apiKey: 'k',
      sessionId: 's',
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    const result = await client.sendMedia({
      to: '111@g.us',
      mediaUrl: '/x.mp4',
      mimeType: 'video/mp4',
      caption: 'c',
    });
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('network');
    expect(result.errorMessage).toContain('ECONNREFUSED');
  });
});
